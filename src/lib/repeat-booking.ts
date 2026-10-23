// A Try at Home request is a repeat when the same phone already has a booking from the
// last 7 days whose visit hasn't happened yet: the person is re-sending the same
// request (after an error, or not hearing back), not booking a second visit. Same rule
// the warehouse sync uses to collapse bookings, so Meta and /admin count alike.

export const REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface PastBooking {
  name: string; // Shopify draft name, e.g. "#D145"
  createdAt: string;
  phone: string | null;
  completed: boolean;
  eventId: string | null; // the Schedule event id Meta counted it under
}

function last10(phone: string | null): string {
  return (phone ?? '').replace(/\D/g, '').slice(-10);
}

// The first open booking in the window: its event id is the one Meta already counted.
export function findRepeatOf(past: PastBooking[], phone: string, now: number): PastBooking | null {
  const want = last10(phone);
  if (want.length !== 10) return null;
  const open = past.filter((b) => {
    const at = Date.parse(b.createdAt);
    return !b.completed && last10(b.phone) === want && at <= now && now - at <= REPEAT_WINDOW_MS;
  });
  open.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return open[0] ?? null;
}
