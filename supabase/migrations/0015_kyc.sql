-- Identity verification (KYC) through Stripe Identity. Tick stores only the result, never the documents.
alter table profiles add column kyc_status text not null default 'none' check (kyc_status in ('none','pending','verified','failed')),
 add column kyc_verified_at timestamptz;
-- users cannot edit these (column grants only cover handle, display_name, bio, color, email_alerts)

create table kyc_sessions(session_id text primary key, user_id uuid not null references profiles on delete cascade,
 status text not null default 'created', created_at timestamptz not null default now());
alter table kyc_sessions enable row level security; -- no policies: only the service role (edge functions) can read or write

-- Live trading with real money now also requires a verified identity.
create or replace function validate_live() returns trigger language plpgsql security definer set search_path=public as $$
declare cap numeric; flag text;
begin
 if not new.live then return new; end if;
 if tg_op='UPDATE' and old.live and new.allocation_usd is distinct from old.allocation_usd then raise exception 'Stop live trading before changing the allocation'; end if;
 if tg_op='UPDATE' and old.live and new.connection_id is not distinct from old.connection_id then return new; end if;
 if coalesce(auth.role(),'') <> 'service_role' and exists(select 1 from auth.mfa_factors f where f.user_id=new.renter_id and f.status='verified')
  and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'Confirm your two-factor code to start live trading'; end if;
 select value into flag from app_config where key='live_execution_enabled';
 if flag<>'true' then raise exception 'Live trading is not enabled on Tick yet'; end if;
 if not exists(select 1 from profiles where id=new.renter_id and kyc_status='verified') then raise exception 'Verify your identity before live trading'; end if;
 if new.connection_id is null or not exists(select 1 from exchange_connections where id=new.connection_id and user_id=new.renter_id) then raise exception 'Choose one of your exchange keys'; end if;
 if not exists(select 1 from bots where id=new.bot_id and verification='verified') then raise exception 'Only verified bots can trade live'; end if;
 select value::numeric into cap from app_config where key='max_live_allocation_usd';
 if new.allocation_usd is null or new.allocation_usd>cap then raise exception 'Allocation must be between 10 and % USDT',cap; end if;
 return new; end $$;

-- Service-only: records the outcome Stripe reports. A verified identity is never downgraded by a later failed attempt.
create or replace function set_kyc(p_user uuid, p_session text, p_status text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from kyc_sessions where session_id=p_session and user_id=p_user) then return; end if;
 update kyc_sessions set status=p_status where session_id=p_session;
 if p_status='verified' then update profiles set kyc_status='verified',kyc_verified_at=now() where id=p_user;
 elsif p_status in('pending','failed') then update profiles set kyc_status=p_status where id=p_user and kyc_status<>'verified';
 elsif p_status='canceled' then update profiles set kyc_status='none' where id=p_user and kyc_status in('pending','failed'); end if; end $$;
revoke execute on function set_kyc(uuid,text,text) from public,anon,authenticated;