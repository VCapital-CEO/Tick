-- A profile photo must be a file in this project's own avatars bucket.
-- The page puts this value inside a CSS url(), so anything else (an outside address, or text with quotes or brackets) is refused.
alter table profiles add constraint profiles_avatar_url_ours check (
 avatar_url is null or avatar_url ~ '^https://ygtdbboazcdsyfmzopfw\.supabase\.co/storage/v1/object/public/avatars/[A-Za-z0-9._/-]+$');