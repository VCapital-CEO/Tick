-- Topic groups, per-group feeds, group moderation, and social notifications.
create table groups(
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check (slug ~ '^[a-z0-9-]{3,30}$'),
 name text not null check (char_length(name) between 3 and 40),
 description text not null default '' check (char_length(description)<=280),
 created_by uuid references profiles on delete set null,
 official boolean not null default false,
 created_at timestamptz not null default now());
create unique index groups_name_lower on groups(lower(name));
create table group_members(
 group_id uuid not null references groups on delete cascade,
 user_id uuid not null references profiles on delete cascade,
 role text not null default 'member' check (role in ('member','mod')),
 joined_at timestamptz not null default now(),
 primary key(group_id,user_id));
create index on group_members(user_id);
create table group_bans(
 group_id uuid not null references groups on delete cascade,
 user_id uuid not null references profiles on delete cascade,
 created_at timestamptz not null default now(),
 primary key(group_id,user_id));
alter table posts add column group_id uuid references groups on delete set null;
create index on posts(group_id,created_at desc);
alter table groups enable row level security; alter table group_members enable row level security; alter table group_bans enable row level security;

create function is_group_mod(g uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from group_members where group_id=g and user_id=auth.uid() and role='mod') $$;

create policy g_read on groups for select using (true);
create policy g_ins on groups for insert with check (created_by=auth.uid() and official=false and not (select is_banned from profiles where id=auth.uid()));
create policy g_upd on groups for update using (is_admin() or is_group_mod(id));
create policy g_del on groups for delete using (is_admin());
revoke update on groups from anon,authenticated; grant update(name,description) on groups to authenticated;
create trigger groups_rate before insert on groups for each row execute function rate_limit('3','created_by');

create function t_group_new() returns trigger language plpgsql security definer set search_path=public as $$
begin if new.created_by is not null then insert into group_members(group_id,user_id,role) values(new.id,new.created_by,'mod'); end if; return new; end $$;
create trigger groups_creator after insert on groups for each row execute function t_group_new();

create policy gm_read on group_members for select using (true);
create policy gm_ins on group_members for insert with check (user_id=auth.uid() and role='member'
 and not (select is_banned from profiles where id=auth.uid())
 and not exists(select 1 from group_bans b where b.group_id=group_members.group_id and b.user_id=auth.uid()));
create policy gm_del on group_members for delete using (user_id=auth.uid() or is_admin() or (role='member' and is_group_mod(group_id)));
create policy gb_read on group_bans for select using (is_admin() or is_group_mod(group_id) or user_id=auth.uid());
create policy gb_ins on group_bans for insert with check (is_admin() or is_group_mod(group_id));
create policy gb_del on group_bans for delete using (is_admin() or is_group_mod(group_id));
-- A ban also removes the person from the group.
create function t_ban_member() returns trigger language plpgsql security definer set search_path=public as $$
begin delete from group_members where group_id=new.group_id and user_id=new.user_id and role='member'; return new; end $$;
create trigger bans_remove after insert on group_bans for each row execute function t_ban_member();

-- Posting into a group needs membership. Moderators can remove posts and comments in their group.
drop policy post_ins on posts;
create policy post_ins on posts for insert with check (author_id=auth.uid() and system=false
 and not (select is_banned from profiles where id=auth.uid())
 and (group_id is null or exists(select 1 from group_members m where m.group_id=posts.group_id and m.user_id=auth.uid())));
create policy post_mod_del on posts for delete using (group_id is not null and is_group_mod(group_id));
create policy cm_mod_del on comments for delete using (exists(select 1 from posts p where p.id=comments.post_id and p.group_id is not null and is_group_mod(p.group_id)));

create or replace view post_feed as
 select po.id,po.body,po.system,po.created_at,po.author_id,p.handle,p.display_name,p.color,
  (select count(*) from post_likes l where l.post_id=po.id) likes,
  po.group_id,g.slug group_slug,g.name group_name,
  (select count(*) from comments c where c.post_id=po.id) comments
 from posts po join profiles p on p.id=po.author_id left join groups g on g.id=po.group_id;
create view group_cards as
 select g.id,g.slug,g.name,g.description,g.official,g.created_at,
  (select count(*) from group_members m where m.group_id=g.id) members,
  (select count(*) from posts po where po.group_id=g.id and po.created_at>now()-interval '7 days') posts_7d
 from groups g;
grant select on post_feed,group_cards to anon,authenticated;

-- Notifications: replies to your posts and new followers.
create function t_comment_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare a uuid; h text; begin
 select author_id into a from posts where id=new.post_id; select handle into h from profiles where id=new.author_id;
 if a is not null and a<>new.author_id then perform notify(a,'comment',h||' commented on your post','/#/feed'); end if; return new; end $$;
create trigger comments_notify after insert on comments for each row execute function t_comment_notify();
create function t_follow_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare h text; begin select handle into h from profiles where id=new.follower_id;
 perform notify(new.followee_id,'follow',h||' followed you','/u/'||h); return new; end $$;
create trigger follows_notify after insert on follows for each row execute function t_follow_notify();

insert into groups(slug,name,description,official) values
 ('trend-following','Trend following','Breakouts, moving averages and riding momentum. Share setups and results.',true),
 ('mean-reversion','Mean reversion','Buying dips and fading extremes. When it works and when it breaks.',true),
 ('momentum','Momentum','Relative strength and rotation across markets.',true),
 ('grid-bots','Grid bots','Range trading with grids: spacing, sizing and risk.',true),
 ('crypto-markets','Crypto markets','Market talk and what your bots are seeing on the pairs they trade.',true),
 ('beginners','Beginners','New to bots? Ask anything. Please be kind.',true),
 ('creator-showcase','Creator showcase','Creators: announce new bots and versions, and ask for feedback.',true),
 ('tick-feedback','Tick feedback and ideas','Tell us what to fix or build next.',true);