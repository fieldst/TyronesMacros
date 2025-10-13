// api/plan-week.ts — COMPATIBLE with WeeklyWorkoutPlan.tsx + openaiService.planWeek
// - Accepts { minutes, days, goal, style, intensity, experience, focus, equipment }
// - Also accepts { minutesPerSession, availableDays, goal, style, experience, equipment }
// - Returns: { success: true, data: { week: DaySpec[] } }
//   where DaySpec = { day: string, warmup: string[], main: string[], finisher?: string, cooldown: string[] }
//
// Uses Response return via wrap() so it works with your existing _wrap.ts.
// If you prefer Vercel Node style, you can wrap this POST call in a default export.

import { z } from 'zod'
import { wrap, validate } from './_wrap'
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Input schemas (either shape)
const SchemaA = z.object({
  minutes: z.number().min(10).max(120),
  days: z.number().min(1).max(7),
  goal: z.string(),
  style: z.string(),
  intensity: z.string().optional().default('moderate'),
  experience: z.string().optional().default('intermediate'),
  focus: z.array(z.string()).optional().default([]),
  equipment: z.array(z.string()).optional().default([]),
})

const SchemaB = z.object({
  minutesPerSession: z.number().min(10).max(120),
  availableDays: z.array(z.string()).nonempty(), // ['Mon','Tue',...]
  goal: z.string(),
  style: z.string(),
  experience: z.string().optional().default('intermediate'),
  equipment: z.array(z.string()).optional().default([]),
})

// Unified validated input
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
  // Try A
  const a = SchemaA.safeParse(body)
  if (a.success) {
    return {
      minutes: a.data.minutes,
      days: a.data.days,
      goal: a.data.goal,
      style: a.data.style,
      intensity: a.data.intensity || 'moderate',
      experience: a.data.experience || 'intermediate',
      focus: a.data.focus || [],
      equipment: a.data.equipment || [],
    }
  }
  // Try B
  const b = SchemaB.safeParse(body)
  if (b.success) {
    return {
      minutes: b.data.minutesPerSession,
      days: Math.max(1, Math.min(7, b.data.availableDays.length)),
      goal: b.data.goal,
      style: b.data.style,
      intensity: 'moderate',
      experience: b.data.experience || 'intermediate',
      focus: [],
      equipment: b.data.equipment || [],
    }
  }
  // As last resort, throw SchemaA errors (keeps your previous 400 shape)
  validate(SchemaA, body)
  // unreachable
  return {
    minutes: 40, days: 3, goal: 'recomp', style: 'hybrid',
    intensity: 'moderate', experience: 'intermediate', focus: [], equipment: []
  }
}

// Helpers
function sanitize(text: string): string {
  return (text || '').replace(/\b(\d+)\s?kg\b/gi, (_, n) => `${Math.round(Number(n)*2.20462)} lb`)
}

function weekFromPlanBlocksLike(plan: any[]): any[] {
  // map {title, blocks:[{exercise,sets,reps,minutes}]} → {day,title?, warmup/main/cooldown}
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

// Build equipment paragraph for the prompt
function equipmentText(equipment: string[]): string {
  if (!Array.isArray(equipment) || !equipment.length) return 'No equipment listed — bodyweight only.'
  return 'Available Equipment:\\n- ' + equipment.map(s => sanitize(String(s))).join('\\n- ')
}

export const POST = wrap(async (req: Request) => {
  // robust JSON body parsing (supports cases where body arrives as string/empty)
  let body: any = {}
  try {
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      body = await req.json()
    } else {
      const text = await req.text()
      body = text ? JSON.parse(text) : {}
    }
  } catch { body = {} }

  const inp = coerceInput(body)

  if (!process.env.OPENAI_API_KEY) {
    const fb = fallbackWeek(inp.style, inp.days, inp.minutes)
    return new Response(JSON.stringify({ success: true, data: fb }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
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
        // sanitize any text to lb units
        json.week = json.week.map((d: any) => ({
          day: d.day || 'Day',
          warmup: (Array.isArray(d.warmup) ? d.warmup : []).map(sanitize),
          main: (Array.isArray(d.main) ? d.main : []).map(sanitize),
          finisher: typeof d.finisher === 'string' ? sanitize(d.finisher) : undefined,
          cooldown: (Array.isArray(d.cooldown) ? d.cooldown : []).map(sanitize),
        }))
        return new Response(JSON.stringify({ success: true, data: json }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Some models of yours previously returned { plan: [...] }
      if (Array.isArray(json?.plan)) {
        const week = weekFromPlanBlocksLike(json.plan)
        return new Response(JSON.stringify({ success: true, data: { week, benefits: json.benefits || '' } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } catch {}

    const fb = fallbackWeek(inp.style, inp.days, inp.minutes)
    return new Response(JSON.stringify({ success: true, data: fb }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[/api/plan-week] error', err)
    const fb = fallbackWeek(inp.style, inp.days, inp.minutes)
    return new Response(JSON.stringify({ success: true, data: fb }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
