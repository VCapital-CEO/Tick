-- Ensure social actions work on installations where earlier migrations were partial.
-- Safe to run repeatedly in Supabase SQL Editor.
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
-- The original comments migration omitted explicit grants on some projects.
grant select on comments to anon,authenticated;
grant insert on comments to authenticated;
grant delete on comments to authenticated;
notify pgrst,'reload schema';
