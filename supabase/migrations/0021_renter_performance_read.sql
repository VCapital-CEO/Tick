-- Performance cards: shareable images of a rental's or bot's result.
-- Every figure is computed here, in the database, from Tick's own records (snapshots and account state).
-- The page only draws what this function returns, and nothing about money can be typed in.
-- Each card is stored, so the short ID printed on the image can be checked at /#/card/<id>.

create table performance_cards(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references profiles on delete cascade,
 kind text not null check (kind in ('rental','bot')),
 rental_id uuid references rentals on delete set null,
 bot_id uuid references bots on delete set null,
 bot_name text not null,
 handle text,
 mode text not null check (mode in ('paper','live')),
 bot_verified boolean not null default false,
 initial numeric not null check (initial>0),
 equity numeric not null,
 cash numeric not null,
 position_value numeric not null,
 profit numeric not null,
 roi numeric not null,
 since timestamptz not null,
 days numeric not null,
 series jsonb not null default '[]',
 created_at timestamptz not null default now());
create index on performance_cards(user_id,created_at desc);
alter table performance_cards enable row level security;
-- Owners can list their own cards. Nobody can insert, change or delete one except through the function below.
create policy pc_owner_read on performance_cards for select using (user_id=auth.uid());
revoke insert,update,delete on performance_cards from authenticated,anon;

create function make_performance_card(p_rental uuid default null, p_bot uuid default null)
returns performance_cards language plpgsql security definer set search_path=public as $$
declare
 uid uuid:=auth.uid();
 r rentals; b bots; run verification_runs; pr profiles;
 v_mode text; v_initial numeric; v_equity numeric; v_cash numeric; v_since timestamptz; v_last timestamptz;
 v_series jsonb; v_n int; v_row performance_cards;
begin
 if uid is null then raise exception 'Sign in first'; end if;
 if (p_rental is null) = (p_bot is null) then raise exception 'Choose one rental or one bot'; end if;
 if (select count(*) from performance_cards where user_id=uid and created_at>now()-interval '1 day')>=30 then
  raise exception 'Card limit reached for today. Try again tomorrow.'; end if;
 select * into pr from profiles where id=uid;

 if p_rental is not null then
  select * into r from rentals where id=p_rental and renter_id=uid;
  if r.id is null then raise exception 'Rental not found'; end if;
  select * into b from bots where id=r.bot_id;
  if r.live then
   -- Live: starting money is what the renter allocated; the current value is the account value the worker recorded.
   v_mode:='live'; v_initial:=r.allocation_usd;
   v_equity:=nullif(r.live_state->>'eq','')::numeric; v_cash:=nullif(r.live_state->>'cash','')::numeric;
   v_since:=r.started_at;
   if v_initial is null or v_equity is null or v_cash is null then
    raise exception 'No live result has been recorded yet. Try again after the next update.'; end if;
   v_series:='[]'::jsonb;
  else
   v_mode:='paper'; v_initial:=coalesce(nullif(r.paper_state->>'capital','')::numeric,10000);
   v_cash:=nullif(r.paper_state->>'cash','')::numeric;
   select count(*),min(ts),max(ts) into v_n,v_since,v_last from rental_snapshots where rental_id=r.id;
   if v_n=0 or v_cash is null then raise exception 'No result has been recorded yet. The first one appears within the hour.'; end if;
   if r.paper_state->>'slot' is not null and (r.paper_state->>'slot')::timestamptz<>v_last then
    raise exception 'Results are updating. Try again in a minute.'; end if;
   select equity into v_equity from rental_snapshots where rental_id=r.id and ts=v_last;
   select coalesce(jsonb_agg(round(equity,2) order by ts),'[]') into v_series from (
    select equity,ts,row_number() over(order by ts) rn,count(*) over() c from rental_snapshots where rental_id=r.id) s
    where (rn-1)%greatest(1,ceil(c/48.0)::int)=0 or rn=c;
  end if;
 else
  select * into b from bots where id=p_bot and creator_id=uid;
  if b.id is null then raise exception 'Bot not found'; end if;
  select * into run from verification_runs where bot_id=b.id and paper_state is not null order by created_at desc limit 1;
  if run.id is null then raise exception 'This bot has no simulated run yet.'; end if;
  v_mode:='paper'; v_initial:=coalesce(nullif(run.paper_state->>'capital','')::numeric,10000);
  v_cash:=nullif(run.paper_state->>'cash','')::numeric;
  select count(*),min(ts),max(ts) into v_n,v_since,v_last from equity_snapshots where run_id=run.id;
  if v_n=0 or v_cash is null then raise exception 'No result has been recorded yet. The first one appears within the hour.'; end if;
  select equity into v_equity from equity_snapshots where run_id=run.id and ts=v_last;
  select coalesce(jsonb_agg(round(equity,2) order by ts),'[]') into v_series from (
   select equity,ts,row_number() over(order by ts) rn,count(*) over() c from equity_snapshots where run_id=run.id) s
   where (rn-1)%greatest(1,ceil(c/48.0)::int)=0 or rn=c;
 end if;

 insert into performance_cards(user_id,kind,rental_id,bot_id,bot_name,handle,mode,bot_verified,initial,equity,cash,position_value,profit,roi,since,days,series)
 values(uid,case when p_rental is not null then 'rental' else 'bot' end,p_rental,b.id,b.name,pr.handle,v_mode,b.verification='verified',
  round(v_initial,2),round(v_equity,2),round(v_cash,2),round(v_equity-v_cash,2),round(v_equity-v_initial,2),
  round((v_equity-v_initial)/v_initial*100,2),v_since,round(extract(epoch from (now()-v_since))/86400,1),v_series)
 returning * into v_row;
 return v_row;
end $$;
revoke all on function make_performance_card(uuid,uuid) from public,anon;
grant execute on function make_performance_card(uuid,uuid) to authenticated;

-- Anyone holding a card's ID can check the figures Tick recorded for it. No user ID or rental ID is returned.
create function card_verify(p_id uuid)
returns table(kind text,bot_name text,handle text,mode text,bot_verified boolean,initial numeric,equity numeric,position_value numeric,
 profit numeric,roi numeric,since timestamptz,days numeric,series jsonb,created_at timestamptz)
language sql security definer set search_path=public stable as $$
 select kind,bot_name,handle,mode,bot_verified,initial,equity,position_value,profit,roi,since,days,series,created_at
 from performance_cards where id=p_id $$;
revoke all on function card_verify(uuid) from public;
grant execute on function card_verify(uuid) to anon,authenticated;