-- Minimal imitation of the Supabase objects our migrations depend on. Test use only.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; create schema storage;
create table auth.users(id uuid primary key default gen_random_uuid(), email text);
create table auth.mfa_factors(id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create table storage.buckets(id text primary key, name text, public boolean default false);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
 select (string_to_array(name,'/'))[1:greatest(coalesce(array_length(string_to_array(name,'/'),1),1)-1,0)] $$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant execute on all functions in schema auth,storage to anon,authenticated,service_role;
grant select on auth.mfa_factors to service_role;
grant all on storage.objects,storage.buckets to authenticated,service_role;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
-- The embedded test Postgres has no citext; real Supabase does. Plain text stands in for it here.
create domain public.citext as text;
