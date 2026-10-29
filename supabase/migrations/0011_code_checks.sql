-- Numbered 0011 because the live project already has 0009 (advisor fixes) and 0010 (performance).
-- Code checks: every uploaded version is scanned, probed and backtested by the worker before it can be verified.
alter table bot_versions
 add column check_state text not null default 'pending' check (check_state in ('pending','running','passed','warned','failed')),
 add column check_report jsonb,
 add column checked_at timestamptz;
alter table bots
 add column code_check text not null default 'pending' check (code_check in ('pending','running','passed','warned','failed')),
 add column code_check_notes text[] not null default '{}';

-- Only the service role (the worker) may set check results; creators cannot edit them.
create or replace function guard_bot() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then new.verification := 'none'; new.code_check := 'pending'; new.code_check_notes := '{}';
 elsif coalesce(auth.role(),'') <> 'service_role' then
  if new.verification <> old.verification then new.verification := old.verification; end if;
  new.code_check := old.code_check; new.code_check_notes := old.code_check_notes;
 end if; return new; end $$;

-- Public cards show only the status and short labels; full findings stay with the creator and admins.
create or replace view bot_cards with (security_invoker=true) as
select b.id,b.slug,b.name,b.description,b.strategy,b.markets,b.price_cents,b.billing_period,b.verification,b.created_at,b.creator_id,
 p.handle creator_handle,p.display_name creator_name,p.color creator_color,p.relay_score creator_score,
 s.ret_90d,s.max_dd,s.sharpe,s.win_rate,coalesce(s.trades,0) trades,coalesce(s.days_live,0) days_live,
 r.avg_rating,coalesce(r.n,0) review_count,
 (select array_agg(round(x.e,2) order by x.d) from (
   select date_trunc('day',e.ts) d,(array_agg(e.equity order by e.ts desc))[1] e
   from equity_snapshots e where e.bot_id=b.id group by 1 order by 1 desc limit 30) x) as spark,
 b.code_check,b.code_check_notes
from bots b join profiles p on p.id=b.creator_id
left join bot_stats s on s.bot_id=b.id
left join (select bot_id,avg(rating)::numeric(3,2) avg_rating,count(*) n from reviews group by bot_id) r on r.bot_id=b.id
where b.listed;
grant select on bot_cards to anon,authenticated;

-- Admins can read reports and send a version back through the checks.
create policy ver_admin_read on bot_versions for select using (is_admin());
create function admin_recheck_version(p_version uuid) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Not allowed'; end if;
 update bot_versions set check_state='pending',check_report=null,checked_at=null where id=p_version; end $$;
revoke execute on function admin_recheck_version(uuid) from public,anon; grant execute on function admin_recheck_version(uuid) to authenticated;

-- Verification costs $5 (500 cents).
update app_config set value='500' where key='verification_fee_cents';