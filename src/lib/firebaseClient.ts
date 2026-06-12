// Browser-side Firebase for customer accounts (Google sign-in) + Firestore
// (saved-address profile + checkout lead capture). Reuses the existing Firebase
// project. Degrades to no-ops until PUBLIC_FIREBASE_* are configured.
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut,
  onAuthStateChanged, createUserWithEmailAndPassword, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence,
  type Auth, type User,
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, serverTimestamp, type Firestore,
} from 'firebase/firestore';

const cfg = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

export function firebaseConfigured(): boolean {
  return Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId);
}
function init() {
  if (!firebaseConfigured()) return false;
  if (!app) app = getApps()[0] ?? initializeApp(cfg);
  if (!auth) {
    auth = getAuth(app);
    // Keep the customer signed in across tabs and revisits (explicit, though it's
    // the SDK default) so they never have to log in again on a return visit.
    setPersistence(auth, browserLocalPersistence).catch(() => {});
  }
  if (!db) db = getFirestore(app);
  return true;
}

export interface Profile {
  id: string;
  full_name?: string | null; phone?: string | null;
  address1?: string | null; address2?: string | null;
  city?: string | null; province?: string | null; zip?: string | null; email?: string | null;
}

// Resolves once Firebase reports the initial auth state.
export function getSessionUser(): Promise<User | null> {
  if (!init()) return Promise.resolve(null);
  return new Promise((res) => {
    const unsub = onAuthStateChanged(auth!, (u) => { unsub(); res(u); });
  });
}

export async function getIdToken(): Promise<string | null> {
  if (!init()) return null;
  return auth!.currentUser ? auth!.currentUser.getIdToken() : null;
}

export async function signInWithGoogle(): Promise<User | null> {
  if (!init()) return null;
  const { user } = await signInWithPopup(auth!, new GoogleAuthProvider());
  return user;
}

export async function signOut(): Promise<void> {
  if (init()) await fbSignOut(auth!);
}

export async function loadProfile(uid: string): Promise<Profile | null> {
  if (!init()) return null;
  const snap = await getDoc(doc(db!, 'profiles', uid));
  return snap.exists() ? ({ id: uid, ...snap.data() } as Profile) : null;
}

export async function saveProfile(p: Profile): Promise<boolean> {
  if (!init()) return false;
  try {
    await setDoc(doc(db!, 'profiles', p.id), { ...p, updated_at: serverTimestamp() }, { merge: true });
    return true;
  } catch { return false; }
}

function randomPassword(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2).toUpperCase() + '9!';
}

// On checkout: persist the customer's details to their account.
//  • Signed in  → save to their existing profile.
//  • Guest      → auto-create an email+password account, save the profile, and
//                 email a "set your password" link so they can log in later.
// Best-effort and fully swallowed — a failure here must never block the order.
// Returning customers (auth/email-already-in-use) are skipped silently.
export async function ensureAccountFromCheckout(
  email: string,
  profile: Omit<Profile, 'id' | 'email'>,
): Promise<void> {
  if (!init() || !email) return;
  try {
    if (auth!.currentUser) {
      await saveProfile({ id: auth!.currentUser.uid, ...profile, email });
      return;
    }
    const cred = await createUserWithEmailAndPassword(auth!, email, randomPassword());
    await saveProfile({ id: cred.user.uid, ...profile, email });
    await sendPasswordResetEmail(auth!, email);
  } catch {
    /* email-already-in-use or any error → skip; never block checkout */
  }
}

// Lead capture — written client-side to a write-only `checkout_leads` collection.
export async function saveLead(phone: string, email?: string | null): Promise<void> {
  if (!init()) return;
  try {
    await addDoc(collection(db!, 'checkout_leads'), {
      phone, email: email ?? null, source: 'india-checkout', created_at: serverTimestamp(),
    });
  } catch { /* best-effort */ }
}
