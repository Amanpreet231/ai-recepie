/**
 * Stake Multi Builder — Cloudflare Worker Caching Proxy
 *
 * Sits between the browser app and The Odds API.
 * - Hides the real API key from the client
 * - Caches responses in Cloudflare KV with smart TTL
 * - All users share one cache → free tier serves thousands of users
 *
 * Setup:
 *   1. Create a Cloudflare account at cloudflare.com (free)
 *   2. Install Wrangler: npm install -g wrangler
 *   3. wrangler login
 *   4. wrangler kv:namespace create ODDS_CACHE
 *      → copy the id into wrangler.toml below
 *   5. wrangler secret put ODDS_API_KEY
 *      → paste your The Odds API key when prompted
 *   6. wrangler deploy
 *   7. Copy the worker URL (e.g. https://stake-proxy.YOUR_NAME.workers.dev)
 *      into index.html: const PROXY_URL = 'https://stake-proxy.YOUR_NAME.workers.dev'
 *
 * wrangler.toml (create this file alongside worker.js):
 * ─────────────────────────────────────────────────────
 * name = "stake-multi-proxy"
 * main = "worker.js"
 * compatibility_date = "2024-01-01"
 *
 * [[kv_namespaces]]
 * binding = "ODDS_CACHE"
 * id = "PASTE_YOUR_KV_ID_HERE"
 * ─────────────────────────────────────────────────────
 */

// Allowed origins — covers Pages deployment, blob URLs, localhost, and any Cloudflare subdomain
const ALLOWED_ORIGINS = [
  'https://3000-i1fj391i69n5jy1rjjlce-82b888ba.sandbox.novita.ai',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://stake-multi-builder.pages.dev',
  'https://stakemulti.pages.dev',
];

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

/**
 * Smart TTL — same logic as client side so both layers agree
 * Far-future games cached longer, live games expire fast
 */
function computeSmartTTL(events) {
  if (!Array.isArray(events) || !events.length) return 1800; // 30 min default
  const earliest = Math.min(...events.map(e => new Date(e.commence_time || 0).getTime()));
  const hoursAway = (earliest - Date.now()) / 3_600_000;
  if (hoursAway < 0)   return 300;    // live → 5 min
  if (hoursAway < 12)  return 1800;   // <12h → 30 min
  if (hoursAway < 48)  return 7200;   // 12-48h → 2 hours
  return 21600;                        // 48h+ → 6 hours
}

function corsHeaders(origin) {
  // Allow: exact matches, any *.pages.dev subdomain, blob: URLs (no origin header), localhost
  const isAllowed = !origin // blob:// or file:// sends no Origin
    || ALLOWED_ORIGINS.includes(origin)
    || /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin)
    || /^https?:\/\/localhost(:\d+)?$/.test(origin)
    || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? (origin || '*') : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    const url = new URL(request.url);
    const pathname = url.pathname; // e.g. /sports  or  /odds/basketball_nba
    const regions = url.searchParams.get('regions') || 'au';
    const markets = url.searchParams.get('markets') || 'h2h,totals,spreads';

    // ── Route: GET /sports ──────────────────────────────────────────────────
    if (pathname === '/sports') {
      const cacheKey = 'sports_list';
      const cached = await env.ODDS_CACHE.get(cacheKey, 'json');
      if (cached) {
        return new Response(JSON.stringify(cached), {
          headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
        });
      }

      const resp = await fetch(`${ODDS_API_BASE}/sports?apiKey=${env.ODDS_API_KEY}&all=false`);
      if (!resp.ok) return new Response(await resp.text(), { status: resp.status, headers: cors });

      const data = await resp.json();
      await env.ODDS_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 21600 }); // 6h

      return new Response(JSON.stringify(data), {
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'X-Cache': 'MISS',
          ...forwardCreditsHeader(resp),
        }
      });
    }

    // ── Route: GET /odds/{sportKey} ─────────────────────────────────────────
    if (pathname.startsWith('/odds/')) {
      const sportKey = pathname.replace('/odds/', '');
      if (!sportKey) return new Response('Missing sport key', { status: 400, headers: cors });

      const cacheKey = `odds_${sportKey}_${regions}_${markets}`;
      const cached = await env.ODDS_CACHE.get(cacheKey, 'json');
      if (cached) {
        return new Response(JSON.stringify(cached), {
          headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
        });
      }

      const apiUrl = `${ODDS_API_BASE}/sports/${sportKey}/odds?apiKey=${env.ODDS_API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=decimal&dateFormat=iso`;
      const resp = await fetch(apiUrl);
      if (!resp.ok) return new Response(await resp.text(), { status: resp.status, headers: cors });

      const data = await resp.json();
      const ttl = computeSmartTTL(data);
      await env.ODDS_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: ttl });

      return new Response(JSON.stringify(data), {
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'X-Cache': 'MISS',
          ...forwardCreditsHeader(resp),
        }
      });
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
};

function forwardCreditsHeader(resp) {
  const left = resp.headers.get('x-requests-remaining');
  const used = resp.headers.get('x-requests-used');
  const headers = {};
  if (left) headers['X-Requests-Remaining'] = left;
  if (used) headers['X-Requests-Used'] = used;
  return headers;
}
