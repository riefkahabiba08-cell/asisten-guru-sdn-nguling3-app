import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function cleanEnvValue(value: string | undefined): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

const supabaseUrl = cleanEnvValue(
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
    import.meta.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL,
);

const supabaseAnonKey = cleanEnvValue(
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export function isValidSupabaseUrl(value: string): boolean {
  const cleaned = cleanEnvValue(value);
  if (!cleaned) return false;
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey || !isValidSupabaseUrl(supabaseUrl)) {
    return null;
  }
  if (!cachedClient) {
    try {
      cachedClient = createClient(supabaseUrl, supabaseAnonKey);
    } catch {
      return null;
    }
  }
  return cachedClient;
}

export const isClientSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && isValidSupabaseUrl(supabaseUrl),
);
