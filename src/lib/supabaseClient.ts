import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabaseUrl(): string {
  const viteVal =
    import.meta.env && typeof import.meta.env.VITE_SUPABASE_URL === 'string'
      ? import.meta.env.VITE_SUPABASE_URL
      : '';
  if (viteVal.trim()) return viteVal.trim();

  if (typeof process !== 'undefined' && process.env && typeof process.env.VITE_SUPABASE_URL === 'string') {
    return process.env.VITE_SUPABASE_URL.trim();
  }
  return '';
}

function getSupabaseAnonKey(): string {
  const viteVal =
    import.meta.env && typeof import.meta.env.VITE_SUPABASE_ANON_KEY === 'string'
      ? import.meta.env.VITE_SUPABASE_ANON_KEY
      : '';
  if (viteVal.trim()) return viteVal.trim();

  if (typeof process !== 'undefined' && process.env && typeof process.env.VITE_SUPABASE_ANON_KEY === 'string') {
    return process.env.VITE_SUPABASE_ANON_KEY.trim();
  }
  return '';
}

export function getSupabaseConfigStatus() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  const isPlaceholderUrl =
    !url || url.includes('YOUR_PROJECT_REF') || !url.startsWith('https://');
  const isPlaceholderKey =
    !anonKey || anonKey.includes('YOUR_SUPABASE') || anonKey.length < 20;

  return {
    configured: !isPlaceholderUrl && !isPlaceholderKey,
    hasUrl: !isPlaceholderUrl,
    hasAnonKey: !isPlaceholderKey,
    url: isPlaceholderUrl ? '' : url
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfigStatus().configured;
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const { configured } = getSupabaseConfigStatus();
  if (!configured) return null;

  if (!cachedClient) {
    const url = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }

  return cachedClient;
}
