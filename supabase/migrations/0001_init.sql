-- Relay core schema. Run in the Supabase SQL editor (or `supabase db push`).
create extension if not exists citext;
create table app_config(key text primary key, value text not null);
insert into app_config values('min_review_days','0'),('payments_enabled','false');

create table profiles(
 id uuid primary key references auth.users on delete cascade,
 handle citext unique not null check (handle ~ '^[a-z0-9_]{3,24}$'),
 display_name text not null check (char_length(display_name) between 1 and 40),
 bio text not null default '' check (char_length(bio)<=140),
 color text not null default '#7c8cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
 relay_score smallint, created_at timestamptz not null default now());

create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare h text;
begin
 h := lower(regexp_replace(split_part(new.email,'@',1),'[^a-zA-Z0-9_]','','g'));
 if char_length(h)<3 then h := 'user'||h; end if;
 h := left(h,16)||'_'||substr(md5(random()::text),1,4);
 insert into profiles(id,handle,display_name) values(new.id,h,left(split_part(new.email,'@',1),40));
 return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create type verify_state as enum('none','pending','running','verified','failed');
create table bots(
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references profiles on delete cascade,
 slug citext unique not null,
 name text not null check (char_length(name) between 2 and 40),
 description text not null default '' check (char_length(description)<=600),
 strategy text not null check (strategy in ('trend','mean_reversion','grid','arbitrage','momentum','other')),
 markets text[] not null check (cardinality(markets)>0),
 price_cents int not null check (price_cents>=0),
 billing_period text not null check (billing_period in ('week','month')),
 listed boolean not null default true,
 verification verify_state not null default 'none',
 created_at timestamptz not null default now());
create index on bots using gin(markets);
create index on bots(creator_id);

create function guard_bot() returns trigger language plpgsql as $$
begin
 if tg_op='INSERT' then new.verification := 'none';
 elsif new.verification <> old.verification and coalesce(auth.role(),'') <> 'service_role' then new.verification := old.verification;
 end if; return new; end $$;
create trigger bots_guard before insert or update on bots for each row execute function guard_bot();

-- Written only by the worker (service role). Empty until the worker exists.
create table bot_stats(bot_id uuid primary key references bots on delete cascade,
 ret_90d numeric, max_dd numeric, sharpe numeric, win_rate numeric,
 trades int not null default 0, days_live int not null default 0, updated_at timestamptz not null default now());

create type rental_status as enum('active','cancelled');
create table rentals(
 id uuid primary key default gen_random_uuid(),
 bot_id uuid not null references bots on delete cascade,
 renter_id uuid not null references profiles on delete cascade,
 status rental_status not null default 'active',
 price_cents int not null, billing_period text not null,
 started_at timestamptz not null default now(), unique(bot_id,renter_id));
create function lock_rental() returns trigger language plpgsql security definer set search_path=public as $$
declare b bots;
begin
 select * into b from bots where id=new.bot_id and listed;
 if b.id is null then raise exception 'Bot not found'; end if;
 if b.creator_id=new.renter_id then raise exception 'You cannot rent your own bot'; end if;
 new.price_cents := b.price_cents; new.billing_period := b.billing_period;
 return new; end $$;
create trigger rentals_lock before insert on rentals for each row execute function lock_rental();

create table reviews(
 id uuid primary key default gen_random_uuid(),
 bot_id uuid not null references bots on delete cascade,
 rental_id uuid not null unique references rentals on delete cascade,
 reviewer_id uuid not null references profiles on delete cascade,
 rating smallint not null check (rating between 1 and 5),
 body text not null check (char_length(body) between 1 and 400),
 created_at timestamptz not null default now());
create index on reviews(bot_id);

create table posts(
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references profiles on delete cascade,
 body text not null check (char_length(body) between 1 and 280),
 system boolean not null default false,
 created_at timestamptz not null default now());
create index on posts(created_at desc);
create table post_likes(post_id uuid references posts on delete cascade, user_id uuid references profiles on delete cascade, primary key(post_id,user_id));
create table reports(id uuid primary key default gen_random_uuid(), reporter_id uuid not null references profiles,
 target_type text not null check (target_type in ('bot','post','review','profile')), target_id uuid not null,
 reason text not null check (char_length(reason)<=500), created_at timestamptz not null default now());

