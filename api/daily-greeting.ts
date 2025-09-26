// api/daily-greeting.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ msg: 'Method Not Allowed' });
  try {
    const { name, dateKey, hour, model } = req.body ?? {};
    const system =
      'You are a concise, uplifting fitness & nutrition coach. ' +
      'Write ONE short motivational sentence tailored to the user. ' +
      'Constraints: 6–16 words, no emojis, no hashtags, no quotes, present-tense, at most one exclamation.';
    const prompt =
`User: ${name || 'Athlete'}
Local date: ${dateKey}
Local hour (0–23): ${hour}

Write a single personalized line that motivates the user to stay on track today (food, movement, recovery).
Return ONLY the sentence without quotes or extra text.`;

    const out = await client.chat.completions.create({
      model: model ?? 'gpt-4o-mini',
      temperature: 0.8,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });

    res.status(200).json({ text: out.choices[0]?.message?.content?.trim() ?? '' });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ msg: 'Server error', detail: String(e?.message ?? e) });
  }
}
