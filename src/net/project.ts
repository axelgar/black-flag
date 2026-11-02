// The Supabase project, when the build does not name another: the one the phones and the
// scripts use. The sea server names it again in server/wrangler.jsonc. A build points
// elsewhere with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.

export const SUPABASE_URL = 'https://vspueoyeaorfmbmefhiv.supabase.co';
// Publishable: it is meant to ship in the page. What a phone may do is decided by the
// database's own rules (supabase/migrations), not by keeping this secret.
export const SUPABASE_KEY = 'sb_publishable_mbZmUcrjjPBgNHqvdgu2_g_D_Xvyamy';
