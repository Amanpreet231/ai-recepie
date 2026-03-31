# Stake Multi Builder — Email Alerts

Sends an email when a multi bet auto-settles (won or lost).

## Setup

1. **Sign up at [resend.com](https://resend.com)** (free — 3000 emails/month)
2. Get your API key from the Resend dashboard
3. **Deploy**:
   ```bash
   cd email-alerts
   wrangler deploy
   ```
4. **Set secret**:
   ```bash
   wrangler secret put RESEND_API_KEY
   ```
5. Copy your worker URL and set it in index.html:
   ```js
   const EMAIL_ALERTS_URL = 'https://smb-email-alerts.YOUR_NAME.workers.dev';
   ```

## Webhook payload

```json
{
  "email": "user@example.com",
  "result": "won",
  "legs": [...],
  "combinedOdds": 2.45,
  "date": "2026-03-31T10:00:00Z",
  "stake": 10
}
```

## Email appearance

- Green header + 🎉 for wins, red + ❌ for losses
- Combined odds, return, profit stats
- Each leg listed with its result
- Dark-themed HTML email
