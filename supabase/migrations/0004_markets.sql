-- Dynamic spot markets, synced from Binance by the worker.
create table markets(symbol text primary key, base text not null, quote text not null, step_size numeric, min_notional numeric,
 quote_volume_24h numeric not null default 0, tradable boolean not null default false, updated_at timestamptz not null default now());
create index on markets(tradable,quote_volume_24h desc);
alter table markets enable row level security;
create policy markets_read on markets for select using (true);
insert into markets(symbol,base,quote,quote_volume_24h,tradable) values
 ('BTC/USDT','BTC','USDT',1e9,true),('ETH/USDT','ETH','USDT',1e9,true),('SOL/USDT','SOL','USDT',1e8,true) on conflict do nothing;
insert into app_config values('min_market_volume_usd','1000000'),('max_markets_per_bot','10');

create function check_bot_markets() returns trigger language plpgsql security definer set search_path=public as $$
declare bad text;
begin
 if tg_op='UPDATE' and new.markets is not distinct from old.markets then return new; end if;
 if cardinality(new.markets)>(select value::int from app_config where key='max_markets_per_bot')
  then raise exception 'Up to % markets per bot',(select value from app_config where key='max_markets_per_bot'); end if;
 if cardinality(new.markets)<>(select count(distinct x) from unnest(new.markets) x) then raise exception 'Duplicate markets'; end if;
 select m into bad from unnest(new.markets) m where not exists(select 1 from markets where symbol=m and tradable) limit 1;
 if bad is not null then raise exception 'Market % is not available or too thinly traded',bad; end if;
 return new; end $$;
create trigger bots_markets before insert or update of markets on bots for each row execute function check_bot_markets();
