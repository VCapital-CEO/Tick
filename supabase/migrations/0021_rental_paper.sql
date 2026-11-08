-- Every active rental runs its bot in paper mode for the renter, with its own simulated account.
alter table rentals add column paper_state jsonb;
create table rental_snapshots(
 rental_id uuid not null references rentals on delete cascade,
 ts timestamptz not null,
 equity numeric not null,
 primary key(rental_id,ts));
alter table rental_snapshots enable row level security;
create policy rs_read on rental_snapshots for select using (exists(select 1 from rentals r where r.id=rental_id and r.renter_id=auth.uid()));