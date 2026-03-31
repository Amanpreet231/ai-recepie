/**
 * Stake Multi Builder — Email Alerts Worker
 *
 * Receives webhook POSTs from the browser app when a bet result is determined.
 * Sends email via Resend API (free tier: 3000 emails/month).
 *
 * Setup:
 *   1. Sign up at resend.com (free) → get API key
 *   2. wrangler deploy --config email-alerts/wrangler.toml
 *   3. wrangler secret put RESEND_API_KEY
 *   4. In index.html: set EMAIL_ALERTS_URL to your worker URL
 */

const RESEND_API = 'https://api.resend.com/emails';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const { email, result, legs, combinedOdds, date, stake } = body;

    if (!email || !result || !legs) {
      return new Response('Missing fields: email, result, legs required', { status: 400 });
    }

    const subject = result === 'won'
      ? `🎉 Multi WON — ${combinedOdds}x odds!`
      : `❌ Multi Lost — ${combinedOdds}x`;

    const html = buildEmailHtml({ result, legs, combinedOdds, date, stake });

    try {
      const resp = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Stake Multi Builder <alerts@stakemulti.app>',
          to: [email],
          subject,
          html,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        return new Response(`Email failed: ${err}`, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
  }
};

function buildEmailHtml({ result, legs, combinedOdds, date, stake = 10 }) {
  const won = result === 'won';
  const color = won ? '#00e676' : '#ef5350';
  const icon  = won ? '🎉' : '❌';
  const ret   = won ? (stake * combinedOdds).toFixed(2) : '0.00';
  const profit = won ? '+$' + (stake * combinedOdds - stake).toFixed(2) : '-$' + stake.toFixed(2);

  const legRows = (legs || []).map((leg, i) => {
    const legResult = leg.result === 'won' ? '✅' : leg.result === 'lost' ? '❌' : '⏳';
    return `
      <tr style="border-bottom:1px solid #1a2a3a;">
        <td style="padding:10px 8px;color:#aaa;font-size:13px;">${i+1}. ${leg.sport || ''}</td>
        <td style="padding:10px 8px;color:#fff;font-size:13px;">${leg.selection || leg.outcome || ''}</td>
        <td style="padding:10px 8px;color:#00e676;font-size:13px;font-weight:bold;">@${leg.odds}</td>
        <td style="padding:10px 8px;font-size:16px;">${legResult}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:#0d1b2a;border-radius:16px;overflow:hidden;border:1px solid ${color};">
    <div style="background:${color};padding:24px;text-align:center;">
      <div style="font-size:48px;">${icon}</div>
      <h1 style="color:#000;margin:8px 0 0;font-size:22px;font-weight:800;">Multi ${won ? 'WON!' : 'Lost'}</h1>
    </div>
    <div style="padding:24px;border-bottom:1px solid #1a2a3a;">
      <div style="display:flex;justify-content:space-around;text-align:center;">
        <div>
          <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Combined Odds</div>
          <div style="color:#fff;font-size:24px;font-weight:800;">${combinedOdds}x</div>
        </div>
        <div>
          <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Return</div>
          <div style="color:${color};font-size:24px;font-weight:800;">$${ret}</div>
        </div>
        <div>
          <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Profit</div>
          <div style="color:${color};font-size:24px;font-weight:800;">${profit}</div>
        </div>
      </div>
    </div>
    <div style="padding:16px 24px;">
      <h3 style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Legs</h3>
      <table style="width:100%;border-collapse:collapse;">${legRows}</table>
    </div>
    <div style="padding:16px 24px;text-align:center;border-top:1px solid #1a2a3a;">
      <p style="color:#555;font-size:12px;margin:0;">⚡ Stake Multi Builder · ${new Date(date || Date.now()).toLocaleDateString()}</p>
    </div>
  </div>
</body>
</html>`;
}
