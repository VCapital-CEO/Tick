-- Recovery migration for installations where 0023/0024 were not fully applied.
-- Safe to run after a partial migration: objects are created idempotently.

create table if not exists post_reposts(
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create table if not exists post_impressions(
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create table if not exists post_bookmarks(
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create table if not exists post_shares(
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  first_shared_at timestamptz not null default now(),
  primary key(post_id,user_id)
);

create index if not exists post_reposts_post_idx on post_reposts(post_id);
create index if not exists post_impressions_post_idx on post_impressions(post_id);
create index if not exists post_bookmarks_post_idx on post_bookmarks(post_id);
create index if not exists post_shares_post_idx on post_shares(post_id);

alter table post_reposts enable row level security;
alter table post_impressions enable row level security;
alter table post_bookmarks enable row level security;
alter table post_shares enable row level security;

do $$ begin
  drop policy if exists repost_read on post_reposts;
  drop policy if exists repost_insert on post_reposts;
  drop policy if exists repost_delete on post_reposts;
  create policy repost_read on post_reposts for select using (true);
  create policy repost_insert on post_reposts for insert to authenticated with check (user_id=auth.uid());
  create policy repost_delete on post_reposts for delete to authenticated using (user_id=auth.uid());

  drop policy if exists impression_read on post_impressions;
  drop policy if exists impression_insert on post_impressions;
  create policy impression_read on post_impressions for select using (true);
  create policy impression_insert on post_impressions for insert to authenticated with check (user_id=auth.uid());

  drop policy if exists bookmark_read on post_bookmarks;
  drop policy if exists bookmark_insert on post_bookmarks;
  drop policy if exists bookmark_delete on post_bookmarks;
  create policy bookmark_read on post_bookmarks for select using (true);
  create policy bookmark_insert on post_bookmarks for insert to authenticated with check (user_id=auth.uid());
  create policy bookmark_delete on post_bookmarks for delete to authenticated using (user_id=auth.uid());

  drop policy if exists share_read on post_shares;
  drop policy if exists share_insert on post_shares;
  create policy share_read on post_shares for select using (true);
  create policy share_insert on post_shares for insert to authenticated with check (user_id=auth.uid());
end $$;

grant select on post_feed,post_reposts,post_impressions,post_bookmarks,post_shares to anon,authenticated;
grant insert,delete on post_reposts,post_bookmarks to authenticated;
grant insert on post_impressions,post_shares to authenticated;

-- Keep the original post_feed columns first and append the interaction columns.
create or replace view post_feed as
 select po.id,po.body,po.system,po.created_at,po.author_id,p.handle,p.display_name,p.color,
  (select count(*) from post_likes l where l.post_id=po.id) likes,
  po.group_id,g.slug group_slug,g.name group_name,
  (select count(*) from comments c where c.post_id=po.id) comments,
  po.media_url,po.media_type,p.avatar_url,
  (select count(*) from post_reposts r where r.post_id=po.id) reposts,
  (select count(*) from post_impressions i where i.post_id=po.id) impressions,
  (select count(*) from post_bookmarks b where b.post_id=po.id) bookmarks,
  (select count(*) from post_shares s where s.post_id=po.id) shares
 from posts po
 join profiles p on p.id=po.author_id
 left join groups g on g.id=po.group_id;

grant select on post_feed to anon,authenticated;

-- Public, completed sample backtests for listed bots. This exposes performance output,
-- never code, creator-only metadata, or private backtest controls.
create or replace view bot_public_backtests as
 select distinct on (bt.bot_id)
  bt.bot_id,bt.days,bt.result,bt.created_at
 from backtests bt
 join bots b on b.id=bt.bot_id
 where b.listed and bt.state='done' and bt.result is not null
 order by bt.bot_id,bt.created_at desc;
grant select on bot_public_backtests to anon,authenticated;

-- Live rental performance is intentionally separate from bot-wide paper/verification curves.
create table if not exists rental_snapshots(
  rental_id uuid not null references rentals on delete cascade,
  ts timestamptz not null,
  equity numeric not null,
  primary key(rental_id,ts)
);
create index if not exists rental_equity_ts_idx on rental_snapshots(rental_id,ts);
alter table rental_snapshots enable row level security;
do $$ begin
  drop policy if exists rental_snapshots_renter_read on rental_snapshots;
  create policy rental_snapshots_renter_read on rental_snapshots
    for select using (exists(select 1 from rentals r where r.id=rental_id and r.renter_id=auth.uid()));
end $$;
grant select on rental_snapshots to authenticated;
