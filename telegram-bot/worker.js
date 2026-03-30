/**
 * Stake Multi Builder — Telegram Bot (Cloudflare Worker)
 *
 * Setup:
 *   1. Create a bot via @BotFather on Telegram → get BOT_TOKEN
 *   2. Deploy this worker: wrangler deploy --config telegram-bot/wrangler.toml
 *   3. Set webhook: curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>
 *   4. Set secrets: wrangler secret put BOT_TOKEN && wrangler secret put ODDS_API_KEY
 *
 * Commands:
 *   /scan        — scan top sports, return best multi
 *   /scan nba    — scan specific sport
 *   /help        — show help
 *   /credits     — show remaining API credits
 */

const ODDS_API = 'https://api.the-odds-api.com/v4';
const TG_API   = 'https://api.telegram.org';

const TOP_SPORTS = [
  'basketball_nba', 'baseball_mlb', 'soccer_epl',
  'americanfootball_nfl', 'icehockey_nhl',
  'aussierules_afl', 'rugbyleague_nrl',
];

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('OK');
    const update = await request.json().catch(() => null);
    if (!update?.message) return new Response('OK');

    const chatId  = update.message.chat.id;
    const text    = (update.message.text || '').trim();
    const [cmd, arg] = text.split(/\s+/);

    try {
      if (cmd === '/start' || cmd === '/help') {
        await sendMessage(env, chatId, helpText());
      } else if (cmd === '/scan') {
        await sendMessage(env, chatId, '⏳ Scanning sports for best multi...');
        const result = await runScan(env, arg);
        await sendMessage(env, chatId, result, { parse_mode: 'HTML' });
      } else if (cmd === '/credits') {
        const credits = await checkCredits(env);
        await sendMessage(env, chatId, `📊 API credits remaining: <b>${credits}</b>/500`, { parse_mode: 'HTML' });
      } else {
        await sendMessage(env, chatId, '❓ Unknown command. Try /scan or /help');
      }
    } catch (e) {
      await sendMessage(env, chatId, `❌ Error: ${e.message}`);
    }

    return new Response('OK');
  }
};

function helpText() {
  return `⚡ <b>Stake Multi Builder Bot</b>

Commands:
/scan — Find best multi from top sports
/scan nba — Scan specific sport (nba, mlb, nfl, nhl, afl, nrl, epl)
/credits — Check remaining API credits
/help — Show this message

The bot scans live odds, removes the bookmaker vig, and builds the combination closest to 2x odds.`;
}

async function runScan(env, sportArg) {
  const targets = sportArg
    ? TOP_SPORTS.filter(s => s.includes(sportArg.toLowerCase()))
    : TOP_SPORTS.slice(0, 5); // scan top 5 to save credits

  if (!targets.length) return `❌ Unknown sport: ${sportArg}. Try: nba, mlb, nfl, nhl, epl, afl, nrl`;

  const allBets = [];
  let creditsLeft = '?';

  for (const sport of targets) {
    try {
      const url = `${ODDS_API}/sports/${sport}/odds?apiKey=${env.ODDS_API_KEY}&regions=au,uk&markets=h2h,totals,spreads&oddsFormat=decimal&dateFormat=iso`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      creditsLeft = resp.headers.get('x-requests-remaining') || creditsLeft;
      const events = await resp.json();
      for (const event of events) {
        processEvent(event, sport, allBets);
      }
    } catch (e) {
      // skip failed sport
    }
  }

  if (allBets.length < 2) return '❌ Not enough bets found. Try again later.';

  const multi = buildBestMulti(allBets, 2.0, 5, 24);
  if (!multi) return '❌ Could not build a multi. Try /scan again.';

  return formatMulti(multi, creditsLeft);
}

function processEvent(event, sportKey, allBets) {
  for (const bm of (event.bookmakers || [])) {
    for (const mkt of (bm.markets || [])) {
      const market = mkt.key; // h2h, totals, spreads
      const outcomes = mkt.outcomes || [];
      if (!outcomes.length) continue;

      // Calculate overround for vig removal
      const overround = outcomes.reduce((sum, o) => sum + 1 / (o.price || 1), 0);

      for (const out of outcomes) {
        if (!out.price || out.price < 1.1 || out.price > 10) continue;
        const fairOdds = overround * out.price;
        allBets.push({
          sport: sportKey,
          match: `${event.home_team} vs ${event.away_team}`,
          selection: out.name + (out.point ? ` ${out.point > 0 ? '+' : ''}${out.point}` : ''),
          market,
          odds: parseFloat(out.price.toFixed(2)),
          fairOdds: parseFloat(fairOdds.toFixed(2)),
          isValue: fairOdds >= out.price * 0.97,
          startTime: event.commence_time,
        });
      }
    }
    break; // one bookmaker per event is enough
  }
}

function buildBestMulti(bets, target, maxLegs, windowHours) {
  // Filter to bets within time window of each other
  const sorted = [...bets].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  let best = null;
  let bestDiff = Infinity;

  // Try greedy: start from each bet, greedily add legs closest to keeping product near target
  for (let start = 0; start < Math.min(sorted.length, 30); start++) {
    const legs = [sorted[start]];
    const windowEnd = new Date(sorted[start].startTime).getTime() + windowHours * 3_600_000;

    const candidates = sorted.filter((b, i) => {
      if (i === start) return false;
      if (new Date(b.startTime).getTime() > windowEnd) return false;
      // No same match
      if (legs.some(l => l.match === b.match)) return false;
      return true;
    });

    let product = sorted[start].odds;
    for (const c of candidates) {
      if (legs.length >= maxLegs) break;
      if (legs.some(l => l.match === c.match)) continue;
      legs.push(c);
      product *= c.odds;
    }

    const diff = Math.abs(product - target);
    if (diff < bestDiff && legs.length >= 2) {
      bestDiff = diff;
      best = { legs, combinedOdds: parseFloat(product.toFixed(2)) };
    }
  }
  return best;
}

function formatMulti(multi, creditsLeft) {
  const sportEmoji = { basketball_nba:'🏀', baseball_mlb:'⚾', soccer_epl:'⚽', americanfootball_nfl:'🏈', icehockey_nhl:'🏒', aussierules_afl:'🏉', rugbyleague_nrl:'🏉' };
  const allValue = multi.legs.every(l => l.isValue);

  let msg = `⚡ <b>Best Multi Found</b>${allValue ? ' ★ VALUE MULTI' : ''}\n`;
  msg += `💰 Combined Odds: <b>${multi.combinedOdds}x</b>\n`;
  msg += `📊 ${multi.legs.length} legs\n\n`;

  for (const [i, leg] of multi.legs.entries()) {
    const emoji = sportEmoji[leg.sport] || '🎯';
    const value = leg.isValue ? ' ★' : '';
    const starts = new Date(leg.startTime).toLocaleString('en-AU', { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    msg += `${i+1}. ${emoji} <b>${leg.selection}</b>${value}\n`;
    msg += `   ${leg.match}\n`;
    msg += `   @ ${leg.odds} odds | ${starts}\n\n`;
  }

  msg += `📡 Credits remaining: ${creditsLeft}`;
  return msg;
}

async function checkCredits(env) {
  const url = `${ODDS_API}/sports?apiKey=${env.ODDS_API_KEY}&all=false`;
  const resp = await fetch(url);
  return resp.headers.get('x-requests-remaining') || '?';
}

async function sendMessage(env, chatId, text, extra = {}) {
  const body = { chat_id: chatId, text, ...extra };
  await fetch(`${TG_API}/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
