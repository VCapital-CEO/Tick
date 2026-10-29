-- Live execution on renters' own exchange accounts. Off by default.
alter table rentals
 add column connection_id uuid references exchange_connections on delete set null,
 add column live boolean not null default false,
 add column allocation_usd numeric check (allocation_usd is null or allocation_usd>=10),
 add column max_daily_loss_pct numeric not null default 5 check (max_daily_loss_pct between 1 and 50),
 add column live_state jsonb not null default '{}',
 add column paused_reason text;
alter table fills add column rental_id uuid references rentals on delete set null, add column exchange_order_id text;
create index on fills(rental_id);
insert into app_config values('live_execution_enabled','false'),('max_live_allocation_usd','100');

create function validate_live() returns trigger language plpgsql security definer set search_path=public as $$
declare cap numeric; flag text;
begin
 if not new.live then return new; end if;
 if tg_op='UPDATE' and old.live and new.allocation_usd is distinct from old.allocation_usd then
  raise exception 'Stop live trading before changing the allocation'; end if;
 if tg_op='UPDATE' and old.live and new.connection_id is not distinct from old.connection_id then return new; end if;
 select value into flag from app_config where key='live_execution_enabled';
 if flag<>'true' then raise exception 'Live trading is not enabled on Relay yet'; end if;
 if new.connection_id is null or not exists(select 1 from exchange_connections where id=new.connection_id and user_id=new.renter_id)
  then raise exception 'Choose one of your exchange keys'; end if;
 if not exists(select 1 from bots where id=new.bot_id and verification='verified') then raise exception 'Only verified bots can trade live'; end if;
 select value::numeric into cap from app_config where key='max_live_allocation_usd';
 if new.allocation_usd is null or new.allocation_usd>cap then raise exception 'Allocation must be between 10 and % USDT', cap; end if;
 return new; end $$;
create trigger rentals_live before insert or update on rentals for each row execute function validate_live();

-- Renters may only touch these columns; live_state is worker-owned.
revoke insert,update on rentals from authenticated;
grant insert(bot_id,renter_id) on rentals to authenticated;
grant update(status,connection_id,live,allocation_usd,max_daily_loss_pct,paused_reason) on rentals to authenticated;
create policy fills_renter_read on fills for select using (exists(select 1 from rentals r where r.id=rental_id and r.renter_id=auth.uid()));
