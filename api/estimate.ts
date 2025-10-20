// api/estimate.ts
// Canonical Node serverless function for POST /api/estimate
// Reads req.body.description, returns { success: true, data: { totals } }
export const config = {
  runtime: 'nodejs',          // keep serverless runtime
  regions: ['sfo1', 'cle1']   // pin away from iad1
};
import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

type Totals = { calories: number; protein: number; carbs: number; fat: number };

function clampTotals(t: any): Totals {
  const n = (x: any) => Math.max(0, Math.round(Number(x) || 0));
  return { calories: n(t?.calories), protein: n(t?.protein), carbs: n(t?.carbs), fat: n(t?.fat) };
}



function safeJSON<T=any>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch {}
  const fenced = s.match(/```json([\s\S]*?)```/i) || s.match(/```([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]) as T; } catch {} }
  const brace = s.match(/[\[{][\s\S]*[\]}]/);
  if (brace) { try { return JSON.parse(brace[0]) as T; } catch {} }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { description } = (req.body ?? {}) as { description?: string };
  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ success: false, error: "Missing required field 'description' (string)" });
  }

  // If no key configured, return a conservative fallback (never 500 in prod)
  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      success: true,
      data: { totals: clampTotals({ calories: 250, protein: 15, carbs: 20, fat: 10 }) }
    });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const system =
      "Given a meal description, return STRICT JSON with:\n" +
      '{"totals":{"calories":number,"protein":number,"carbs":number,"fat":number}}';

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: description }
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    const parsed = safeJSON<{ totals?: Totals }>(raw);
    const totals = clampTotals(parsed?.totals ?? {});

    return res.status(200).json({ success: true, data: { totals } });
  } catch (err: any) {
    console.error('[/api/estimate] error:', err?.stack || err);
    // graceful fallback
    return res.status(200).json({
      success: true,
      data: { totals: clampTotals({ calories: 250, protein: 15, carbs: 20, fat: 10 }) },
      note: 'fallback',
    });
  }
}
