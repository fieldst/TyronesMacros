export const config = {
  runtime: 'nodejs',          // keep serverless runtime
  regions: ['sfo1', 'cle1']   // pin away from iad1
};

// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const {
      prompt = '',
      system = '',
      model = 'gpt-4o-mini',
      temperature = 0.7,
      expectJson = false,
    } = (req.body ?? {}) as {
      prompt?: string;
      system?: string;
      model?: string;
      temperature?: number;
      expectJson?: boolean;
    };

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Type-safe roles for the current OpenAI SDK
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: system || '' },
      { role: 'user', content: prompt || '' },
    ];

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model,
      messages,
      temperature,
      ...(expectJson ? { response_format: { type: 'json_object' as const } } : {}),
    };

    const out = await client.chat.completions.create(params);
    const text = out.choices?.[0]?.message?.content ?? '';

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, data: { text } });
  } catch (err: any) {
    console.error('[/api/generate] error:', err?.stack || err);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}
