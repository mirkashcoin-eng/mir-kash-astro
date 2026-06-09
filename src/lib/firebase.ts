// Firebase Phone Auth — CLIENT-SIDE ONLY. Imported from the checkout's browser
// script to verify the buyer's phone via SMS OTP before payment. All config here
// is the public Firebase web config (safe to expose). India checkout only.
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth';

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function firebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId);
}

function getFirebaseAuth(): Auth {
  if (!app) app = getApps()[0] ?? initializeApp(config);
  if (!auth) auth = getAuth(app);
  return auth;
}

// Builds an invisible reCAPTCHA bound to the given container element id.
export function createRecaptcha(containerId: string): RecaptchaVerifier {
  return new RecaptchaVerifier(getFirebaseAuth(), containerId, { size: 'invisible' });
}

// Sends an SMS OTP to an E.164 phone (e.g. "+919876543210").
export function sendOtp(phoneE164: string, verifier: RecaptchaVerifier): Promise<ConfirmationResult> {
  return signInWithPhoneNumber(getFirebaseAuth(), phoneE164, verifier);
}

// Confirms the 6-digit code; resolves to the verified phone on success, throws on failure.
export async function confirmOtp(confirmation: ConfirmationResult, code: string): Promise<string> {
  const cred = await confirmation.confirm(code);
  return cred.user.phoneNumber ?? '';
}
