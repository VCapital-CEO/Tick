-- Daily equity points for each bot's sparkline, shown on marketplace rows.
create or replace view bot_cards as
select b.id,b.slug,b.name,b.description,b.strategy,b.markets,b.price_cents,b.billing_period,b.verification,b.created_at,b.creator_id,
 p.handle creator_handle,p.display_name creator_name,p.color creator_color,p.relay_score creator_score,
 s.ret_90d,s.max_dd,s.sharpe,s.win_rate,coalesce(s.trades,0) trades,coalesce(s.days_live,0) days_live,
 r.avg_rating,coalesce(r.n,0) review_count,
 (select array_agg(round(x.e,2) order by x.d) from (
   select date_trunc('day',e.ts) d,(array_agg(e.equity order by e.ts desc))[1] e
   from equity_snapshots e where e.bot_id=b.id group by 1 order by 1 desc limit 30) x) as spark
from bots b join profiles p on p.id=b.creator_id
left join bot_stats s on s.bot_id=b.id
left join (select bot_id,avg(rating)::numeric(3,2) avg_rating,count(*) n from reviews group by bot_id) r on r.bot_id=b.id
where b.listed;
