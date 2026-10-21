// The metrics sections /admin reads, by name. Each takes a `run` (one query → rows)
// and the request params, and returns its typed response (./types.ts).
import type { MetricsParams, SectionName, SectionResponses } from './types.ts';
import type { Run } from './core.ts';
import { getOverview } from './overview.ts';
import { getAcquisition } from './acquisition.ts';
import { getProducts } from './products.ts';
import { getCheckout } from './checkout.ts';
import { getAudience } from './audience.ts';
import { getRetention } from './retention.ts';
import { getFunnelDaily } from './funnelDaily.ts';
import { getTrackingHealth } from './trackingHealth.ts';

export type { Run } from './core.ts';
export { parseParams } from './core.ts';

export const SECTIONS: { [S in SectionName]: (run: Run, p: MetricsParams) => Promise<SectionResponses[S]> } = {
  overview: getOverview,
  acquisition: getAcquisition,
  products: getProducts,
  checkout: getCheckout,
  audience: getAudience,
  retention: getRetention,
  funnelDaily: getFunnelDaily,
  trackingHealth: getTrackingHealth,
};

export function isSection(s: unknown): s is SectionName {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(SECTIONS, s);
}
