# Relay

Marketplace for trading bots. Static site on Firebase Hosting, Supabase for database, accounts and security rules.

## Set up
1. Create a free Supabase project. In the SQL editor, run `supabase/migrations/0001_init.sql`.
2. In Supabase Authentication settings, turn email confirmation off while testing.
3. Put your project URL and anon key in `public/config.js`. Never use the service_role key there.
4. `npm i -g firebase-tools && firebase login && firebase init hosting` (public directory `public`, single-page app: yes, do not overwrite index.html), then `firebase deploy`.
5. Search Console: add your site as a property, verify it, then run `node scripts/build-seo.mjs` (needs Node 18+) and redeploy. Submit `/sitemap.xml`. Re-run on a schedule.
6. Optional nightly scores: enable pg_cron in Supabase and run the `cron.schedule` line commented in the migration.

## Built
Accounts, profiles, marketplace search and filters, bot listings, free-beta rentals, reviews (one per rental), feed with likes, Relay score function, row-level security, SEO build script.

## Not built yet
- Worker: runs bots, records fills, computes `bot_stats`, runs verification. Until then stats show "No live record yet".
- Edge Functions: paid verification, exchange API key vault, payments webhook.
- Code upload and sandboxing, moderation tools, report review screen.

Untested against a live project: run the migration first and fix any errors before building further.

## Worker, functions and moderation (added)
1. Run `supabase/migrations/0002_worker.sql` after 0001.
2. Make yourself admin: `update profiles set is_admin=true where handle='your_handle';`
3. Deploy functions: `supabase functions deploy start-verification register-version exchange-keys` and `supabase functions deploy payments-webhook --no-verify-jwt`.
4. Set secrets: `supabase secrets set SITE_URL=https://yoursite KEY_ENCRYPTION_SECRET=$(openssl rand -base64 32)`. For payments also set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, point a Stripe webhook at the payments-webhook URL for `checkout.session.completed`, then `update app_config set value='true' where key='payments_enabled';` only after moving off any plan that bars commercial use and getting legal advice.
5. Worker (needs Docker and Node 18+): `docker build -t relay-sandbox worker/sandbox`, then `cd worker && npm i && SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm start`. The service role key stays on the worker host only.

### How verification works
Creator uploads a `.py` with `decide(candles, markets)` returning target exposure from -1 to 1 per market. Each hour the worker runs it in a locked-down container (no network, 256 MB, 0.5 CPU, read-only, all capabilities dropped) on real Binance hourly candles and fills it in a 10,000 USDT paper account with fees and slippage. After 30 days it checks the rules in `app_config.verification_rules`.

### Known limits
- Paper trading only. Live execution on renters' exchange accounts is not built; the key vault stores validated, encrypted Binance keys but nothing uses them yet.
- Paper engine supports BTC/USDT, ETH/USDT and SOL/USDT. Perp futures and Altcoin basket bots are rejected at run time.
- Stats cover the verification run and stop updating when it ends.
- Docker isolation is not a perfect boundary for hostile code. Before opening uploads to strangers, run the worker on a dedicated machine with no secrets besides its own key, and consider gVisor or Firecracker.
- Untested against live services. Expect to fix small errors on first run.

## Live execution (0003)
Run `supabase/migrations/0003_live.sql`. Set `KEY_ENCRYPTION_SECRET` (the same value as the Edge Functions) in the worker environment, and install `live.js` next to `index.js`.

Live trading is **off** until you run `update app_config set value='true' where key='live_execution_enabled';`. Turn it off the same way to halt: the worker then sells every live position and stops those rentals within 10 minutes. Raise `max_live_allocation_usd` (default 100) only after real testing.

How it works: a renter saves a Binance key (Relay checks that withdrawals and transfers are off), picks an allocation and a daily loss limit, and starts live trading on a verified bot. Each hour the worker runs the verified code, then places spot market orders for only that rental's tracked share of the allocation. It never touches other holdings. A daily loss hit, a rental ending, a bot losing verified status, a halt, or three errors in a row all sell the rental's positions and stop it.

