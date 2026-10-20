// The Try at Home phone banner test: does the photograph above the pieces help or hurt?
//   A = banner (the page as it is), B = no banner on phones, so the pieces start higher.
// Assigned on the server (src/pages/try-at-home.astro) and remembered in a first-party
// cookie for 90 days. Only phone-width visitors are counted: desktop looks the same in
// both versions. Judged on how many visitors go on to choose pieces (the step the banner
// sits in front of), with bookings watched so B is stopped if it costs bookings.

export const AB_COOKIE = 'mk_tah_ab';
export const AB_MAX_AGE = 60 * 60 * 24 * 90; // 90 days, in seconds
export type Variant = 'A' | 'B';

export interface Assignment {
  variant: Variant;
  setCookie: boolean; // a new visitor: remember their version
  counted: boolean;   // counts towards the test (not a bot, not a forced ?ab= check)
}

// `rand` is Math.random() in production; passed in so the rule can be tested.
export function assignVariant(o: { cookie?: string | null; force?: string | null; bot: boolean; rand: number }): Assignment {
  const force = (o.force ?? '').toUpperCase();
  if (force === 'A' || force === 'B') return { variant: force, setCookie: false, counted: false };
  if (o.bot) return { variant: 'A', setCookie: false, counted: false };
  if (o.cookie === 'A' || o.cookie === 'B') return { variant: o.cookie, setCookie: false, counted: true };
  return { variant: o.rand < 0.5 ? 'A' : 'B', setCookie: true, counted: true };
}

export interface ZResult { pA: number; pB: number; z: number }

// Two-proportion z-test of B against A: z > 0 means B's rate is higher.
export function zTest(xA: number, nA: number, xB: number, nB: number): ZResult {
  const pA = nA ? xA / nA : 0;
  const pB = nB ? xB / nB : 0;
  const p = nA + nB ? (xA + xB) / (nA + nB) : 0;
  const se = Math.sqrt(p * (1 - p) * (nA && nB ? 1 / nA + 1 / nB : 0));
  return { pA, pB, z: se ? (pB - pA) / se : 0 };
}

// About 750 phone visitors a version finds a 33% → 40% change in choosing pieces; two
// full weeks covers weekday and weekend visitors. Calling it sooner overstates chance wins.
export const MIN_PER_ARM = 750;
export const MIN_DAYS = 14;
const Z_95 = 1.96;     // 95% two-sided
const Z_STOP = -2.58;  // B clearly costing bookings (99%): stop early regardless
const MIN_FOR_STOP = 200;

export interface ArmCounts { visitors: number; choseP: number; booked: number }
export interface Verdict {
  call: 'not_enough' | 'A' | 'B' | 'no_difference' | 'stop_B';
  text: string;
  pieces: ZResult;
  bookings: ZResult;
}

const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;

export function verdict(a: ArmCounts, b: ArmCounts, days: number): Verdict {
  const pieces = zTest(a.choseP, a.visitors, b.choseP, b.visitors);
  const bookings = zTest(a.booked, a.visitors, b.booked, b.visitors);
  const out = (call: Verdict['call'], text: string): Verdict => ({ call, text, pieces, bookings });

  if (a.visitors >= MIN_FOR_STOP && b.visitors >= MIN_FOR_STOP && bookings.z <= Z_STOP) {
    return out('stop_B', `Stop the test: without the banner, bookings are clearly lower (${pct(bookings.pB)} against ${pct(bookings.pA)}). Keep the banner.`);
  }
  const fewest = Math.min(a.visitors, b.visitors);
  if (fewest < MIN_PER_ARM || days < MIN_DAYS) {
    return out('not_enough', `Not enough data yet: ${fewest} of ${MIN_PER_ARM} phone visitors in the smaller version, day ${days} of ${MIN_DAYS}.`);
  }
  if (pieces.z >= Z_95) {
    return out('B', `B ahead: without the banner, ${pct(pieces.pB)} chose pieces against ${pct(pieces.pA)}. Bookings ${pct(bookings.pB)} against ${pct(bookings.pA)}.`);
  }
  if (pieces.z <= -Z_95) {
    return out('A', `A ahead: with the banner, ${pct(pieces.pA)} chose pieces against ${pct(pieces.pB)}. Bookings ${pct(bookings.pA)} against ${pct(bookings.pB)}.`);
  }
  return out('no_difference', `No clear difference (${pct(pieces.pA)} with the banner, ${pct(pieces.pB)} without). Keep the banner and test something bigger.`);
}
