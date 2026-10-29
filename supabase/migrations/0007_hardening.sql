-- Live-trading limits, code-similarity flags, support, error log, 2FA gate.
alter table rentals add column max_drawdown_pct numeric not null default 20 check (max_drawdown_pct between 5 and 80),
 add column stop_loss_pct numeric check (stop_loss_pct is null or stop_loss_pct between 1 and 50);
grant update(max_drawdown_pct,stop_loss_pct) on rentals to authenticated;
alter table bot_versions add column fingerprint int[];
alter table profiles add column stripe_customer_id text;

create table code_flags(id uuid primary key default gen_random_uuid(), bot_id uuid not null references bots on delete cascade,
 other_bot_id uuid not null references bots on delete cascade, similarity numeric not null, state text not null default 'open' check (state in ('open','dismissed')), created_at timestamptz not null default now());
alter table code_flags enable row level security;
create policy flag_admin on code_flags for all using (is_admin()) with check (is_admin());

create table error_log(id bigint generated always as identity primary key, source text not null check (source in ('client','worker','function')),
 message text not null check (char_length(message)<=500), detail text, user_id uuid, created_at timestamptz not null default now());
alter table error_log enable row level security;
create policy err_admin on error_log for select using (is_admin());
create policy err_ins on error_log for insert to authenticated with check (source='client' and user_id=auth.uid());
create trigger errors_rate before insert on error_log for each row execute function rate_limit('30','user_id');

create table support_tickets(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade,
 subject text not null check (char_length(subject) between 3 and 120), message text not null check (char_length(message) between 5 and 2000),
 state text not null default 'open' check (state in ('open','closed')), created_at timestamptz not null default now());
alter table support_tickets enable row level security;
create policy tk_ins on support_tickets for insert with check (user_id=auth.uid());
create policy tk_read on support_tickets for select using (user_id=auth.uid() or is_admin());
create policy tk_upd on support_tickets for update using (is_admin());
create trigger tickets_rate before insert on support_tickets for each row execute function rate_limit('5','user_id');

create or replace function validate_live() returns trigger language plpgsql security definer set search_path=public as $$
declare cap numeric; flag text;
begin
 if not new.live then return new; end if;
 if tg_op='UPDATE' and old.live and new.allocation_usd is distinct from old.allocation_usd then raise exception 'Stop live trading before changing the allocation'; end if;
 if tg_op='UPDATE' and old.live and new.connection_id is not distinct from old.connection_id then return new; end if;
 if coalesce(auth.role(),'')<>'service_role' and exists(select 1 from auth.mfa_factors f where f.user_id=new.renter_id and f.status='verified')
  and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'Confirm your two-factor code to start live trading'; end if;
 select value into flag from app_config where key='live_execution_enabled';
 if flag<>'true' then raise exception 'Live trading is not enabled on Relay yet'; end if;
 if new.connection_id is null or not exists(select 1 from exchange_connections where id=new.connection_id and user_id=new.renter_id) then raise exception 'Choose one of your exchange keys'; end if;
 if not exists(select 1 from bots where id=new.bot_id and verification='verified') then raise exception 'Only verified bots can trade live'; end if;
 select value::numeric into cap from app_config where key='max_live_allocation_usd';
 if new.allocation_usd is null or new.allocation_usd>cap then raise exception 'Allocation must be between 10 and % USDT',cap; end if;
 return new; end $$;
