-- Renters may view the performance history and executed trades for bots they rent.
-- This does not expose bot code or exchange credentials.
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
