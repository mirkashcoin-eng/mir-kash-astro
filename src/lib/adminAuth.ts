// Founders' dashboard access control. An email is a full admin if it's in the
// ADMIN_EMAILS allowlist (comma-separated, redeploy-only — the fail-safe root
// list). Anyone else's role comes from the Firestore-backed Team access list
// (see adminRoles.ts), managed from the dashboard without a redeploy.
// Fail-closed: no match anywhere → not an admin.
function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

export type AdminRole = 'full' | 'affiliate';

export function adminEmails(): string[] {
  return getEnv('ADMIN_EMAILS')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

// The gate every /api/admin/* route uses: a Firebase ID token whose email is
// either a root founder (always 'full') or has a role in the Team access list.
// No token, or an email in neither place → null.
export async function requestRole(request: Request): Promise<AdminRole | null> {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { verifyFirebaseUser } = await import('./firebaseAuth');
  const user = await verifyFirebaseUser(token);
  if (!user?.email) return null;
  if (isAdmin(user.email)) return 'full';
  const { getAdminRole } = await import('./adminRoles');
  return getAdminRole(user.email);
}

// Founders-only gate (unchanged contract): true only for the 'full' role, so
// every existing caller (data.ts, journey.ts, demo.ts) keeps working as-is.
export async function requestIsAdmin(request: Request): Promise<boolean> {
  return (await requestRole(request)) === 'full';
}
