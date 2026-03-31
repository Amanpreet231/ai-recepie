# Stake Multi Builder — Telegram Bot

## Setup

1. **Create bot**: Message @BotFather on Telegram → /newbot → copy the token
2. **Deploy worker**:
   ```bash
   cd telegram-bot
   wrangler deploy
   ```
   Copy the worker URL from the output.
3. **Set secrets**:
   ```bash
   wrangler secret put BOT_TOKEN
   wrangler secret put ODDS_API_KEY
   ```
4. **Register webhook**:
   ```bash
   curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>"
   ```
5. **Test**: Message your bot `/scan` on Telegram

## Commands
- `/scan` — best multi from top 5 sports (~5 credits)
- `/scan nba` — scan specific sport (~1 credit)
- `/credits` — check remaining credits (~0 credits, just sports list)
- `/help` — show commands
