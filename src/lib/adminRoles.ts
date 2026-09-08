// The Team access list: everyone granted admin access beyond the root founders
// (ADMIN_EMAILS, see adminAuth.ts). One doc per email in `admins/{email}` — the
// email itself is the doc id, lowercased. Admin SDK only; managed from the
// dashboard's Team access tab (src/pages/api/admin/team.ts).
import { adminDb } from './firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export type AdminRole = 'full' | 'affiliate';

export interface AdminUser {
  email: string;
  role: AdminRole;
  label: string | null;
  addedAt: string | null;
  addedBy: string | null;
}

const iso = (t: unknown): string | null =>
  t instanceof Timestamp ? t.toDate().toISOString() : null;

const docId = (email: string) => email.trim().toLowerCase();

export async function getAdminRole(email: string): Promise<AdminRole | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('admins').doc(docId(email)).get();
    if (!snap.exists) return null;
    const role = (snap.data() as Record<string, unknown>)?.role;
    return role === 'full' || role === 'affiliate' ? role : null;
  } catch {
    return null;
  }
}

export async function listAdminUsers(): Promise<AdminUser[] | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('admins').orderBy('addedAt', 'desc').get();
    return snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      return {
        email: d.id,
        role: (v.role as AdminRole) ?? 'affiliate',
        label: (v.label as string) ?? null,
        addedAt: iso(v.addedAt),
        addedBy: (v.addedBy as string) ?? null,
      };
    });
  } catch {
    return null;
  }
}

export async function upsertAdminUser(
  email: string,
  role: AdminRole,
  addedBy: string,
  label?: string,
): Promise<'ok' | 'unavailable'> {
  const db = adminDb();
  if (!db) return 'unavailable';
  const ref = db.collection('admins').doc(docId(email));
  const existed = (await ref.get()).exists;
  await ref.set({
    email: docId(email),
    role,
    label: label || null,
    addedBy,
    // Only stamped on first grant, so changing someone's role later doesn't
    // reset how long they've had access.
    ...(existed ? {} : { addedAt: FieldValue.serverTimestamp() }),
  }, { merge: true });
  return 'ok';
}

export async function removeAdminUser(email: string): Promise<'ok' | 'unavailable'> {
  const db = adminDb();
  if (!db) return 'unavailable';
  await db.collection('admins').doc(docId(email)).delete();
  return 'ok';
}
