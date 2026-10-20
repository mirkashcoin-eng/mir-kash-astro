// Try at Home step counts for /admin (recordTryAtHomeEvent in analytics.ts). The page
// sends each step at most once per browser per day, so the counts read as daily unique
// visitors rather than page loads or Back-and-Continue clicks. The record lives in the
// visitor's own localStorage and holds no personal data: the day, whether the first
// visit that day came from a Meta ad, and which steps were already sent.

export interface FunnelRecord { day: string; ad: boolean; sent: string[] }

// A Meta ad click carries fbclid; our own tagged links carry utm_source.
export function isAdVisit(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.has('fbclid') || /^(fb|ig|facebook|instagram|meta)/i.test(q.get('utm_source') ?? '');
}

// Today's record: yesterday's (or a corrupt one) starts over. A visit from an ad marks
// the whole day as ad traffic, so a later reload without the ad's URL still counts there.
export function freshRecord(prev: unknown, day: string, adNow: boolean): FunnelRecord {
  const p = prev as Partial<FunnelRecord> | null;
  const same = p && p.day === day && Array.isArray(p.sent);
  return {
    day,
    ad: Boolean(adNow || (same && p!.ad)),
    sent: same ? p!.sent!.filter((s) => typeof s === 'string') : [],
  };
}

// Whether `step` still needs sending today; marks it sent when it does.
export function claimStep(rec: FunnelRecord, step: string): boolean {
  if (rec.sent.includes(step)) return false;
  rec.sent.push(step);
  return true;
}
