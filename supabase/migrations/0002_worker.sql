-- Worker, verification, key vault, code storage, moderation.
alter table profiles add column is_admin boolean not null default false, add column is_banned boolean not null default false;
revoke update on profiles from authenticated; grant update(handle,display_name,bio,color) on profiles to authenticated;
create function is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select is_admin from profiles where id=auth.uid()),false) $$;

insert into app_config values('verification_fee_cents','1500'),
 ('verification_rules','{"days":30,"min_trades":30,"max_dd_pct":35,"min_sharpe":0.5}');

create table bot_versions(id uuid primary key default gen_random_uuid(), bot_id uuid not null references bots on delete cascade,
 version int not null, code_sha256 text not null, storage_path text not null, created_at timestamptz not null default now(), unique(bot_id,version));
alter table bots add column current_version_id uuid references bot_versions;

create table payments(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles,
 kind text not null check (kind in ('verification_fee','rental')), amount_cents int not null, provider text not null,
 provider_ref text unique, state text not null check (state in ('requires_action','paid','failed','refunded')),
 bot_id uuid, created_at timestamptz not null default now());

create table verification_runs(id uuid primary key default gen_random_uuid(), bot_id uuid not null references bots on delete cascade,
 version_id uuid not null references bot_versions, state verify_state not null default 'pending', fee_cents int not null default 0,
 payment_id uuid references payments, starts_at timestamptz, ends_at timestamptz, paper_state jsonb not null default '{}',
 result jsonb, created_at timestamptz not null default now());
create unique index one_active_run on verification_runs(bot_id) where state in ('pending','running');

create table fills(id bigint generated always as identity primary key, bot_id uuid not null references bots on delete cascade,
 run_id uuid references verification_runs on delete cascade, market text not null, side text not null check (side in ('buy','sell')),
 qty numeric not null, price numeric not null, fee numeric not null default 0, realized_pnl numeric, ts timestamptz not null default now());
create index on fills(bot_id,ts);
create table equity_snapshots(bot_id uuid not null references bots on delete cascade, run_id uuid not null references verification_runs on delete cascade,
 ts timestamptz not null, equity numeric not null, primary key(run_id,ts));

create table exchange_connections(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade,
 exchange text not null check (exchange in ('binance')), label text not null check (char_length(label) between 1 and 40),
 key_hint text not null, api_key_enc text not null, api_secret_enc text not null,
 can_withdraw boolean not null default false check (can_withdraw=false), last_checked_at timestamptz, created_at timestamptz not null default now());

alter table reports add column state text not null default 'open' check (state in ('open','actioned','dismissed'));

alter table bot_versions enable row level security; alter table payments enable row level security;
alter table verification_runs enable row level security; alter table fills enable row level security;
alter table equity_snapshots enable row level security; alter table exchange_connections enable row level security;
create policy ver_read on bot_versions for select using (exists(select 1 from bots b where b.id=bot_id and b.creator_id=auth.uid()));
create policy pay_read on payments for select using (user_id=auth.uid());
create policy run_read on verification_runs for select using (exists(select 1 from bots b where b.id=bot_id and b.creator_id=auth.uid()));
create policy fills_read on fills for select using (exists(select 1 from bots b where b.id=bot_id and b.creator_id=auth.uid()));
create policy eq_read on equity_snapshots for select using (exists(select 1 from bots b where b.id=bot_id and b.listed));
create policy conn_read on exchange_connections for select using (user_id=auth.uid());
create policy conn_del on exchange_connections for delete using (user_id=auth.uid());
revoke select on exchange_connections from anon,authenticated;
grant select(id,user_id,exchange,label,key_hint,last_checked_at,created_at) on exchange_connections to authenticated;
revoke insert,update on exchange_connections from anon,authenticated;

-- Moderation
create policy rep_admin_read on reports for select using (is_admin());
create policy rep_admin_upd on reports for update using (is_admin());
create policy bots_admin_read on bots for select using (is_admin());
create policy bots_admin_upd on bots for update using (is_admin());
create policy post_admin_del on posts for delete using (is_admin());
create policy rev_admin_del on reviews for delete using (is_admin());
drop policy post_ins on posts;
create policy post_ins on posts for insert with check (author_id=auth.uid() and system=false and not (select is_banned from profiles where id=auth.uid()));
drop policy bots_ins on bots;
create policy bots_ins on bots for insert with check (creator_id=auth.uid() and not (select is_banned from profiles where id=auth.uid()));
create function admin_set_ban(target uuid, banned boolean) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Not allowed'; end if; update profiles set is_banned=banned where id=target; end $$;
revoke execute on function admin_set_ban(uuid,boolean) from public,anon; grant execute on function admin_set_ban(uuid,boolean) to authenticated;
grant execute on function refresh_scores() to service_role;

-- Private bucket for bot code
insert into storage.buckets(id,name,public) values('bot-code','bot-code',false) on conflict do nothing;
create policy code_up on storage.objects for insert to authenticated with check (bucket_id='bot-code' and (storage.foldername(name))[1]=auth.uid()::text);
create policy code_read on storage.objects for select to authenticated using (bucket_id='bot-code' and (storage.foldername(name))[1]=auth.uid()::text);
