// Server-side Firestore via the Firebase Admin SDK, using a service-account key
// (FIREBASE_SERVICE_ACCOUNT — the raw JSON from Firebase → Project settings →
// Service accounts). The Admin SDK bypasses Firestore security rules, so the
// `leads` and `analytics_daily` collections can stay fully locked from the public
// while the server reads/writes them. Degrades to null when the key isn't set.
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

let _db: Firestore | null | undefined;

export function adminDb(): Firestore | null {
  if (_db !== undefined) return _db;
  const raw = env('FIREBASE_SERVICE_ACCOUNT');
  if (!raw) { _db = null; return null; }
  try {
    const sa = JSON.parse(raw) as { project_id?: string; private_key?: string; [k: string]: unknown };
    // Vercel may store the escaped \n; normalise to real newlines for the PEM key.
    if (typeof sa.private_key === 'string') sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    const app: App = getApps().length
      ? getApps()[0]
      : initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]), projectId: sa.project_id });
    _db = getFirestore(app);
  } catch (e) {
    console.error('[firebaseAdmin] init failed:', e);
    _db = null;
  }
  return _db;
}
