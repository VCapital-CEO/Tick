-- Billing, comments, review replies, ongoing tracking, backtests, email alerts.
alter table profiles add column stripe_account_id text, add column payouts_enabled boolean not null default false, add column email_alerts boolean not null default true;
grant update(email_alerts) on profiles to authenticated;
alter table rentals add column stripe_subscription_id text unique, add column cancel_at_period_end boolean not null default false;
insert into app_config values('platform_fee_pct','15');

create or replace function lock_rental() returns trigger language plpgsql security definer set search_path=public as $$
declare b bots;
begin
 select * into b from bots where id=new.bot_id and listed;
 if b.id is null then raise exception 'Bot not found'; end if;
 if b.creator_id=new.renter_id then raise exception 'You cannot rent your own bot'; end if;
 if b.price_cents>0 and (select value from app_config where key='payments_enabled')='true' and coalesce(auth.role(),'')<>'service_role'
  then raise exception 'Paid bots are rented through checkout'; end if;
 new.price_cents := b.price_cents; new.billing_period := b.billing_period;
 return new; end $$;
create function t_rental_guard() returns trigger language plpgsql as $$
begin
 if old.stripe_subscription_id is not null and coalesce(auth.role(),'')<>'service_role'
  and (new.status is distinct from old.status or new.stripe_subscription_id is distinct from old.stripe_subscription_id) then
  raise exception 'Use the Cancel button. Access for paid rentals ends with the billing period'; end if;
 return new; end $$;
create trigger rentals_guard before update on rentals for each row execute function t_rental_guard();

create table comments(id uuid primary key default gen_random_uuid(), post_id uuid not null references posts on delete cascade,
 author_id uuid not null references profiles on delete cascade, body text not null check (char_length(body) between 1 and 280), created_at timestamptz not null default now());
create index on comments(post_id,created_at);
alter table comments enable row level security;
create policy cm_read on comments for select using (true);
create policy cm_ins on comments for insert with check (author_id=auth.uid() and not (select is_banned from profiles where id=auth.uid()));
create policy cm_del on comments for delete using (author_id=auth.uid() or is_admin());
create trigger comments_rate before insert on comments for each row execute function rate_limit('30','author_id');

alter table reviews add column reply text check (char_length(reply)<=400);
create function t_review_edit() returns trigger language plpgsql security definer set search_path=public as $$
declare cr uuid;
begin
 if coalesce(auth.role(),'')='service_role' then return new; end if;
 select creator_id into cr from bots where id=new.bot_id;
 if new.reply is distinct from old.reply and auth.uid() is distinct from cr then new.reply:=old.reply; end if;
 if (new.rating is distinct from old.rating or new.body is distinct from old.body) and auth.uid() is distinct from old.reviewer_id then new.rating:=old.rating; new.body:=old.body; end if;
 return new; end $$;
create trigger reviews_edit before update on reviews for each row execute function t_review_edit();
create policy rev_reply on reviews for update using (exists(select 1 from bots b where b.id=bot_id and b.creator_id=auth.uid()));

alter table verification_runs add column kind text not null default 'verification' check (kind in ('verification','track'));
alter table notifications add column emailed boolean not null default false;

create table backtests(id uuid primary key default gen_random_uuid(), bot_id uuid not null references bots on delete cascade,
 creator_id uuid not null references profiles on delete cascade, days int not null check (days between 7 and 90),
 state text not null default 'pending' check (state in ('pending','running','done','failed')), result jsonb, error text, created_at timestamptz not null default now());
create index on backtests(bot_id,created_at desc);
alter table backtests enable row level security;
create policy bt_read on backtests for select using (creator_id=auth.uid());
create policy bt_ins on backtests for insert with check (creator_id=auth.uid() and exists(select 1 from bots b where b.id=bot_id and b.creator_id=auth.uid() and b.current_version_id is not null));
revoke update,delete on backtests from authenticated;
create trigger backtests_rate before insert on backtests for each row execute function rate_limit('5','creator_id');
