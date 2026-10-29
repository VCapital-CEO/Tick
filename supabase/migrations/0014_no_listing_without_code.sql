-- A bot can never be listed without uploaded code, and creators can only list a bot whose code passed the checks.
alter table bots add constraint bots_listed_needs_code check (not listed or current_version_id is not null);

create or replace function guard_bot() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then new.verification := 'none'; new.code_check := 'pending'; new.code_check_notes := '{}';
  if coalesce(auth.role(),'') <> 'service_role' and new.listed then raise exception 'Upload code before listing a bot'; end if;
 elsif coalesce(auth.role(),'') <> 'service_role' then
  if new.verification <> old.verification then new.verification := old.verification; end if;
  new.code_check := old.code_check; new.code_check_notes := old.code_check_notes;
  if new.listed and not old.listed and (new.current_version_id is null or new.code_check not in ('passed','warned')) then
   raise exception 'Only bots whose code passed the checks can be listed'; end if;
 end if; return new; end $$;