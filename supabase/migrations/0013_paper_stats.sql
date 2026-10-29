-- Free paper run for every listed bot, with stats labelled by where they came from.
-- source: 'paper' = free paper-trading run, 'verified' = paper run on a bot that has paid for verification,
--         'live' = real trades while rented (written by the broker layer, later).
alter table bot_stats add column source text not null default 'paper' check (source in ('paper','verified','live'));

create or replace view bot_cards with (security_invoker=true) as
select b.id,b.slug,b.name,b.description,b.strategy,b.markets,b.price_cents,b.billing_period,b.verification,b.created_at,b.creator_id,
 p.handle creator_handle,p.display_name creator_name,p.color creator_color,p.relay_score creator_score,
 s.ret_90d,s.max_dd,s.sharpe,s.win_rate,coalesce(s.trades,0) trades,coalesce(s.days_live,0) days_live,
 r.avg_rating,coalesce(r.n,0) review_count,
 (select array_agg(round(x.e,2) order by x.d) from (
   select date_trunc('day',e.ts) d,(array_agg(e.equity order by e.ts desc))[1] e
   from equity_snapshots e where e.bot_id=b.id group by 1 order by 1 desc limit 30) x) as spark,
 b.code_check,b.code_check_notes,
 coalesce(s.source,'paper') stats_source
from bots b join profiles p on p.id=b.creator_id
left join bot_stats s on s.bot_id=b.id
left join (select bot_id,avg(rating)::numeric(3,2) avg_rating,count(*) n from reviews group by bot_id) r on r.bot_id=b.id
where b.listed;
grant select on bot_cards to anon,authenticated;

-- Starting verification reuses the bot's running paper record instead of throwing it away.
-- Service role only (called by start-verification and the payments webhook).
create or replace function start_verification_run(p_bot uuid, p_version uuid, p_fee int, p_payment uuid)
returns text language plpgsql security definer set search_path=public as $$
declare t uuid; ts text; days int;
begin
 if exists(select 1 from verification_runs where bot_id=p_bot and kind='verification' and state in('pending','running')) then return 'busy'; end if;
 -- only one run per bot may be active, so a paper run on an older version is closed first
 update verification_runs set state='failed',result='{"reason":"Superseded"}' where bot_id=p_bot and kind='track' and state in('pending','running') and version_id<>p_version;
 select id,state::text into t,ts from verification_runs where bot_id=p_bot and kind='track' and state in('pending','running') order by created_at desc limit 1 for update;
 if t is not null then
  select ((value)::jsonb->>'days')::int into days from app_config where key='verification_rules';
  update verification_runs set kind='verification',fee_cents=p_fee,payment_id=p_payment,ends_at=starts_at+make_interval(days=>coalesce(days,30)) where id=t;
  update bots set verification=case when ts='running' then 'running'::verify_state else 'pending'::verify_state end where id=p_bot; return 'converted';
 end if;
 insert into verification_runs(bot_id,version_id,fee_cents,payment_id) values(p_bot,p_version,p_fee,p_payment);
 update bots set verification='pending'::verify_state where id=p_bot; return 'queued'; end $$;
revoke execute on function start_verification_run(uuid,uuid,int,uuid) from public,anon,authenticated;