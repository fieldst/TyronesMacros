// api/plan-week.ts — Node serverless handler (default export) for Vercel
// Compatible with WeeklyWorkoutPlan.tsx. Returns { success, data: { week, benefits } }.
// Accepts both payload shapes: 
// A) { minutes, days, goal, style, intensity, experience, focus, equipment }
// B) { minutesPerSession, availableDays, goal, style, experience, equipment }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

type Input = {
  minutes: number
  days: number
  goal: string
  style: string
  intensity: string
  experience: string
  focus: string[]
  equipment: string[]
}

function coerceInput(body: any): Input {
  if (body && typeof body === 'object') {
    if ('minutes' in body && 'days' in body) {
      return {
        minutes: Math.max(10, Math.min(120, Number(body.minutes)||40)),
        days: Math.max(1, Math.min(7, Number(body.days)||3)),
        goal: String(body.goal||'recomp'),
        style: String(body.style||'hybrid'),
        intensity: String(body.intensity||'moderate'),
        experience: String(body.experience||'intermediate'),
        focus: Array.isArray(body.focus) ? body.focus.map(String) : [],
        equipment: Array.isArray(body.equipment) ? body.equipment.map(String) : [],
      }
    }
    if ('minutesPerSession' in body && 'availableDays' in body) {
      const days = Array.isArray(body.availableDays) ? body.availableDays.length : 3
      return {
        minutes: Math.max(10, Math.min(120, Number(body.minutesPerSession)||40)),
        days: Math.max(1, Math.min(7, days||3)),
        goal: String(body.goal||'recomp'),
        style: String(body.style||'hybrid'),
        intensity: 'moderate',
        experience: String(body.experience||'intermediate'),
        focus: [],
        equipment: Array.isArray(body.equipment) ? body.equipment.map(String) : [],
      }
    }
  }
  return {
    minutes: 40, days: 3, goal: 'recomp', style: 'hybrid',
    intensity: 'moderate', experience: 'intermediate', focus: [], equipment: []
  }
}

function sanitize(text: string): string {
  return (text || '').replace(/\b(\d+)\s?kg\b/gi, (_, n) => `${Math.round(Number(n)*2.20462)} lb`)
}

function weekFromPlanBlocksLike(plan: any[]): any[] {
  return (Array.isArray(plan) ? plan : []).map((d: any, i: number) => {
    const main: string[] = (Array.isArray(d.blocks) ? d.blocks : []).map((b: any) => {
      const ex = b.exercise || b.name || 'Move'
      const sets = b.sets != null ? String(b.sets) : null
      const reps = b.reps != null ? String(b.reps) : null
      const mins = b.minutes != null ? `${b.minutes} min` : null
      const load = b.load_lb != null ? `${b.load_lb} lb` : (b.weight_lb != null ? `${b.weight_lb} lb` : null)
      const parts = [ex, sets && reps ? `— ${sets} x ${reps}` : (reps ? `— ${reps}` : null), mins ? `— ${mins}` : null, load ? `— ${load}` : null].filter(Boolean)
      return sanitize(parts.join(' '))
    })
    return {
      day: d.day || `Day ${i+1}`,
      warmup: [],
      main,
      cooldown: [],
    }
  })
}

function fallbackWeek(style: string, days: number, minutes: number) {
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const wk = Array.from({length: days}, (_,i) => ({
    day: dayNames[i%7],
    warmup: ['Jumping jacks — 2:00', 'Dynamic lunge — 10/side'],
    main: [
      'Air Squat — 20 reps',
      'Push‑up — 12 reps',
      'Bent‑over DB Row — 10/arm (25 lb)',
    ],
    cooldown: ['Walk — 3:00','Stretch — 2:00'],
  }))
  return { week: wk, benefits: `${style} plan • ~${minutes} min/session` }
}

function equipmentText(equipment: string[]): string {
  if (!Array.isArray(equipment) || !equipment.length) return 'No equipment listed — bodyweight only.'
  return 'Available Equipment:\\n- ' + equipment.map(s => sanitize(String(s))).join('\\n- ')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  // Robust JSON parse
  let body: any = {}
  try {
    if (req.headers['content-type']?.includes('application/json')) body = req.body
    else body = JSON.parse((req as any).rawBody?.toString() || '{}')
  } catch { body = {} }

  const inp = coerceInput(body)

  // No API key? Return a valid, non-empty fallback (prevents empty UI)
  if (!process.env.OPENAI_API_KEY) {
    const fb = fallbackWeek(inp.style, inp.days, inp.minutes)
    return res.status(200).json({ success: true, data: fb })
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const system = `You are a pragmatic workout planner. Always return strict JSON; no markdown.`
    const user = `Create a ${inp.days}-day ${inp.style} plan.
- Goal: ${inp.goal}
- Experience: ${inp.experience}
- Intensity: ${inp.intensity}
- Duration: ${inp.minutes} minutes/session
${equipmentText(inp.equipment)}

Return ONLY a JSON object with this EXACT shape:
{
  "week":[
    {"day":"Mon","warmup":["...","..."],"main":["...","..."],"finisher":"optional string","cooldown":["..."]}
  ],
  "benefits":"string"
}`

    const out = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })

    const txt = out.choices?.[0]?.message?.content || ''
    try {
      const json = JSON.parse(txt)
      if (Array.isArray(json?.week) && json.week.length) {
        json.week = json.week.map((d: any) => ({
          day: d.day || 'Day',
          warmup: (Array.isArray(d.warmup) ? d.warmup : []).map(sanitize),
          main: (Array.isArray(d.main) ? d.main : []).map(sanitize),
          finisher: typeof d.finisher === 'string' ? sanitize(d.finisher) : undefined,
          cooldown: (Array.isArray(d.cooldown) ? d.cooldown : []).map(sanitize),
        }))
        return res.status(200).json({ success: true, data: json })
      }
      if (Array.isArray(json?.plan)) {
        const week = weekFromPlanBlocksLike(json.plan)
        return res.status(200).json({ success: true, data: { week, benefits: json.benefits || '' } })
      }
    } catch {}

    const fb = fallbackWeek(inp.style, inp.days, inp.minutes)
    return res.status(200).json({ success: true, data: fb })
  } catch (err) {
    console.error('[/api/plan-week] error', err)
    const fb = fallbackWeek(inp.style, inp.days, inp.minutes)
    return res.status(200).json({ success: true, data: fb })
  }
}
