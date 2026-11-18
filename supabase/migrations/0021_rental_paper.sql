-- Renters may view the performance history for bots they rent.
-- (fills_renter_read already exists since 0003_live, so only equity is added here.)
-- This does not expose bot code or exchange credentials.
drop policy if exists fills_renter_read on fills;
create policy fills_renter_read on fills
  for select
  using (
    exists (
      select 1
      from rentals r
      where r.id = fills.rental_id
        and r.renter_id = auth.uid()
    )
  );

drop policy if exists eq_renter_read on equity_snapshots;
create policy eq_renter_read on equity_snapshots
  for select
  using (
    exists (
      select 1
      from rentals r
      where r.bot_id = equity_snapshots.bot_id
        and r.renter_id = auth.uid()
    )
  );