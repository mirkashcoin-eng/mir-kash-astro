// Server-side Firebase ID-token verification WITHOUT a service account.
// Firebase ID tokens are RS256 JWTs signed by Google; verify against Google's
// public JWKS and check issuer/audience = the Firebase project id. Returns the
// authenticated email — the only thing that unlocks a customer's Shopify orders.
import { createRemoteJWKSet, jwtVerify } from 'jose';

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export async function verifyFirebaseUser(token: string): Promise<{ email: string } | null> {
  const projectId = getEnv('PUBLIC_FIREBASE_PROJECT_ID');
  if (!token || !projectId) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    const email = (payload as { email?: string; email_verified?: boolean }).email;
    return email ? { email } : null;
  } catch {
    return null;
  }
}
