-- Comment threads and per-comment social interactions.
alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;
create index if not exists comments_parent_idx on comments(parent_id, created_at);

create table if not exists comment_likes(
  comment_id uuid not null references comments(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(comment_id,user_id)
);
create table if not exists comment_reposts(
  comment_id uuid not null references comments(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(comment_id,user_id)
);

alter table comment_likes enable row level security;
alter table comment_reposts enable row level security;
drop policy if exists comment_like_read on comment_likes;
create policy comment_like_read on comment_likes for select using (true);
drop policy if exists comment_like_insert on comment_likes;
create policy comment_like_insert on comment_likes for insert to authenticated with check (user_id=auth.uid());
drop policy if exists comment_like_delete on comment_likes;
create policy comment_like_delete on comment_likes for delete to authenticated using (user_id=auth.uid());
drop policy if exists comment_repost_read on comment_reposts;
create policy comment_repost_read on comment_reposts for select using (true);
drop policy if exists comment_repost_insert on comment_reposts;
create policy comment_repost_insert on comment_reposts for insert to authenticated with check (user_id=auth.uid());
drop policy if exists comment_repost_delete on comment_reposts;
create policy comment_repost_delete on comment_reposts for delete to authenticated using (user_id=auth.uid());

grant select on comment_likes,comment_reposts to anon,authenticated;
grant insert,delete on comment_likes,comment_reposts to authenticated;
notify pgrst,'reload schema';
