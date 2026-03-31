# Landing Page

Marketing landing page for Stake Multi Builder.

## To add Stripe:
1. Sign up at stripe.com
2. Create a Product + Price ($5/month recurring)
3. Replace the Pro button onclick with: `window.location.href = 'https://buy.stripe.com/YOUR_PAYMENT_LINK'`
4. Add a Cloudflare Worker webhook to verify payment and unlock Pro features
