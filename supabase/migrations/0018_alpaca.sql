-- Alpaca broker connections (OAuth). The access token is stored encrypted in api_key_enc; api_secret_enc holds a placeholder.
alter table exchange_connections drop constraint if exists exchange_connections_exchange_check;
alter table exchange_connections add constraint exchange_connections_exchange_check check (exchange in ('binance','alpaca'));
create table if not exists oauth_states(
 state text primary key,
 user_id uuid not null references profiles on delete cascade,
 created_at timestamptz not null default now());
alter table oauth_states enable row level security;
revoke all on oauth_states from anon, authenticated;
create unique index if not exists conn_alpaca_acct on exchange_connections(user_id,exchange,key_hint) where exchange='alpaca';