Limits: spot long-only on BTC, ETH and SOL against USDT (bots' short signals are treated as flat). Fees paid in BNB are not counted. If the key has an IP allowlist, add the worker's IP. Run a single worker instance. Start with your own account and small amounts.

## Dynamic markets (0004)
Run `supabase/migrations/0004_markets.sql`, copy `worker/markets.js` next to `index.js`, and restart the worker. It syncs every Binance spot USDT pair every 6 hours, marks a pair tradable only if its 24h volume is at least `min_market_volume_usd` (default 1,000,000), and bots can pick up to `max_markets_per_bot` (default 10). Paper-trade slippage grows with order size relative to a market's 24h volume. Existing bots that listed "Perp futures" or "Altcoin basket" keep their old values but cannot be verified until edited to real markets.

## Testing before real money
1. Create a free Binance spot testnet account at testnet.binance.vision and generate an API key (it holds fake funds).
2. Set the function secret `supabase secrets set BINANCE_TESTNET=true` and redeploy `exchange-keys` (testnet keys cannot be permission-checked). Remove that secret before launch.
3. Start the worker against the testnet: `BINANCE_BASE=https://testnet.binance.vision MIN_VOLUME_USD=0 TICK_MS=60000 KEY_ENCRYPTION_SECRET=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm start`. Wait for the first "synced N markets" line.
4. In another terminal, from `worker/`: `SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... TESTNET_KEY=... TESTNET_SECRET=... node smoke.mjs`. Leave the testnet variables out to skip the live part.
The script creates two throwaway users, lists and verifies a test bot with a short run, rents it, tries to break the security rules, optionally places a real testnet order and sells it again, then deletes everything it made. `examples/sma_cross.py` shows the bot contract.

## Dashboards and extras (0005)
Run `0005_features.sql` and deploy `delete-account`. Adds: equity and drawdown charts plus trade history on bot pages, creator dashboard (My bots), renter dashboard (My rentals), alerts, follows and a Following feed, password reset and settings, account deletion, hourly rate limits on posts, bots and reports, a single-worker lock with heartbeat (set `WORKER_ID` per machine), position reconciliation for live rentals, a guard that blocks deleting a key that backs open positions, an admin panel with stats, worker health, an audit log and a live-trading kill switch, and Open Graph tags.

Still not built: rental billing and creator payouts, legal pages, comments, backtester, ongoing paper trading after verification, other exchanges, email alerts, automated tests.

## Billing, backtests, email, tests (0006)
Run `0006_missing.sql`, deploy `connect-onboard`, `rental-checkout`, `cancel-rental` and redeploy `payments-webhook` and `register-version` and `start-verification`. Deploy `worker-watchdog --no-verify-jwt`.

**Rental billing (Stripe Connect, destination charges).** Paid rentals are monthly or weekly Stripe subscriptions. Creators connect a Stripe Express account from My bots; renters pay at Checkout; Stripe pays the creator minus `platform_fee_pct` (default 15). Set secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. In Stripe, point one webhook at `payments-webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and `account.updated`, and enable listening to events on connected accounts. A failed payment stops live trading; an ended subscription cancels the rental and the worker sells its positions. Turn it on with `update app_config set value='true' where key='payments_enabled';` only after legal review. Connect has its own onboarding, tax and fee rules; read Stripe's terms.

**Legal pages** are drafts in `public/legal/`. Replace every [PLACEHOLDER] and have a lawyer review them. Sign-up requires accepting them.

**Ongoing record.** After verification the worker keeps paper trading verified bots (a "track" run) so stats keep updating on a rolling 90 days. Uploading a new version ends tracking and resets verification. Old equity points and run fills are pruned after 120 days.

**Backtester.** Creators run a 30-day simulated test from My bots, using real hourly history and the same fees and slippage. It is a guide, not proof.

**Comments and replies.** Comments on feed posts; creators can reply once to a review; reviewers can edit their own.

**Email alerts.** Set worker env `RESEND_API_KEY`, `FROM_EMAIL`, `SITE_URL`. Users can switch emails off in Settings. For worker-down alerts set function secrets `RESEND_API_KEY`, `ADMIN_EMAIL`, `WATCHDOG_SECRET` and ping `.../functions/v1/worker-watchdog?s=YOUR_SECRET` every 5-10 minutes from a free uptime monitor.

**Tests.** `cd worker && npm install && npm test` runs the paper-engine and backtest unit tests; `.github/workflows/test.yml` runs them on every push. `smoke.mjs` remains the end-to-end check.

Not built: other exchanges (each needs its own withdrawal-permission check and testnet), a performance dashboard for creators' earnings history, automated browser tests.

## Hardening and polish (0007)
Run `0007_hardening.sql`; deploy `admin-tools`, `creator-earnings`, `my-invoices`; redeploy `register-version` and `payments-webhook`; **rebuild the sandbox image** (`docker build -t relay-sandbox worker/sandbox`) because it now includes numpy, pandas and the `relay_ta` indicator helpers.

**Live trading.** Per-rental max drawdown halt (default 20%) and optional resting stop-loss orders (Binance STOP_LOSS_LIMIT, placed after each buy, cancelled before sells). Order retries first check whether the first attempt already filled, using client order ids. BNB-paid fees are priced in USDT. The worker publishes its IP so renters with allowlisted keys can add it. A second worker with a different `WORKER_ID` on another machine takes over automatically if the first stops for 30 minutes. Test stop-losses on the testnet before real use; they are the least-tested part.

**Bot toolkit.** `import relay_ta` gives sma, ema, rsi, atr, bollinger; numpy and pandas are installed. A bot may take a third argument, `decide(candles, markets, state)`, and the dict is saved between runs (16 KB cap). See `examples/rsi_state.py`.

**Anti-gaming.** Uploads are fingerprinted (variable names ignored); similar code from another creator is flagged for admin review, never auto-blocked. Backtests report each half of the period and warn when the second half collapses (a common sign of overfitting).

**Admin.** Moderation page now has user search with ban, bot code viewer, Stripe refunds, support tickets, similar-code flags and a recent-errors list. Disputes are written to the admin log. Creators see Stripe balance and payouts; renters see invoices.

**Security.** Optional TOTP two-factor (Settings); once on, starting live trading requires a two-factor session. Optional Cloudflare Turnstile captcha: set `turnstileKey` in `public/config.js` and enable Captcha protection with the Turnstile secret in Supabase Auth settings. `worker/rotate-keys.mjs` re-encrypts saved exchange keys under a new secret. Set `SANDBOX_RUNTIME=runsc` to run bots under gVisor if you install it. Containers also get file and descriptor limits.

**Ops.** Error log (client and worker) shown in Moderation. `.github/workflows/backup.yml` dumps the database daily (needs the `SUPABASE_DB_URL` secret; keep the repo private, the dump contains personal data and encrypted keys). `RUNBOOK.md` covers incidents. `worker/loadtest.mjs` gives a rough read-load number. `smoke.mjs` now also checks several security rules.

**Marketplace** now filters, sorts and pages on the server, shows loading and error states, and has a skip link and status announcements. First-time visitors see a short welcome.

Still not built, by design: other exchanges, tax collection, a lawyer-reviewed legal text, SOC-style security review, and anything that needs paid services (Stripe Tax, Supabase Pro backups, dedicated hosting).

## Automated tests (all run in CI)
- `cd worker && npm install && npm test`: paper-trading maths and the backtester (10 tests).
- `cd ui-test && npm install && npm test`: renders every screen in a simulated browser against a fake backend and fails on any script error (5 tests).
- `pip install pgserver psycopg2-binary && python3 supabase/tests/run.py`: applies all migrations to a throwaway Postgres 16 and checks about 100 security rules and triggers (who can read or write what, rate limits, live-trading gates, 2FA gate, worker lock, deletion). Supabase's own objects are imitated by `supabase/tests/stub.sql`, and citext is replaced by plain text, so this does not replace running `smoke.mjs` against your real project.
- `deno check` over every function plus `deno test` for the code fingerprint (the commands are in `.github/workflows/test.yml`).
What these cannot cover: real Stripe, Binance, Supabase Auth, Docker and email behaviour. Use the testnet checklist and `smoke.mjs` for those.

## Interface redesign (0008)
Run `0008_sparklines.sql` (adds a 30-day sparkline to each marketplace row). The site now uses `public/style.css` (design tokens, light and dark) plus a top navigation bar, a verified-record hero, comparable bot rows, a slide-in bot sheet with an interactive equity curve, and rebuilt creator, rental, community and profile pages. Fonts load from Google Fonts (Newsreader and Hanken Grotesk). A tracking run now continues from the bot's last equity, so charts no longer show a fake drop after verification.

## Code checks (0009)
Run `0009_code_checks.sql`, redeploy `register-version` and `start-verification`, **rebuild the sandbox image** (it now contains `analyze.py` and `probe.py`) and restart the worker. Verification now costs $5 (`verification_fee_cents`=500).

Every uploaded version goes through three stages in the worker before the creator can pay for verification. A version with any **block** finding cannot be verified; **warn** findings are kept in the report and shown as short labels on the bot's public page.
1. **Static scan** (`sandbox/analyze.py`, never runs the code): needs a top-level `decide(candles, markets[, state])`; imports limited to an allowlist (math, statistics, numpy, pandas, relay_ta, collections, itertools and similar); no `exec`/`eval`/`open`/`getattr`, dunder tricks, `global` state, encoded payloads or embedded price tables; hard-coded dates and clock reads are flagged.
2. **Behaviour probes** (`sandbox/probe.py`, inside the container, synthetic uptrend/downtrend/range/volatile markets): no crashes on short or long windows, valid numbers in range, does not modify its input, no hidden state between calls (live runs start fresh each hour), state is plain JSON, fast enough, and flagged if output depends on absolute price level, calendar date or unseeded randomness, never trades, or trades every hour.
3. **Real-data backtest** (30 days, same fees and slippage as verification): blocks a bot that makes no trades; flags few trades, churn, drawdown above the verification limit, a many-small-wins/rare-large-loss profile, and a collapse in the second half.

What this proves: the code is a working, self-contained bot that behaves the same live as in tests. It does not prove the bot is profitable or will stay so; the 30-day live paper record is what shows performance. The public label says "Code checks passed", never "legit". Admins can send a version back through the checks with `admin_recheck_version`.

Tests: `python3 worker/sandbox/test_checks.py` (13 fixture bots), `cd worker && npm test`.