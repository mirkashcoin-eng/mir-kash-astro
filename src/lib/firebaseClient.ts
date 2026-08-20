// Browser-side Firebase for customer accounts (Google sign-in) + Firestore
// (saved-address profile + checkout lead capture). Reuses the existing Firebase
// project. Degrades to no-ops until PUBLIC_FIREBASE_* are configured.
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged, createUserWithEmailAndPassword, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence,
  type Auth, type User,
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, type Firestore } from 'firebase/firestore';

const cfg = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
// Resolves once persistence is configured. Awaited before any sign-in so a session
// can never be created under the default before browserLocalPersistence lands.
let persistenceReady: Promise<void> = Promise.resolve();

export function firebaseConfigured(): boolean {
  return Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId);
}
function init() {
  if (!firebaseConfigured()) return false;
  if (!app) app = getApps()[0] ?? initializeApp(cfg);
  if (!auth) {
    auth = getAuth(app);
    // Keep the customer signed in across tabs and revisits. If IndexedDB/localStorage
    // is unavailable (Safari Private, storage-partitioned in-app webviews) the SDK
    // falls back to IN-MEMORY persistence — which reads to the customer as "signed in
    // until I refresh". Log it rather than swallow it; it's the first thing to check
    // when someone reports being logged out.
    persistenceReady = setPersistence(auth, browserLocalPersistence).catch((e) => {
      console.warn('[firebase] persistent session unavailable — sign-in will not survive a refresh', e);
    });
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

// getSessionUser() resolves once and stops listening, so a session that arrives late
// — a completed redirect, a token refresh, a sign-in in another tab — is never seen.
// Subscribe when you need to react to that. Returns an unsubscribe function.
export function subscribeUser(cb: (user: User | null) => void): () => void {
  if (!init()) { cb(null); return () => {}; }
  return onAuthStateChanged(auth!, cb);
}

export async function getIdToken(forceRefresh = false): Promise<string | null> {
  if (!init()) return null;
  return auth!.currentUser ? auth!.currentUser.getIdToken(forceRefresh) : null;
}

// Always show the Google account picker — vital when several Google accounts are
// signed in, so the user can pick the Mir Kash one instead of the default.
function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

// Popup first, redirect if the environment won't allow one.
//
// NB: this used to call fbSignOut() first, to force the Google account chooser. That
// signed the customer OUT before the popup opened — so a blocked or closed popup left
// them logged out with no session to fall back to, which is precisely the "I don't
// stay signed in" complaint. The chooser is already guaranteed by
// prompt:'select_account' in googleProvider(), so the sign-out was redundant.
//
// Returns null when the flow continued as a full-page redirect: the tab is navigating
// away and completeRedirect() picks the session up on the way back.
export async function signInWithGoogle(): Promise<User | null> {
  if (!init()) return null;
  await persistenceReady;
  try {
    const { user } = await signInWithPopup(auth!, googleProvider());
    return user;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code ?? '';
    // In-app browsers (Instagram, WhatsApp) block popups outright, and some
    // privacy configurations refuse the popup's storage access. Redirect works
    // in all of them.
    if (POPUP_UNAVAILABLE.has(code)) {
      await signInWithGoogleRedirect();
      return null;
    }
    throw e;
  }
}

// Popup failures that mean "this browser won't do popups" — as opposed to
// "the customer changed their mind", which must stay an error the caller can ignore.
const POPUP_UNAVAILABLE = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
  'auth/internal-error',
]);

// Full-page redirect sign-in — the reliable fallback when a popup is blocked/closed
// (strict third-party-storage browsers). Navigates away; the session is picked up by
// completeRedirect() on return.
export async function signInWithGoogleRedirect(): Promise<void> {
  if (!init()) return;
  await persistenceReady;
  await signInWithRedirect(auth!, googleProvider());
}

export async function completeRedirect(): Promise<User | null> {
  if (!init()) return null;
  try { const r = await getRedirectResult(auth!); return r?.user ?? null; }
  catch { return null; }
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

