-- Persisted bookmarks and unique sharers for posts.
create table if not exists post_bookmarks(
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create index if not exists post_bookmarks_post_idx on post_bookmarks(post_id);
alter table post_bookmarks enable row level security;
create policy bookmark_read on post_bookmarks for select using (true);
create policy bookmark_insert on post_bookmarks for insert to authenticated with check (user_id=auth.uid());
create policy bookmark_delete on post_bookmarks for delete to authenticated using (user_id=auth.uid());

create table if not exists post_shares(
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  first_shared_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create index if not exists post_shares_post_idx on post_shares(post_id);
alter table post_shares enable row level security;
create policy share_read on post_shares for select using (true);
create policy share_insert on post_shares for insert to authenticated with check (user_id=auth.uid());

create or replace view post_feed as
 select po.id,po.body,po.system,po.created_at,po.author_id,p.handle,p.display_name,p.color,
  (select count(*) from post_likes l where l.post_id=po.id) likes,
  po.group_id,g.slug group_slug,g.name group_name,
  (select count(*) from comments c where c.post_id=po.id) comments,
  po.media_url,po.media_type,p.avatar_url,
  (select count(*) from post_reposts r where r.post_id=po.id) reposts,
  (select count(*) from post_impressions i where i.post_id=po.id) impressions,
  (select count(*) from post_bookmarks b where b.post_id=po.id) bookmarks,
  (select count(*) from post_shares s where s.post_id=po.id) shares
 from posts po join profiles p on p.id=po.author_id left join groups g on g.id=po.group_id;

grant select on post_feed,post_bookmarks,post_shares to anon,authenticated;
