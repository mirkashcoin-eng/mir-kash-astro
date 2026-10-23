// The piece a Meta Try at Home ad showed, for visitors whose ad link didn't name one.
//
// Every live Try at Home ad (campaign "Try at Home · Mumbai · Leads", launched 20 Oct 2026)
// shows the Gigi in Olive Green but links to a bare /try-at-home, so ad visitors landed on
// the whole grid with nothing selected. Meta adds utm_source=meta and the campaign name to
// every click (url_tags in MK_Meta_Ads), which is enough to tell. Future ads should link
// with their own ?bag=<handle>&color=<colour>, which always wins over this.

export const TAH_AD_PIECE = { bag: 'gigi-mini-bag', color: 'olive green' } as const;

// Same rule MK_Meta_Ads uses to tell a Try at Home campaign by its name.
const TAH_CAMPAIGN = /try\s*-?\s*at\s*-?\s*home|\btah\b/i;

export function adPreselect(q: URLSearchParams): { bag: string; color: string } | null {
  if (q.get('bag') || q.get('bags')) return null;
  if ((q.get('utm_source') ?? '').toLowerCase() !== 'meta') return null;
  if (!TAH_CAMPAIGN.test(q.get('utm_campaign') ?? '')) return null;
  return { ...TAH_AD_PIECE };
}
