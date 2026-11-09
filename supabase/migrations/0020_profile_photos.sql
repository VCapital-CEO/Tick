-- Profile photo support.
alter table profiles add column if not exists avatar_url text;
grant update(avatar_url) on profiles to authenticated;

insert into storage.buckets(id,name,public)
values('avatars','avatars',true)
on conflict (id) do update set public=true;

create policy avatar_read on storage.objects
  for select using (bucket_id='avatars');

create policy avatar_insert on storage.objects
  for insert to authenticated
  with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

create policy avatar_update on storage.objects
  for update to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text)
  with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

create policy avatar_delete on storage.objects
  for delete to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
