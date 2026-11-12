-- Complete social features for installations where earlier migrations were partial.
create table if not exists comments(
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references posts on delete cascade,
 author_id uuid not null references profiles on delete cascade,
 body text not null check (char_length(body) between 1 and 280),
 created_at timestamptz not null default now()
);
create index if not exists comments_post_created_idx on comments(post_id,created_at);
alter table comments enable row level security;
do $$ begin
 drop policy if exists cm_read on comments; create policy cm_read on comments for select using (true);
 drop policy if exists cm_ins on comments; create policy cm_ins on comments for insert to authenticated with check (author_id=auth.uid() and not coalesce((select is_banned from profiles where id=auth.uid()),false));
 drop policy if exists cm_del on comments; create policy cm_del on comments for delete to authenticated using (author_id=auth.uid());
end $$;
grant select on comments to anon,authenticated;
grant insert,delete on comments to authenticated;
create table if not exists post_reposts(post_id uuid not null references posts on delete cascade,user_id uuid not null references profiles on delete cascade,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table if not exists post_bookmarks(post_id uuid not null references posts on delete cascade,user_id uuid not null references profiles on delete cascade,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table if not exists post_shares(post_id uuid not null references posts on delete cascade,user_id uuid not null references profiles on delete cascade,first_shared_at timestamptz not null default now(),primary key(post_id,user_id));
alter table post_reposts enable row level security; alter table post_bookmarks enable row level security; alter table post_shares enable row level security;
do $$ begin
 drop policy if exists repost_read on post_reposts; create policy repost_read on post_reposts for select using (true);
 drop policy if exists repost_insert on post_reposts; create policy repost_insert on post_reposts for insert to authenticated with check (user_id=auth.uid());
 drop policy if exists repost_delete on post_reposts; create policy repost_delete on post_reposts for delete to authenticated using (user_id=auth.uid());
 drop policy if exists bookmark_read on post_bookmarks; create policy bookmark_read on post_bookmarks for select using (true);
 drop policy if exists bookmark_insert on post_bookmarks; create policy bookmark_insert on post_bookmarks for insert to authenticated with check (user_id=auth.uid());
 drop policy if exists bookmark_delete on post_bookmarks; create policy bookmark_delete on post_bookmarks for delete to authenticated using (user_id=auth.uid());
 drop policy if exists share_read on post_shares; create policy share_read on post_shares for select using (true);
 drop policy if exists share_insert on post_shares; create policy share_insert on post_shares for insert to authenticated with check (user_id=auth.uid());
end $$;
grant select on post_reposts,post_bookmarks,post_shares to authenticated;
grant insert,delete on post_reposts,post_bookmarks to authenticated;
grant insert on post_shares to authenticated;
notify pgrst,'reload schema';
