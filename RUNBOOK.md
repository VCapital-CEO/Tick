# Relay runbook: when something goes wrong

**Worker is down** (alert email or Moderation page shows an old heartbeat). Live rentals keep their positions with nobody watching. Restart it (`npm start` in `worker/`). If it will be down for long, halt live trading from the Moderation page: the worker must be running to sell, so if you cannot restart it, tell affected renters to close positions on their exchange.

**Halt live trading now.** Moderation page, "Halt live trading". The worker sells every live position and stops those rentals within 10 minutes.

**A key may have leaked.** Tell the user to delete the key on their exchange first. Then run `worker/rotate-keys.mjs` with a new secret if the encryption secret itself may be exposed.

**Bad or malicious bot.** Moderation page: delist it, view its code, ban the creator if needed. Live rentals on a delisted bot stop when verification is cleared.

**Wrong money movement or dispute.** Refund from the Moderation page (Stripe payment intent id), or in the Stripe dashboard. Disputes are logged in the Admin log.

**Database damage.** Restore the latest artifact from the daily backup workflow into a fresh Supabase project, re-run nothing, then update `config.js`. Keys stay encrypted, so the encryption secret is also needed.

**Stripe webhook failing.** Check delivery attempts in Stripe; the handler is idempotent, so resend failed events.

**After any incident.** Write down what happened and what changed.
