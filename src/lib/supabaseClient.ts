// Browser-side Supabase client for customer accounts (Google sign-in + saved
// address profile). Returns null until PUBLIC_SUPABASE_* are configured, so every
// caller degrades gracefully. Server lead-capture lives in `supabase.ts`.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.PUBLIC_SUPABASE_URL;
const ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null | undefined;

export function supabaseAuthConfigured(): boolean {
  return Boolean(URL && ANON);
}

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  client = supabaseAuthConfigured() ? createClient(URL, ANON) : null;
  return client;
}

export interface Profile {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  email?: string | null;
}

export async function getSessionUser() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export async function getAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithGoogle(redirectTo: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
}

export async function loadProfile(userId: string): Promise<Profile | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  return (data as Profile) ?? null;
}

export async function saveProfile(p: Profile): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('profiles').upsert({ ...p, updated_at: new Date().toISOString() });
  return !error;
}
