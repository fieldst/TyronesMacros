// /api/suggest-targets.ts

import OpenAI from 'openai';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { sex, age, height_cm, weight_kg, activity, goal_text } = req.body || {};

    const system = `
You are a certified sports nutrition assistant. Output JSON only:
{ "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "rationale": string }
Rules:
- One set of realistic daily targets for ONE person.
- Calories 1200–4500.
- Protein 1.6–2.4 g/kg (or 0.7–1.1 g/lb) unless explicitly requested otherwise; justify.
- Fat 0.6–1.0 g/kg or 20–35% calories.
- Carbs fill the remainder.
- Reflect activity level + goal_text and explain choices in rationale.
`;

    const user = JSON.stringify({ sex, age, height_cm, weight_kg, activity, goal_text });

    const rsp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.25,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(rsp.choices[0].message.content || '{}');

    // clamp helpers for safety
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)));
    const calories = clamp(parsed.calories ?? 2200, 1200, 4500);
    const protein_g = clamp(parsed.protein_g ?? 160, 40, 400);
    const fat_g = clamp(parsed.fat_g ?? 70, 20, 200);
    const carbs_g = clamp(
      parsed.carbs_g ?? (calories - protein_g * 4 - fat_g * 9) / 4,
      20, 800
    );

    res.status(200).json({
      calories, protein_g, carbs_g, fat_g,
      rationale: parsed.rationale || 'Targets generated from inputs and goal.'
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to suggest targets' });
  }
}
