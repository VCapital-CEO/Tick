-- Notifications, follows, rate limits, worker lock, admin tools, safety nets.
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade,
 kind text not null, body text not null, link text, read boolean not null default false, created_at timestamptz not null default now());
create index on notifications(user_id,created_at desc);
alter table notifications enable row level security;
create policy n_read on notifications for select using (user_id=auth.uid());
create policy n_upd on notifications for update using (user_id=auth.uid());
revoke update on notifications from authenticated; grant update(read) on notifications to authenticated;
create function notify(u uuid,k text,b text,l text) returns void language sql security definer set search_path=public as $$
 insert into notifications(user_id,kind,body,link) values(u,k,b,l) $$;
revoke execute on function notify(uuid,text,text,text) from public,anon,authenticated;

create function t_bot_verif() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.verification is distinct from old.verification and new.verification in ('running','verified','failed') then
  perform notify(new.creator_id,'verification','Verification for '||new.name||': '||new.verification,'/bots/'||new.slug); end if;
 return new; end $$;
create trigger bots_notify after update on bots for each row execute function t_bot_verif();
create function t_review_new() returns trigger language plpgsql security definer set search_path=public as $$
declare b bots;
begin select * into b from bots where id=new.bot_id;
 perform notify(b.creator_id,'review',new.rating||' star review on '||b.name,'/bots/'||b.slug); return new; end $$;
create trigger reviews_notify after insert on reviews for each row execute function t_review_new();
create function t_live_stop() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.live and not new.live and new.paused_reason is not null then
  perform notify(new.renter_id,'live','Live trading stopped: '||new.paused_reason,null); end if;
 return new; end $$;
create trigger rentals_notify after update on rentals for each row execute function t_live_stop();

create function rate_limit() returns trigger language plpgsql security definer set search_path=public as $$
declare n int; who uuid := (row_to_json(new)->>tg_argv[1])::uuid;
begin
 execute format('select count(*) from %I where %I=$1 and created_at>now()-interval ''1 hour''',tg_table_name,tg_argv[1]) into n using who;
 if n>=tg_argv[0]::int then raise exception 'Slow down: too many % in the last hour',tg_table_name; end if;
 return new; end $$;
create trigger posts_rate before insert on posts for each row execute function rate_limit('10','author_id');
create trigger bots_rate before insert on bots for each row execute function rate_limit('10','creator_id');
create trigger reports_rate before insert on reports for each row execute function rate_limit('20','reporter_id');

create table follows(follower_id uuid references profiles on delete cascade, followee_id uuid references profiles on delete cascade,
 created_at timestamptz not null default now(), primary key(follower_id,followee_id), check(follower_id<>followee_id));
alter table follows enable row level security;
create policy fol_read on follows for select using (true);
create policy fol_ins on follows for insert with check (follower_id=auth.uid());
create policy fol_del on follows for delete using (follower_id=auth.uid());

-- Deleting an account must not be blocked by money or report records.
alter table payments drop constraint payments_user_id_fkey, alter column user_id drop not null,
 add constraint payments_user_id_fkey foreign key(user_id) references profiles on delete set null;
alter table reports drop constraint reports_reporter_id_fkey, alter column reporter_id drop not null,
 add constraint reports_reporter_id_fkey foreign key(reporter_id) references profiles on delete set null;

-- Never let a key be deleted while it still backs open positions.
create function t_conn_delete() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from rentals r where r.connection_id=old.id and (r.live or jsonb_path_exists(r.live_state,'$.pos.* ? (@.qty > 0)'))) then
  raise exception 'This key still backs a live rental or open positions. Stop live trading and wait for positions to be sold.'; end if;
 return old; end $$;
create trigger conn_guard before delete on exchange_connections for each row execute function t_conn_delete();

-- One worker at a time, plus a heartbeat.
create table worker_lock(id int primary key default 1 check(id=1), holder text not null, beat timestamptz not null default now());
alter table worker_lock enable row level security;
create policy wl_admin on worker_lock for select using (is_admin());
create function claim_worker(p_id text,p_ttl int) returns boolean language plpgsql security definer set search_path=public as $$
declare ok boolean;
begin
 insert into worker_lock(id,holder,beat) values(1,p_id,now())
 on conflict(id) do update set holder=excluded.holder,beat=now() where worker_lock.holder=p_id or worker_lock.beat<now()-make_interval(secs=>p_ttl);
 select holder=p_id into ok from worker_lock where id=1; return ok; end $$;
revoke execute on function claim_worker(text,int) from public,anon,authenticated; grant execute on function claim_worker(text,int) to service_role;

create table audit_log(id bigint generated always as identity primary key, actor uuid, action text not null, target text, created_at timestamptz not null default now());
alter table audit_log enable row level security;
create policy audit_admin on audit_log for select using (is_admin());
create or replace function admin_set_ban(target uuid,banned boolean) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Not allowed'; end if;
 update profiles set is_banned=banned where id=target;
 insert into audit_log(actor,action,target) values(auth.uid(),case when banned then 'ban' else 'unban' end,target::text); end $$;
create function admin_set_flag(k text,v text) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Not allowed'; end if;
 if k<>'live_execution_enabled' or v not in ('true','false') then raise exception 'Not allowed'; end if;
 update app_config set value=v where key=k;
 insert into audit_log(actor,action,target) values(auth.uid(),'set '||k||'='||v,k); end $$;
create function admin_stats() returns json language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Not allowed'; end if;
 return json_build_object('users',(select count(*) from profiles),'bots',(select count(*) from bots),'live',(select count(*) from rentals where live),
  'beat',(select beat from worker_lock),'live_enabled',(select value from app_config where key='live_execution_enabled')); end $$;
revoke execute on function admin_set_flag(text,text),admin_stats() from public,anon; grant execute on function admin_set_flag(text,text),admin_stats() to authenticated;

create function my_bot_rentals() returns table(bot_id uuid,active bigint,live bigint) language sql stable security definer set search_path=public as $$
 select b.id,count(r.id) filter (where r.status='active'),count(r.id) filter (where r.live) from bots b left join rentals r on r.bot_id=b.id where b.creator_id=auth.uid() group by b.id $$;
revoke execute on function my_bot_rentals() from public,anon; grant execute on function my_bot_rentals() to authenticated;
