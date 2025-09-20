// api/generate.ts
// Robust Responses API handler that adapts to the server's supported
// structured-output parameter shape (text.schema / text.json_schema / response_format)
// and surfaces helpful errors for debugging.

import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '.env.local' });

import OpenAI from 'openai';

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

export default async function handler(req: any, res: any) {
  // CORS for local/dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY missing in .env.local' });
  const client = new OpenAI({ apiKey });

  // very small per-IP limiter
  const ip =
    (Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'][0]
      : (req.headers['x-forwarded-for'] as string)) ||
    (req.socket && (req.socket as any).remoteAddress) || 'anon';
  const ipKey = String(ip).split(',')[0].trim();
  const now = Date.now();
  let bucket = buckets.get(ipKey);
  if (!bucket || now > bucket.reset) bucket = { count: 0, reset: now + RATE_LIMIT_WINDOW_MS };
  bucket.count += 1;
  buckets.set(ipKey, bucket);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - bucket.count)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));
  if (bucket.count > RATE_LIMIT_MAX) return res.status(429).json({ error: 'Rate limit exceeded' });

  // parse body safely
  let body: any = (req as any).body;
  if (!body) {
    try { body = JSON.parse((req as any).rawBody?.toString() || '{}'); } catch { body = {}; }
  }
  const { prompt, system, model, expectJson, jsonSchema, temperature } = body || {};
  if (!prompt || !system) return res.status(400).json({ error: 'Missing prompt or system' });

  // mock mode for UI development (optional)
  if (process.env.MOCK_OPENAI === '1') {
    if (expectJson) {
      return res.status(200).json({
        text: JSON.stringify({
          suggestions: ['Swap fries for salad', 'Add ~25g lean protein'],
          better_alternatives: [{ item: 'Grilled chicken wrap (no mayo)', why: 'cuts fat, keeps protein' }],
          total_calories: 420,
          calories: 420, protein: 30, carbs: 45, fat: 12
        }),
      });
    }
    return res.status(200).json({ text: 'Mock response: Hello from MOCK_OPENAI.' });
  }

  // Build the shared base request
  const baseOptions: any = {
    model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    input: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: typeof temperature === 'number' ? temperature : 0.2,
  };

  async function tryCall(opts: any) {
    const resp = await client.responses.create(opts);
    const text =
      (resp as any).output_text ??
      (resp as any).content?.[0]?.text ??
      JSON.stringify(resp);
    return text;
  }

  try {
    // 1) New style A: text.format with schema under `schema`
    if (expectJson && jsonSchema) {
      try {
        const a = { ...baseOptions, text: { format: 'json_schema', schema: jsonSchema } };
        const text = await tryCall(a);
        return res.status(200).json({ text });
      } catch (e: any) {
        const msg = (e?.response?.data?.error?.message || e?.message || '').toLowerCase();
        // If it's not a shape error, rethrow immediately
        if (!msg.includes('unknown parameter') && !msg.includes('unsupported') && e?.status !== 400) throw e;
      }
    }

    // 2) New style B: text.format with schema under `json_schema`
    if (expectJson && jsonSchema) {
      try {
        const b = { ...baseOptions, text: { format: 'json_schema', json_schema: jsonSchema } };
        const text = await tryCall(b);
        return res.status(200).json({ text });
      } catch (e: any) {
        const msg = (e?.response?.data?.error?.message || e?.message || '').toLowerCase();
        if (!msg.includes('unknown parameter') && !msg.includes('unsupported') && e?.status !== 400) throw e;
      }
    }

    // 3) Legacy: response_format json_schema
    if (expectJson && jsonSchema) {
      try {
        const c = { ...baseOptions, response_format: { type: 'json_schema', json_schema: jsonSchema } };
        const text = await tryCall(c);
        return res.status(200).json({ text });
      } catch (e: any) {
        const msg = (e?.response?.data?.error?.message || e?.message || '').toLowerCase();
        if (!msg.includes('unknown parameter') && !msg.includes('unsupported') && e?.status !== 400) throw e;
      }
    }

    // 4) Plain JSON mode (no schema): try new, then legacy
    if (expectJson && !jsonSchema) {
      try {
        const d = { ...baseOptions, text: { format: 'json' } };
        const text = await tryCall(d);
        return res.status(200).json({ text });
      } catch (e: any) {
        const e2 = { ...baseOptions, response_format: { type: 'json_object' } };
        const text = await tryCall(e2);
        return res.status(200).json({ text });
      }
    }

    // 5) No JSON requested → normal text
    const text = await tryCall(baseOptions);
    return res.status(200).json({ text });
  } catch (e: any) {
    const status = e?.status || e?.response?.status || 500;
    const msg =
      e?.error?.message ||
      e?.response?.data?.error?.message ||
      e?.message ||
      'Server error';
    console.error('OpenAI error:', msg, e?.response?.data || '');
    return res.status(status).json({ error: msg });
  }
}
