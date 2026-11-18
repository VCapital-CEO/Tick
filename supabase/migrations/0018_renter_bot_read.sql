-- Let renters see the bot metadata attached to an existing rental even after
-- the creator delists the bot. This keeps My rentals usable without exposing
-- bot code or private creator data.
drop policy if exists bots_renter_read on bots;
create policy bots_renter_read on bots
  for select
  using (
    exists (
      select 1
      from rentals r
      where r.bot_id = bots.id
        and r.renter_id = auth.uid()
    )
  );