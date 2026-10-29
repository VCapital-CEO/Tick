# Tick: production launch checklist

The database and edge functions are already live on Supabase. These are the steps left to go public. Do them in order.

## 1. Always-on worker: free, on GitHub Actions
The worker runs code checks, paper runs and stats. GitHub runs it every 5 minutes for free. Each run does one full cycle, then serves code checks for about 4 minutes. In practice that means a code check starts within a few minutes of an upload and paper runs advance hourly.
1. Create a **public** GitHub repository and push this project to it (public repositories get unlimited free Actions minutes; private ones do not). It contains no secrets: `public/config.js` holds only the public anon key, and `.gitignore` already excludes `.env` files.
2. Repository, Settings, Secrets and variables, Actions, New repository secret. Add two secrets. Paste the values straight into GitHub, never into chat:
   - `SUPABASE_URL` = `https://ygtdbboazcdsyfmzopfw.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = Supabase dashboard, Project Settings, API Keys, the `service_role` secret key.
3. Actions tab, choose **worker**, **Run workflow**. In the log you should see `Binance market data status: 200` and then a line ending `tick ... runs`. If the Binance step fails, GitHub's servers are blocked from Binance. Tell me and we will switch the data source.
4. Stop the worker on your own PC. Only one worker may hold the lock; if your PC worker was the last to run, wait about 30 minutes for the lock to free up.
Things to know:
- GitHub may start a scheduled run a few minutes late, and it switches schedules off after 60 days with no activity in the repository. Push any small commit at least every 50 days, or press Run workflow once to wake it.
- The whole source, including the code-check rules, is visible to anyone because the repository is public.
- If you ever want a faster, private setup, the same worker runs unchanged on any small Linux server with Docker (`docker build -t relay-sandbox worker/sandbox`, then `cd worker && npm ci && node index.js` with the same two values as environment variables).

## 2. Firebase Hosting (https://ticktrading.web.app)
1. Create the Firebase project with the project ID `ticktrading` (the ID decides the address, and it cannot be changed later). If the ID is taken, Firebase suggests a variant such as `ticktrading-1a2b`; then use that address everywhere below instead.
2. `firebase login`, `firebase init hosting` (public folder `public`, single-page app yes, do not overwrite `index.html`).
3. `firebase deploy --only hosting`. HTTPS is automatic on web.app. `firebase.json` already sets the security headers and cache rules.
4. A custom domain can be added later in Hosting, Add custom domain. Then repeat steps 3 and 5 with the new address.

## 3. Point everything at the real domain
- Supabase secret `SITE_URL` = `https://ticktrading.web.app` (Stripe returns users here and the functions only accept requests from this address, so set it at the moment you deploy).
- Supabase, Authentication, URL Configuration: set Site URL to `https://ticktrading.web.app` and add it to Redirect URLs.
- Turn email confirmation back ON (Authentication, Providers, Email).
- Authentication, Passwords: turn on leaked-password protection and set a minimum length of 8 or more.
- Google sign-in:
  1. Google Cloud console, APIs and Services, Credentials, Create OAuth client ID (Web application). Authorized redirect URI: `https://ygtdbboazcdsyfmzopfw.supabase.co/auth/v1/callback`. Authorized JavaScript origin: `https://ticktrading.web.app`. Complete the OAuth consent screen (app name Tick, your support email, privacy policy link `https://ticktrading.web.app/legal/privacy`) and publish it.
  2. Supabase, Authentication, Providers, Google: switch it on and paste the Client ID and Client Secret there (these never go in the site files).
- Optional but recommended: enable Cloudflare Turnstile, then set `turnstileKey` in `public/config.js`.

## 4. Stripe live mode
- Create the live-mode keys. Set `STRIPE_SECRET_KEY` (live) as a Supabase function secret.
- Webhook endpoint: `https://ygtdbboazcdsyfmzopfw.supabase.co/functions/v1/payments-webhook`. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.dispute.created`, `account.updated`, and all `identity.verification_session.*` events. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
- Stripe dashboard, Identity: turn on Stripe Identity (used for the Verify identity button). It is billed per check by Stripe.
- Enable Stripe Connect for creator payouts, then set `payments_enabled` to `true` in the `app_config` table.
- Tick's earnings: `platform_fee_pct` in `app_config` (currently 15) is taken from every rental payment automatically, and the rest goes to the creator. The $5 bot verification fee (`verification_fee_cents` = 500) goes entirely to Tick.

## 5. Google Search Console
1. Run `SUPABASE_URL=... SUPABASE_ANON_KEY=... SITE_URL=https://ticktrading.web.app node scripts/build-seo.mjs` to generate `sitemap.xml`, `robots.txt` and the bot and profile pages, then redeploy. Re-run it on a schedule (daily is fine).
2. Search Console, Add property, choose "URL prefix" and enter `https://ticktrading.web.app` (the Domain option does not work for web.app). Verify with the HTML file method: download the file Google gives you, put it in `public/`, redeploy, then verify. Submit `https://ticktrading.web.app/sitemap.xml`.

## 6. Legal and monitoring
- Have a lawyer review `public/legal/*` (terms, privacy, risk). They carry placeholders for your company details.
- Optional: set `sentryDsn` in `public/config.js`.
- The `backup.yml` GitHub workflow needs its secrets set to run nightly database backups.

## 7. Not live yet (leave switched off until built)
- Real-money trading (`live_execution_enabled` stays false until the broker layer ships).
- KYC and crypto payments.