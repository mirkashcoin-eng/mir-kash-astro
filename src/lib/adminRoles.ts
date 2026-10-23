// The Team access list: everyone granted admin access beyond the root founders
// (ADMIN_EMAILS, see adminAuth.ts). One row per email in the Neon `admins` table
// (lowercased). Managed from the dashboard's Team access tab (src/pages/api/admin/team.ts).
import { q } from './db';

export type AdminRole = 'full' | 'affiliate';

export interface AdminUser {
  email: string;
  role: AdminRole;
  label: string | null;
  addedAt: string | null;
  addedBy: string | null;
}

const docId = (email: string) => email.trim().toLowerCase();

export async function getAdminRole(email: string): Promise<AdminRole | null> {
  const rows = await q<{ role: string }>('SELECT role FROM admins WHERE email = $1', [docId(email)]);
  const role = rows?.[0]?.role;
  return role === 'full' || role === 'affiliate' ? role : null;
}

export async function listAdminUsers(): Promise<AdminUser[] | null> {
  const rows = await q<{ email: string; role: AdminRole; label: string | null; added_at: Date | null; added_by: string | null }>(
    'SELECT email, role, label, added_at, added_by FROM admins ORDER BY added_at DESC',
  );
  if (!rows) return null;
  return rows.map((r) => ({
    email: r.email,
    role: r.role ?? 'affiliate',
    label: r.label,
    addedAt: r.added_at ? r.added_at.toISOString() : null,
    addedBy: r.added_by,
  }));
}

export async function upsertAdminUser(
  email: string,
  role: AdminRole,
  addedBy: string,
  label?: string,
): Promise<'ok' | 'unavailable'> {
  // added_at is only set on the first grant, so changing someone's role later
  // doesn't reset how long they've had access.
  const rows = await q(
    `INSERT INTO admins (email, role, label, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, label = EXCLUDED.label, added_by = EXCLUDED.added_by
     RETURNING email`,
    [docId(email), role, label || null, addedBy],
  );
  return rows ? 'ok' : 'unavailable';
}

export async function removeAdminUser(email: string): Promise<'ok' | 'unavailable'> {
  const rows = await q('DELETE FROM admins WHERE email = $1 RETURNING email', [docId(email)]);
  return rows ? 'ok' : 'unavailable';
}
