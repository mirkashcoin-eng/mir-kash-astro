// Founders' dashboard access control. An email is an admin only if it's in the
// ADMIN_EMAILS allowlist (comma-separated). Fail-closed: no list → nobody is admin.
function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

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

// Simple shared-secret gate for the dashboard (no Google needed). Verified server-side
// against ADMIN_PASSCODE over HTTPS. Fail-closed: no passcode configured → always false.
export function passcodeOk(key: string | null | undefined): boolean {
  const set = getEnv('ADMIN_PASSCODE');
  if (!set || !key) return false;
  // length-independent-ish constant compare
  if (key.length !== set.length) return false;
  let diff = 0;
  for (let i = 0; i < set.length; i++) diff |= key.charCodeAt(i) ^ set.charCodeAt(i);
  return diff === 0;
}

// The gate every /api/admin/* route uses: a shared passcode (x-admin-key) OR a Firebase
// ID token whose email is in the allowlist. Kept here so no route invents its own check.
export async function requestIsAdmin(request: Request): Promise<boolean> {
  if (passcodeOk(request.headers.get('x-admin-key'))) return true;
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { verifyFirebaseUser } = await import('./firebaseAuth');
  const user = await verifyFirebaseUser(token);
  return Boolean(user && isAdmin(user.email));
}
