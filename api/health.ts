import { wrap } from './_wrap';

export const GET = wrap(async () =>
  new Response(JSON.stringify({
    success: true,
    timestamp: new Date().toISOString(),
    env: {
      OPENAI: !!process.env.OPENAI_API_KEY,
      SUPA_URL: !!process.env.VITE_SUPABASE_URL,
      SUPA_KEY: !!process.env.VITE_SUPABASE_ANON_KEY
    }
  }), { 
    headers: { 'Content-Type': 'application/json' } 
  })
);

export const POST = GET;