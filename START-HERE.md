# Relay: first-time setup

Do these in order. Stop after step 5 to see the site working before touching the rest.

## Install once
- Node.js 18 or newer (nodejs.org)
- A free Supabase account (supabase.com) and a free Firebase/Google account
- Later, for the worker: Docker Desktop. For functions: `npm i -g supabase firebase-tools`

## Steps
1. **Unzip** this folder anywhere.
2. **Create a Supabase project.** In the dashboard open SQL Editor and run these eight files from `supabase/migrations/`, one at a time, in order: `0001_init.sql`, `0002_worker.sql`, `0003_live.sql`, `0004_markets.sql`, `0005_features.sql`, `0006_missing.sql`, `0007_hardening.sql`, `0008_sparklines.sql`. Fix any red error before moving on.
3. **Turn off email confirmation** (Authentication, Providers, Email) while testing.
4. **Add your keys.** Supabase dashboard, Project Settings, API. Copy the Project URL and the `anon` key into `public/config.js`. Never put the `service_role` key there.
5. **See it.** In this folder run `python3 -m http.server 8000 --directory public` and open http://localhost:8000. Sign up and list a bot. Code upload and verification will not work yet.
6. **Deploy the functions** (needed for code upload and verification):
   `supabase login`, `supabase link --project-ref YOUR_REF`, `supabase secrets set SITE_URL=http://localhost:8000 KEY_ENCRYPTION_SECRET=$(openssl rand -base64 32)`, then `supabase functions deploy start-verification register-version exchange-keys delete-account connect-onboard rental-checkout cancel-rental admin-tools creator-earnings my-invoices` and `supabase functions deploy payments-webhook --no-verify-jwt` and `supabase functions deploy worker-watchdog --no-verify-jwt`.
7. **Run the worker** (verification and stats): `docker build -t relay-sandbox worker/sandbox`, then in `worker/` run `npm install` and start it with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `KEY_ENCRYPTION_SECRET` set (see README). Keep the service role key on this machine only.
8. **Make yourself admin** to see the Moderation page: in the SQL editor, `update profiles set is_admin=true where handle='your_handle';`
9. **Test with fake money** before anything else: follow "Testing before real money" in README.md, then run `node smoke.mjs` from `worker/`.
10. **Put it online** (last): `firebase login`, `firebase init hosting` (public folder `public`, single-page app yes, do not overwrite index.html), `firebase deploy`. Then see README.md for Search Console.

## Folder map
- `public/` the website
- `supabase/migrations/` database (run in order)
- `supabase/functions/` server functions
- `worker/` bot runner, live trading, smoke test, example bots
- `scripts/build-seo.mjs` sitemap generator for Google
- `README.md` full details and known limits

Payments and live trading stay off until you turn them on deliberately.
