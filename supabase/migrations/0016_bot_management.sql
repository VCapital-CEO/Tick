-- Verification is paid once per bot: later versions are re-verified at no cost.
alter table bots add column verification_paid boolean not null default false;
update bots set verification_paid=true where exists(select 1 from verification_runs r where r.bot_id=bots.id and r.fee_cents>0);

create or replace function guard_bot() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then new.verification := 'none'; new.code_check := 'pending'; new.code_check_notes := '{}'; new.verification_paid := false;
  if coalesce(auth.role(),'') <> 'service_role' and new.listed then raise exception 'Upload code before listing a bot'; end if;
 elsif coalesce(auth.role(),'') <> 'service_role' then
  if new.verification <> old.verification then new.verification := old.verification; end if;
  new.code_check := old.code_check; new.code_check_notes := old.code_check_notes; new.verification_paid := old.verification_paid;
  if new.listed and not old.listed and (new.current_version_id is null or new.code_check not in ('passed','warned')) then
   raise exception 'Only bots whose code passed the checks can be listed'; end if;
 end if; return new; end $$;

create or replace function start_verification_run(p_bot uuid, p_version uuid, p_fee int, p_payment uuid)
returns text language plpgsql security definer set search_path=public as $$
declare t uuid; ts text; days int;
begin
 if exists(select 1 from verification_runs where bot_id=p_bot and kind='verification' and state in('pending','running')) then return 'busy'; end if;
 update verification_runs set state='failed',result='{"reason":"Superseded"}' where bot_id=p_bot and kind='track' and state in('pending','running') and version_id<>p_version;
 select id,state::text into t,ts from verification_runs where bot_id=p_bot and kind='track' and state in('pending','running') order by created_at desc limit 1 for update;
 if p_fee>0 then update bots set verification_paid=true where id=p_bot; end if;
 if t is not null then
  select ((value)::jsonb->>'days')::int into days from app_config where key='verification_rules';
  update verification_runs set kind='verification',fee_cents=p_fee,payment_id=p_payment,ends_at=starts_at+make_interval(days=>coalesce(days,30)) where id=t;
  update bots set verification=case when ts='running' then 'running'::verify_state else 'pending'::verify_state end where id=p_bot; return 'converted';
 end if;
 insert into verification_runs(bot_id,version_id,fee_cents,payment_id) values(p_bot,p_version,p_fee,p_payment);
 update bots set verification='pending'::verify_state where id=p_bot; return 'queued'; end $$;
revoke execute on function start_verification_run(uuid,uuid,int,uuid) from public,anon,authenticated;

-- A bot with active renters cannot be deleted directly; delist it or wait for the rentals to end.
create function guard_bot_delete() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.role(),'') <> 'service_role' and exists(select 1 from rentals where bot_id=old.id and status='active') then
  raise exception 'This bot has active renters. Delist it instead, or wait until their rentals end'; end if;
 return old; end $$;
create trigger bots_delete_guard before delete on bots for each row execute function guard_bot_delete();

-- Accounts created with Google use their Google name.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare h text; nm text;
begin
 h := lower(regexp_replace(split_part(new.email,'@',1),'[^a-zA-Z0-9_]','','g'));
 if char_length(h)<3 then h := 'user'||h; end if;
 h := left(h,16)||'_'||substr(md5(random()::text),1,4);
 nm := left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)),40);
 insert into profiles(id,handle,display_name) values(new.id,h,nm);
 return new; end $$;