-- Public read models
create view bot_cards as
select b.id,b.slug,b.name,b.description,b.strategy,b.markets,b.price_cents,b.billing_period,b.verification,b.created_at,b.creator_id,
 p.handle creator_handle,p.display_name creator_name,p.color creator_color,p.relay_score creator_score,
 s.ret_90d,s.max_dd,s.sharpe,s.win_rate,coalesce(s.trades,0) trades,coalesce(s.days_live,0) days_live,
 r.avg_rating,coalesce(r.n,0) review_count
from bots b join profiles p on p.id=b.creator_id
left join bot_stats s on s.bot_id=b.id
left join (select bot_id,avg(rating)::numeric(3,2) avg_rating,count(*) n from reviews group by bot_id) r on r.bot_id=b.id
where b.listed;
create view post_feed as
select po.id,po.body,po.system,po.created_at,po.author_id,p.handle,p.display_name,p.color,
 (select count(*) from post_likes l where l.post_id=po.id) likes
from posts po join profiles p on p.id=po.author_id;
grant select on bot_cards,post_feed to anon,authenticated;

-- Relay score: 50% smoothed rating, 30% verified share, 20% live record. Call nightly (pg_cron or the worker).
create function refresh_scores() returns void language sql security definer set search_path=public as $$
 update profiles p set relay_score=sub.score from (
  select b.creator_id, round(100*(0.5*coalesce(rt.r,0.7)
   +0.3*(count(*) filter (where b.verification='verified'))::numeric/count(*)
   +0.2*least(1,coalesce(avg(s.days_live),0)/200.0)))::smallint score
  from bots b left join bot_stats s on s.bot_id=b.id
  left join lateral (select (sum(rv.rating)+3.5*5)/(count(*)+5)/5 r from reviews rv join bots bb on bb.id=rv.bot_id where bb.creator_id=b.creator_id) rt on true
  where b.listed group by b.creator_id,rt.r) sub
 where p.id=sub.creator_id;
$$;
revoke execute on function refresh_scores() from public,anon,authenticated;
-- Optional (enable pg_cron first): select cron.schedule('relay-scores','0 3 * * *','select refresh_scores()');

-- Row-level security
alter table app_config enable row level security; alter table profiles enable row level security;
alter table bots enable row level security; alter table bot_stats enable row level security;
alter table rentals enable row level security; alter table reviews enable row level security;
alter table posts enable row level security; alter table post_likes enable row level security;
alter table reports enable row level security;
create policy cfg_read on app_config for select using (true);
create policy prof_read on profiles for select using (true);
create policy prof_upd on profiles for update using (id=auth.uid()) with check (id=auth.uid());
revoke update on profiles from authenticated; grant update(handle,display_name,bio,color) on profiles to authenticated;
create policy bots_read on bots for select using (listed or creator_id=auth.uid());
create policy bots_ins on bots for insert with check (creator_id=auth.uid());
create policy bots_upd on bots for update using (creator_id=auth.uid()) with check (creator_id=auth.uid());
create policy bots_del on bots for delete using (creator_id=auth.uid());
create policy stats_read on bot_stats for select using (true);
create policy rent_read on rentals for select using (renter_id=auth.uid());
create policy rent_ins on rentals for insert with check (renter_id=auth.uid());
create policy rent_upd on rentals for update using (renter_id=auth.uid()) with check (renter_id=auth.uid());
revoke update on rentals from authenticated; grant update(status) on rentals to authenticated;
create policy rev_read on reviews for select using (true);
create policy rev_ins on reviews for insert with check (reviewer_id=auth.uid() and exists(
 select 1 from rentals r where r.id=rental_id and r.renter_id=auth.uid() and r.bot_id=reviews.bot_id
 and r.started_at <= now() - ((select value from app_config where key='min_review_days')||' days')::interval));
create policy rev_upd on reviews for update using (reviewer_id=auth.uid());
create policy rev_del on reviews for delete using (reviewer_id=auth.uid());
create policy post_read on posts for select using (true);
create policy post_ins on posts for insert with check (author_id=auth.uid() and system=false);
create policy post_del on posts for delete using (author_id=auth.uid());
create policy like_read on post_likes for select using (true);
create policy like_ins on post_likes for insert with check (user_id=auth.uid());
create policy like_del on post_likes for delete using (user_id=auth.uid());
create policy rep_ins on reports for insert with check (reporter_id=auth.uid());
