import type { APIRoute } from 'astro';
import UAParser from 'ua-parser-js';
import { tx, q } from '~/lib/db';
import { botName } from '~/middleware';
import { MAX_BATCH, cleanEvent, isId, personIdFor, sourceMedium, str, cleanPath, type CleanEvent } from '~/lib/events';

export const prerender = false;

// First-party event collector → Neon `events` (+ visitors / sessions / people).
// The browser tracker (window.mkEvent in BaseLayout) batches events and sends them
// here with fetch(keepalive) or navigator.sendBeacon. JSON body, so Astro's CSRF
// origin check doesn't apply. Always 204: tracking must never surface an error.
//
// Body: { v: visitorId, s: sessionId, events: [{ id, name, ts, page, pv, product,
//         value, currency, props }], session?: { landing, referrer, utm_*, fbclid,
//         gclid, affiliate, screen, market }, identify?: { phone, email, name, … } }
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

function device(ua: string): { device: string; os: string | null; browser: string | null } {
  const r = new UAParser(ua).getResult();
  const t = r.device.type;
  return {
    device: t === 'mobile' || t === 'wearable' ? 'mobile' : t === 'tablet' ? 'tablet' : 'desktop',
    os: r.os.name ?? null,
    browser: r.browser.name ?? null,
  };
}

function city(request: Request): string | null {
  const c = request.headers.get('x-vercel-ip-city');
  if (!c) return null;
  try { return decodeURIComponent(c).slice(0, 80); } catch { return c.slice(0, 80); }
}

async function reject(reason: string, n = 1): Promise<void> {
  await q(
    `INSERT INTO collect_rejects (day, reason, n) VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, $1, $2)
     ON CONFLICT (day, reason) DO UPDATE SET n = collect_rejects.n + EXCLUDED.n`,
    [reason, n],
  );
}

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { await reject('bad_json'); return noContent(); }

  const visitorId = body.v, sessionId = body.s;
  if (!isId(visitorId) || !isId(sessionId)) { await reject('bad_ids'); return noContent(); }

  const raw = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  if (Array.isArray(body.events) && body.events.length > MAX_BATCH) await reject('batch_overflow', body.events.length - MAX_BATCH);
  const events: CleanEvent[] = [];
  const reasons: Record<string, number> = {};
  for (const e of raw) {
    const c = cleanEvent(e);
    if (typeof c === 'string') reasons[c] = (reasons[c] || 0) + 1;
    else events.push(c);
  }
  for (const [r, n] of Object.entries(reasons)) await reject(r, n);

  // The request's own user-agent decides bot status — a page can't disguise a crawler.
  const ua = request.headers.get('user-agent') ?? '';
  const bot = botName(ua);
  const dev = device(ua);
  const country = (request.headers.get('x-vercel-ip-country') ?? '').toUpperCase() || null;

  const s = (body.session && typeof body.session === 'object' ? body.session : {}) as Record<string, unknown>;
  const touch = {
    referrer: str(s.referrer, 300), utm_source: str(s.utm_source, 60), utm_medium: str(s.utm_medium, 60),
    utm_campaign: str(s.utm_campaign, 80), fbclid: str(s.fbclid, 200), gclid: str(s.gclid, 200),
    affiliate: str(s.affiliate, 40),
  };
  const sm = sourceMedium(touch);

  const id = (body.identify && typeof body.identify === 'object' ? body.identify : null) as Record<string, unknown> | null;
  const personId = id ? personIdFor(id.phone, id.email) : '';

  try {
    await tx(async (c) => {
      await c.query(
        `INSERT INTO visitors (visitor_id, is_bot, bot_name) VALUES ($1, $2, $3)
         ON CONFLICT (visitor_id) DO UPDATE SET last_seen = now(),
           is_bot = visitors.is_bot OR EXCLUDED.is_bot,
           bot_name = COALESCE(visitors.bot_name, EXCLUDED.bot_name)`,
        [visitorId, Boolean(bot), bot || null],
      );
      // Attribution columns are written on insert only: a visit's source is where it began.
      await c.query(
        `INSERT INTO sessions (session_id, visitor_id, started_at, last_at, landing, referrer,
           source, medium, campaign, content, term, fbclid, gclid, affiliate,
           device, os, browser, screen, country, city, market, is_bot)
         VALUES ($1,$2,now(),now(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (session_id) DO UPDATE SET last_at = now()`,
        [sessionId, visitorId, cleanPath(s.landing), touch.referrer, sm.source, sm.medium,
          touch.utm_campaign, str(s.utm_content, 120), str(s.utm_term, 120), touch.fbclid, touch.gclid,
          touch.affiliate, dev.device, dev.os, dev.browser, str(s.screen, 12), country, city(request),
          str(s.market, 16), Boolean(bot)],
      );
      if (events.length) {
        // One multi-row insert; duplicates (retried beacons) are ignored by event_id.
        const cols = 11;
        const vals: unknown[] = [];
        const rows = events.map((e, i) => {
          vals.push(e.event_id, e.client_ts, visitorId, sessionId, e.name, e.page, e.page_view_id,
            e.product, e.value, e.currency, JSON.stringify(e.props));
          const b = i * cols;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11}::jsonb,${bot ? 'true' : 'false'})`;
        });
        await c.query(
          `INSERT INTO events (event_id, client_ts, visitor_id, session_id, name, page, page_view_id,
             product, value, currency, props, is_bot)
           VALUES ${rows.join(',')} ON CONFLICT (event_id) DO NOTHING`,
          vals,
        );
      }
      if (personId && id) {
        const phoneDigits = String(id.phone ?? '').replace(/[^0-9+]/g, '').slice(0, 20) || null;
        await c.query(
          `INSERT INTO people (person_id, phone, email, name, address1, city, province, pin, is_test)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, EXISTS (SELECT 1 FROM test_people t WHERE t.person_id = $1))
           ON CONFLICT (person_id) DO UPDATE SET last_seen = now(),
             phone = COALESCE(EXCLUDED.phone, people.phone),
             email = COALESCE(EXCLUDED.email, people.email),
             name = COALESCE(EXCLUDED.name, people.name),
             address1 = COALESCE(EXCLUDED.address1, people.address1),
             city = COALESCE(EXCLUDED.city, people.city),
             province = COALESCE(EXCLUDED.province, people.province),
             pin = COALESCE(EXCLUDED.pin, people.pin)`,
          [personId, phoneDigits, str(id.email, 200)?.toLowerCase() ?? null, str(id.name, 120),
            str(id.address1, 200), str(id.city, 80), str(id.province, 80), str(id.pin, 10)],
        );
        // Link this browser to the person. Their whole history comes with it.
        await c.query(
          `UPDATE visitors SET person_id = $2,
             is_test = is_test OR EXISTS (SELECT 1 FROM test_people t WHERE t.person_id = $2)
           WHERE visitor_id = $1`,
          [visitorId, personId],
        );
      }
    });
  } catch (e) {
    console.error('[collect] write failed:', e);
    await reject('db_error', Math.max(events.length, 1));
  }
  return noContent();
};
