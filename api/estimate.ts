// api/estimate.ts
// Adapter so the client can POST /api/estimate in all environments.
// Delegates to the existing /api/estimate-macros route.

import type { VercelRequest, VercelResponse } from '@vercel/node';

// import the existing handler from estimate-macros
// NOTE: your estimate-macros exports a fetch-style POST(Request) handler
// If your file exports differently, adjust this import name accordingly.
import { POST as estimateMacrosPOST } from './estimate-macros';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // The client sends { description: string }
    const { description, userGoals, timezone } = (req.body ?? {}) as {
      description?: string;
      userGoals?: 'cut' | 'recomp' | 'bulk' | 'lean' | 'maintain';
      timezone?: string;
    };
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ success: false, error: "Missing required field 'description' (string)" });
    }

    // Convert to the shape your estimate-macros expects: { text, ... }
    const url = new URL(req.url || 'http://localhost/api/estimate'); // required by Request
    const forward = new Request(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: description, userGoals, timezone }),
    });

    const response = await estimateMacrosPOST(forward);

    // Pass through the response
    const body = await response.text();
    res.status(response.status);
    const ct = response.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);
    return res.send(body);
  } catch (err: any) {
    console.error('[/api/estimate adapter] error:', err?.stack || err);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}
