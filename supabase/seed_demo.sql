-- DEMO DATA, for looking at the interface only. Not real results.
-- Run in the Supabase SQL editor AFTER you have signed up once on the site (bots are assigned to your account).
-- Remove it later with:  delete from bots where slug like 'demo-%';
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);  -- lets this script set Verified
select setseed(0.42);

insert into bots(creator_id,slug,name,description,strategy,markets,price_cents,billing_period)
select p.id,v.slug,v.name,v.descr,v.strat,v.mk,v.price,v.per
from (select id from profiles order by created_at limit 1) p,
(values
 ('demo-ridge-runner','Ridge Runner','Follows multi-day breakouts on BTC and ETH with volatility-based stops.','trend',array['BTC/USDT','ETH/USDT'],7900,'month'),
 ('demo-tidepool-grid','Tidepool Grid','Places a grid inside a rolling range and widens it when volatility rises.','grid',array['ETH/USDT','SOL/USDT'],3900,'month'),
 ('demo-spreadline','Spreadline','Fades short-lived dislocations between correlated majors.','mean_reversion',array['BTC/USDT','ETH/USDT','SOL/USDT'],12900,'month'),
 ('demo-snapback','Snapback','Buys oversold dips on SOL using RSI and volume filters.','mean_reversion',array['SOL/USDT'],1900,'week'),
 ('demo-quickstep','Quickstep','Short-horizon momentum with a daily loss cap. Not verified yet.','momentum',array['BTC/USDT','SOL/USDT'],5900,'month'),
 ('demo-night-owl','Night Owl','Trades the quiet Asian session on ETH only.','other',array['ETH/USDT'],0,'month')
) as v(slug,name,descr,strat,mk,price,per);

update bots set verification='verified' where slug in ('demo-ridge-runner','demo-tidepool-grid','demo-spreadline','demo-snapback');

insert into bot_versions(bot_id,version,code_sha256,storage_path)
select id,1,'demo','demo/'||slug from bots where slug like 'demo-%';
update bots b set current_version_id=v.id from bot_versions v where v.bot_id=b.id and b.slug like 'demo-%';

insert into verification_runs(bot_id,version_id,state,starts_at,ends_at)
select b.id,b.current_version_id,'verified',now()-interval '60 days',now()-interval '30 days' from bots b where b.verification='verified' and b.slug like 'demo-%';

-- 30 days of hourly equity: a random walk with a per-bot drift
insert into equity_snapshots(bot_id,run_id,ts,equity)
select r.bot_id,r.id,t.ts,
 10000*exp(sum(ln(1+d.drift+(random()-0.5)*d.vol)) over (partition by r.id order by t.ts))
from verification_runs r
join bots b on b.id=r.bot_id
join (values ('demo-ridge-runner',0.00012,0.012),('demo-tidepool-grid',0.00008,0.008),('demo-spreadline',0.00005,0.004),('demo-snapback',0.00003,0.014)) d(slug,drift,vol) on d.slug=b.slug
cross join generate_series(date_trunc('hour',now())-interval '719 hours',date_trunc('hour',now()),interval '1 hour') t(ts)
where b.slug like 'demo-%';

insert into bot_stats(bot_id,ret_90d,max_dd,sharpe,win_rate,trades,days_live)
select bot_id,(last_eq/first_eq-1)*100,max_dd*100,case when sd>0 then mean/sd*sqrt(24*365) else 0 end,52+random()*20,60+(random()*200)::int,30
from (
 select bot_id,
  (array_agg(equity order by ts))[1] first_eq,(array_agg(equity order by ts desc))[1] last_eq,
  max((pk-equity)/pk) max_dd,avg(r) mean,stddev_samp(r) sd
 from (
  select bot_id,ts,equity,max(equity) over (partition by bot_id order by ts) pk,
   equity/lag(equity) over (partition by bot_id order by ts)-1 r
  from equity_snapshots where bot_id in (select id from bots where slug like 'demo-%')
 ) x group by bot_id
) s;

insert into posts(author_id,body,system)
select id,'Demo: Ridge Runner passed verification.',true from profiles order by created_at limit 1;
insert into posts(author_id,body,system)
select id,'Demo: welcome to Relay. These bots and numbers are sample data.',false from profiles order by created_at limit 1;

select refresh_scores();
commit;
