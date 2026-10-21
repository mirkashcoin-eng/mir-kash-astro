// WhatsApp inbox store — Supabase (the WhatsApp service's own project), over its
// PostgREST API with the service-role key. Server-only. Never throws: every call
// returns null/false when the store isn't configured or a request fails (logged).
//
// STUB — implemented in ticket WA-1 (docs/whatsapp-inbox/tickets/WA-1-supabase-store.md).
import type {
  WaContactRow, WaFilter, WaInboundRow, WaMessageRow, WaOutRow, WaStatusRow, WaThreadRow,
} from './whatsapp-types';

// WA_SUPABASE_URL + WA_SUPABASE_SERVICE_KEY are both set.
export function waStoreConfigured(): boolean {
  return false;
}

// Threads, most recent activity first. `q` matches phone / profile name / last body;
// `before` is an ISO last_at cursor (exclusive). Default limit 50.
export async function listThreadRows(_opts: {
  q?: string; filter?: WaFilter; before?: string | null; limit?: number;
} = {}): Promise<WaThreadRow[] | null> {
  return null;
}

// Messages for one phone, NEWEST first (the API reverses them). `before` = ISO `at`
// cursor (exclusive). Default limit 100.
export async function listMessageRows(_phone: string, _opts: {
  before?: string | null; limit?: number;
} = {}): Promise<WaMessageRow[] | null> {
  return null;
}

// Their most recent inbound message, for the 24h window check and the reply number.
export async function lastInbound(_phone: string): Promise<{ at: string; phone_number_id: string | null } | null> {
  return null;
}

// Upsert wa_contacts.last_read_at = now() for the phone.
export async function markRead(_phone: string): Promise<boolean> {
  return false;
}

export async function insertOut(_row: WaOutRow): Promise<boolean> {
  return false;
}

// Insert, ignoring duplicates on meta_message_id.
export async function upsertInbound(_rows: WaInboundRow[]): Promise<boolean> {
  return false;
}

// Merge receipts into message_status: each timestamp column is only ever set, never
// cleared or moved later (receipts arrive out of order).
export async function upsertStatuses(_rows: WaStatusRow[]): Promise<boolean> {
  return false;
}

// Upsert profile names; a null name never overwrites a known one.
export async function upsertContacts(_rows: WaContactRow[]): Promise<boolean> {
  return false;
}
