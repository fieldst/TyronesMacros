// api/estimate.ts
// Production-safe adapter: expose POST /api/estimate and forward to /api/estimate-macros
// without importing from it (avoids Node/Edge export/runtime mismatches).

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { description, userGoals, timezone } = (req.body ?? {}) as {
      description?: string;
      userGoals?: 'cut' | 'recomp' | 'bulk' | 'lean' | 'maintain';
      timezone?: string;
    };

    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ success: false, error: "Missing required field 'description' (string)" });
    }

    // Build same-origin base (works on Vercel behind proxies)
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host = req.headers.host as string;
    const origin = `${proto}://${host}`;

    // Forward to your existing route, mapping payload to what it expects
    const forward = await fetch(`${origin}/api/estimate-macros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: description, userGoals, timezone }),
    });

    const bodyText = await forward.text();
    res.status(forward.status);
    res.setHeader('Content-Type', forward.headers.get('content-type') || 'application/json');
    return res.send(bodyText);
  } catch (err: any) {
    console.error('[/api/estimate adapter] error:', err?.stack || err);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}
