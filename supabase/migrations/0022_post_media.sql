-- Post media: one optional photo, GIF, or video attachment per post.
alter table posts add column if not exists media_url text;
alter table posts add column if not exists media_type text;
alter table posts add constraint posts_media_type_check
  check (media_type is null or media_type in ('image','video'));

insert into storage.buckets(id,name,public)
values('post-media','post-media',true)
on conflict (id) do update set public=true;

create policy post_media_read on storage.objects
  for select using (bucket_id='post-media');
create policy post_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy post_media_update on storage.objects
  for update to authenticated
  using (bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text)
  with check (bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy post_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- Keep the existing post_feed column order intact; append new fields at the end.
create or replace view post_feed as
 select po.id,po.body,po.system,po.created_at,po.author_id,p.handle,p.display_name,p.color,
  (select count(*) from post_likes l where l.post_id=po.id) likes,
  po.group_id,g.slug group_slug,g.name group_name,
  (select count(*) from comments c where c.post_id=po.id) comments,
  po.media_url,po.media_type,p.avatar_url
 from posts po join profiles p on p.id=po.author_id left join groups g on g.id=po.group_id;

grant select on post_feed to anon,authenticated;
