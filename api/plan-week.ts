// api/plan-week.ts — Vercel Serverless Function
// Aligns response shape with WeeklyWorkoutPlan.tsx by ensuring
// blocks[].moves is an array of **strings**, not objects.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { z } from 'zod';

const PlanWeekSchema = z.object({
  goal: z.enum(['cut','lean','bulk','recomp']),
  days_available: z.number().min(1).max(7),
  minutes: z.number().min(10).max(120),
  style: z.enum(['strength','hybrid','bodyweight','cardio','crossfit']),
  intensity: z.enum(['easy','moderate','hard']).default('moderate'),
  experience: z.enum(['beginner','intermediate','advanced']).default('intermediate'),
  equipment: z.array(z.string()).default([])
});

function parsePoundsList(arr: string[]): number[] {
  const out: number[] = [];
  for (const s of arr || []) {
    const m = s.match(/(\d+)\s?lb/i);
    if (m) out.push(parseInt(m[1], 10));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
function hasAnyEquipment(equipment: string[]): boolean {
  return Array.isArray(equipment) && equipment.some(s => /\d+\s?lb|barbell|bench|bike|treadmill/i.test(s));
}
function equipmentRulesText(equipment: string[]) {
  const dbs = parsePoundsList(equipment.filter(s => /db|dumbbell/i.test(s)));
  const kbs = parsePoundsList(equipment.filter(s => /kb|kettlebell/i.test(s)));
  const mbs = parsePoundsList(equipment.filter(s => /med(icine)? ball/i.test(s)));
  const slams = parsePoundsList(equipment.filter(s => /slam ball/i.test(s)));

  const hasBarbell = equipment.some(s => /barbell/i.test(s));
  const hasBench = equipment.some(s => /bench/i.test(s));
  const hasBike = equipment.some(s => /assault|air ?bike|bike|row(er)?/i.test(s));

  const lines: string[] = [];
  if (dbs.length) lines.push(`Dumbbells (lb): ${dbs.join(', ')}`);
  if (kbs.length) lines.push(`Kettlebells (lb): ${kbs.join(', ')}`);
  if (mbs.length) lines.push(`Medicine balls (lb): ${mbs.join(', ')}`);
  if (slams.length) lines.push(`Slam balls (lb): ${slams.join(', ')}`);
  if (hasBarbell) lines.push(`Barbell with plates`);
  if (hasBench) lines.push(`Flat bench`);
  if (hasBike) lines.push(`Assault/Air bike or rower`);

  const rules: string[] = [
    `Only program movements that are supported by the listed equipment.`,
    `Express **all** loads in **pounds (lb)** — never kg.`,
    `No cable/machine work unless explicitly listed.`,
    `Scale loads for the given intensity and experience.`,
    `Sessions must complete within the requested minutes.`,
  ];

  return { lines, rules: rules.join('\n') };
}

// Fallback plan with string moves
function getFallbackPlan(style: string, days: number, minutes: number) {
  const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const plan = Array.from({ length: days }, (_, i) => ({
    day: dayNames[i % 7],
    title: `${style} — ${minutes} min`,
    blocks: [
      {
        name: 'Warm-up',
        description: '5–8 min easy cardio + dynamic mobility',
        time_min: 8,
        moves: ['Jumping Jacks — 2:00', 'World’s Greatest Stretch — 1/side']
      },
      {
        name: 'Main',
        description: 'Simple, equipment-light circuit',
        time_min: Math.max(10, minutes - 8 - 5),
        moves: ['Air Squat — 15 reps', 'Push-up — 12 reps', 'Bent‑over DB Row — 10/arm (25 lb)']
      },
      {
        name: 'Cool-down',
        description: 'Walk + stretch breathing',
        time_min: 5,
        moves: ['Walk — 3:00', 'Quad/Hamstring stretch — 0:30 each']
      }
    ],
    est_calories: 220
  }));

  return { plan, benefits: 'Baseline plan used due to API issue.' };
}

// Normalize any object-shaped move to a single string line
function stringifyMove(m: any): string {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  // known shapes
  const name = m.name || m.exercise || m.move || 'Move';
  const sets = m.sets ?? m.sets_x ?? undefined;
  const reps = m.reps ?? m.repetitions ?? undefined;
  const time = m.time_min ? `${m.time_min} min` : (m.time ?? undefined);
  const load = (m.load_lb ?? m.weight ?? m.weight_lb);
  const side = m.per_side ? ' / side' : '';
  const parts = [
    name,
    sets != null && reps != null ? `— ${sets} x ${reps}` : (reps != null ? `— ${reps}` : undefined),
    time ? `— ${time}` : undefined,
    load != null ? ` — ${load} lb${side}` : undefined
  ].filter(Boolean);
  return parts.join(' ');
}

function normalizePlanShape(json: any) {
  if (!json || !Array.isArray(json.plan)) return getFallbackPlan('hybrid', 3, 30);
  const norm = {
    plan: json.plan.map((d: any) => ({
      day: d.day || d.name || 'Day',
      title: d.title || 'Workout',
      blocks: (d.blocks || d.sections || []).map((b: any) => ({
        name: b.name || b.title || 'Block',
        description: b.description || '',
        time_min: typeof b.time_min === 'number' ? b.time_min : undefined,
        moves: (b.moves || b.items || b.exercises || []).map(stringifyMove)
      })),
      est_calories: typeof d.est_calories === 'number' ? d.est_calories : (d.calories ?? 200)
    })),
    benefits: json.benefits || ''
  };
  // Ensure at least one move string exists to avoid empty rendering
  if (!norm.plan.length || !norm.plan[0].blocks?.length) {
    return getFallbackPlan('hybrid', 3, 30);
  }
  return norm;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const parsed = PlanWeekSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { goal, days_available, minutes, style, equipment, experience, intensity } = parsed.data;

  // No key in prod → return safe fallback so UI renders
  if (!process.env.OPENAI_API_KEY) {
    const fallback = getFallbackPlan(style, days_available, minutes);
    return res.status(200).json({ success: true, data: fallback });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const eqInfo = equipmentRulesText(equipment || []);
    const eqHeader = hasAnyEquipment(equipment)
      ? `Available Equipment:\n- ${eqInfo.lines.join('\n- ')}`
      : 'No equipment listed — use bodyweight only.';

    const systemPrompt = `You are a meticulous workout planner. Output STRICT JSON; NO markdown.`;

    // IMPORTANT: moves must be array of strings
    const userPrompt = `Create a ${days_available}-day ${style} workout plan:
- Goal: ${goal}
- Duration: ${minutes} minutes/session
- Intensity: ${intensity}
- Experience: ${experience}
${eqHeader}

Rules:
${eqInfo.rules}

Return ONLY a JSON object EXACTLY in this shape (moves MUST be strings):
{
  "plan":[
    {
      "day":"Monday",
      "title":"string",
      "blocks":[
        {"name":"Warm-up","description":"string","time_min":8,"moves":["Move — details","Move — details"]},
        {"name":"Main","description":"string","time_min":22,"moves":["Move — details","Move — details"]},
        {"name":"Cool-down","description":"string","time_min":5,"moves":["Move — details"]}
      ],
      "est_calories": 250
    }
  ],
  "benefits":"string"
}`;

    const out = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    const text = out.choices?.[0]?.message?.content || '';
    let json: any;
    try { json = JSON.parse(text); } catch { json = null; }

    const normalized = normalizePlanShape(json);
    return res.status(200).json({ success: true, data: normalized });
  } catch (err: any) {
    console.error('[/api/plan-week] error:', err?.stack || err);
    const fallback = getFallbackPlan(style, days_available, minutes);
    return res.status(200).json({ success: true, data: fallback });
  }
}
