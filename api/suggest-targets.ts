// /api/suggest-targets.ts
import OpenAI from 'openai';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { sex, age, height_cm, weight_kg, activity, goal_text } = (req.body ?? {}) as {
      sex?: 'male'|'female'|'other';
      age?: number;
      height_cm?: number;
      weight_kg?: number;
      activity?: 'sedentary'|'light'|'moderate'|'active'|'very_active';
      goal_text?: string;
    };

    const system = `
You are a certified sports nutrition assistant. Output JSON only:
{ "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "rationale": string }
Use Mifflin–St Jeor for BMR, multiply by activity factor; adjust per goal (maintain≈TDEE, cut≈-15%, recomp≈-5%, gain≈+10%).
Protein ~0.8g–1.0g per lb (pick middle), fat 20–30% kcal, remainder carbs.`;

    const user = JSON.stringify({ sex, age, height_cm, weight_kg, activity, goal_text });

    const out = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const raw = out.choices?.[0]?.message?.content ?? '{}';
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    // clamp helpers for safety
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n || 0)));
    const calories = clamp(parsed.calories ?? 2200, 1200, 4500);
    const protein_g = clamp(parsed.protein_g ?? 160, 40, 400);
    const fat_g = clamp(parsed.fat_g ?? 70, 20, 200);
    const carbs_g = clamp(parsed.carbs_g ?? (calories - protein_g * 4 - fat_g * 9) / 4, 20, 800);
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : 'Targets generated from inputs and goal.';

    return res.status(200).json({ calories, protein_g, carbs_g, fat_g, rationale });
  } catch (e: any) {
    console.error('[/api/suggest-targets] error:', e?.stack || e);
    return res.status(500).json({ error: e?.message || 'Failed to suggest targets' });
  }
}
