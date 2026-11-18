-- Profile photo support.
alter table profiles add column if not exists avatar_url text;
grant update(avatar_url) on profiles to authenticated;

-- Public bucket, but only small images: no SVG/HTML, so nobody can host scripts or large files here.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists avatar_read on storage.objects;
create policy avatar_read on storage.objects
  for select using (bucket_id='avatars');

drop policy if exists avatar_insert on storage.objects;
create policy avatar_insert on storage.objects
  for insert to authenticated
  with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists avatar_update on storage.objects;
create policy avatar_update on storage.objects
  for update to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text)
  with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists avatar_delete on storage.objects;
create policy avatar_delete on storage.objects
  for delete to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);