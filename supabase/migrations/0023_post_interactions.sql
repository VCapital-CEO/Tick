-- Real social interaction counts for posts.
create table if not exists post_reposts(
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create index if not exists post_reposts_post_idx on post_reposts(post_id);
alter table post_reposts enable row level security;
create policy repost_read on post_reposts for select using (true);
create policy repost_insert on post_reposts for insert to authenticated with check (user_id=auth.uid());
create policy repost_delete on post_reposts for delete to authenticated using (user_id=auth.uid());

-- One impression per signed-in viewer per post. This prevents refreshes from inflating counts.
create table if not exists post_impressions(
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create index if not exists post_impressions_post_idx on post_impressions(post_id);
alter table post_impressions enable row level security;
create policy impression_read on post_impressions for select using (true);
create policy impression_insert on post_impressions for insert to authenticated with check (user_id=auth.uid());

create or replace view post_feed as
 select po.id,po.body,po.system,po.created_at,po.author_id,p.handle,p.display_name,p.color,
  (select count(*) from post_likes l where l.post_id=po.id) likes,
  po.group_id,g.slug group_slug,g.name group_name,
  (select count(*) from comments c where c.post_id=po.id) comments,
  po.media_url,po.media_type,p.avatar_url,
  (select count(*) from post_reposts r where r.post_id=po.id) reposts,
  (select count(*) from post_impressions i where i.post_id=po.id) impressions
 from posts po join profiles p on p.id=po.author_id left join groups g on g.id=po.group_id;

grant select on post_feed,post_reposts,post_impressions to anon,authenticated;
