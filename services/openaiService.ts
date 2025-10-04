// services/openaiService.ts
import type { MacroSet, Profile, Goal } from '../types';

const DEFAULT_MODEL = (import.meta as any).env?.VITE_OPENAI_MODEL || 'gpt-4o-mini';

export type TargetOption = {
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function getSelectedModel(): string {
  try {
    if (typeof window === 'undefined') return DEFAULT_MODEL;
    const m = localStorage.getItem('selectedModel');
    return m || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function extractFirstJson(text: string): any {
  const fenced = text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); } catch {}
  const braceMatch = candidate.match(/[\[{][\s\S]*[\]}]/);
  if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch {} }
  try { return JSON.parse(candidate.replace(/^[^{\[]*/, '').replace(/[^}\]]*$/, '')); } catch {}
  throw new Error('Unable to parse JSON from model response');
}

/* ---------------- Internal helpers ---------------- */

async function fetchJSON(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let payload: any = null;
  try { payload = JSON.parse(raw); } catch { payload = { text: raw }; }
  return { ok: res.ok, status: res.status, payload, raw };
}

// Server text generation (shared)
async function callServer(body: any): Promise<string> {
  const model = getSelectedModel();
  const url = '/api/generate'; // dev: Vite proxy -> local API; prod: Vercel function

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, ...body }),
      signal: ac.signal,
    });

    // best-effort rate banner
    try {
      const limit = Number(res.headers.get('X-RateLimit-Limit') || 0);
      const remaining = Number(res.headers.get('X-RateLimit-Remaining') || 0);
      const reset = Number(res.headers.get('X-RateLimit-Reset') || 0);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rate-update', { detail: { limit, remaining, reset } }));
      }
    } catch {}

    const raw = await res.text();
    let payload: any = null;
    try { payload = JSON.parse(raw); } catch { payload = { text: raw }; }

    if (!res.ok || payload?.success === false) {
      const msg = payload?.error || payload?.message || raw || `HTTP ${res.status}`;
      console.error('API /api/generate error:', { status: res.status, msg, payload });
      throw new Error(msg);
    }

    return payload?.data?.text ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/* ================= Features ================= */

/**
 * Works in dev and prod without server changes:
 * - Dev: /api/estimate exists on your local API via Vite proxy
 * - Prod: if /api/estimate is missing on Vercel, fallback to /api/estimate-macros
 */
export async function estimateMacrosForMeal(
  mealText: string,
  _profile: Profile
): Promise<{ macros: MacroSet; note: string }> {

  // 1) Primary: /api/estimate
  {
    const { ok, status, payload, raw } = await fetchJSON('/api/estimate', { description: mealText });
    if (ok && payload?.success !== false) {
      // expected shape: { success: true, data: { totals: { calories, protein, carbs, fat } } }
      const t = payload?.data?.totals ?? payload?.totals;
      if (t && Number.isFinite(+t.calories)) {
        const macros: MacroSet = {
          calories: Math.max(0, Math.round(+t.calories || 0)),
          protein: Math.max(0, Math.round(+t.protein || 0)),
          carbs:   Math.max(0, Math.round(+t.carbs   || 0)),
          fat:     Math.max(0, Math.round(+t.fat     || 0)),
        };
        return { macros, note: 'AI estimate' };
      }
      // wrong shape? fall through
    } else {
      // Only warn if not a 404 (404 is expected in prod when route doesn't exist)
      if (status !== 404) {
        const msg = payload?.error || payload?.message || raw || `HTTP ${status}`;
        console.warn('API /api/estimate error (will fallback):', { status, msg, payload });
      }
    }
  }

  // 2) Fallback: /api/estimate-macros (present in your Vercel repo)
  {
    const { ok, status, payload, raw } = await fetchJSON('/api/estimate-macros', { text: mealText });
    if (!ok || payload?.success === false) {
      const msg = payload?.error || payload?.message || raw || `HTTP ${status}`;
      console.error('API /api/estimate-macros error:', { status, msg, payload });
      throw new Error(msg);
    }

    // Accept common shapes and normalize
    const t =
      payload?.data?.totals ??
      payload?.totals ??
      (payload?.data && 'calories' in payload?.data ? payload?.data : null) ??
      null;

    const totals = t ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const macros: MacroSet = {
      calories: Math.max(0, Math.round(+totals.calories || 0)),
      protein: Math.max(0, Math.round(+totals.protein || 0)),
      carbs:   Math.max(0, Math.round(+totals.carbs   || 0)),
      fat:     Math.max(0, Math.round(+totals.fat     || 0)),
    };
    return { macros, note: 'AI estimate' };
  }
}

export async function getWorkoutCalories(workout: string, profile: Profile): Promise<{ total_calories: number }> {
  const schema = { name: 'workout_energy', schema: { type: 'object', properties: { total_calories: { type: 'number' }, assumptions: { type: 'string' } }, required: ['total_calories'], additionalProperties: false }, strict: true };
  const system = 'You are a fitness assistant. Use MET-based logic by activity type/intensity with user weight. Return valid JSON only.';
  const prompt = `User: ${name || 'friend'}, Date: ${dateKey}, Hour: ${hour}.
Generate a motivational line that feels different from previous days.`;
  const text = await callServer({ prompt, system, expectJson: true, jsonSchema: schema, temperature: 0.2 });
  try { const obj = extractFirstJson(text); return { total_calories: +obj.total_calories || 0 }; } catch { return { total_calories: 0 }; }
}

export async function getSwapSuggestion(remaining: MacroSet): Promise<string> {
  const system = 'You are a concise nutrition coach.';
  const prompt = `User: ${name || 'friend'}, Date: ${dateKey}, Hour: ${hour}.
Generate a motivational line that feels different from previous days.`;
  return await callServer({ prompt, system, temperature: 0.2 });
}

export async function getTargetOptions(profile: Profile, goal: Goal): Promise<{ options: TargetOption[]; notes: string }> {
  const schema = {
    name: 'target_options',
    schema: { type: 'object',
      properties: {
        notes: { type: 'string' },
        options: { type: 'array', items: { type: 'object',
          properties: { label: { type: 'string' }, calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' } },
          required: ['label','calories','protein','carbs','fat'], additionalProperties: false } }
      },
      required: ['options','notes'], additionalProperties: false },
    strict: true
  };
  const system = 'You are a nutrition assistant. Compute BMR via Mifflin-St Jeor and TDEE via activity factor; set targets per goal (maintain≈TDEE, cut≈-15%, recomp≈-5%, gain≈+10%). Protein 0.7–1.0 g/lb (middle). Fat 20–30% kcal; rest carbs. Return JSON per schema.';
  const prompt = `User: ${name || 'friend'}, Date: ${dateKey}, Hour: ${hour}.
Generate a motivational line that feels different from previous days.`;
  const text = await callServer({ prompt, system, expectJson: true, jsonSchema: schema, temperature: 0.2 });
  try {
    const parsed = extractFirstJson(text);
    if (!Array.isArray(parsed?.options)) throw new Error('Bad shape');
    return parsed as { options: TargetOption[]; notes: string };
  } catch {
    return { notes: 'AI options unavailable', options: [] };
  }
}

/* ====== Coaching (hardened) ====== */

function normalizeAlternatives(input: any): { item: string; why: string }[] {
  if (!Array.isArray(input)) return [];
  const out: { item: string; why: string }[] = [];
  for (const it of input) {
    if (it && typeof it === 'object') {
      const item = typeof it.item === 'string' ? it.item.trim() : '';
      const why = typeof it.why === 'string' ? it.why.trim() : '';
      if (item && why) { out.push({ item, why }); continue; }
    }
    if (typeof it === 'string') {
      const parts = it.split(/—|-|:/);
      if (parts.length >= 2) {
        const item = parts[0].trim();
        const why = parts.slice(1).join(':').trim();
        if (item && why) out.push({ item, why });
      }
    }
  }
  return out;
}

export async function getMealCoaching(
  mealText: string,
  profile: Profile,
  remainingBefore: MacroSet,
  targets: MacroSet
): Promise<{ suggestions: string[]; better_alternatives: { item: string; why: string }[] }> {
  const system =
    'You are a concise nutrition coach. Offer practical, budget-conscious tips rooted in basic nutrition. Keep answers specific and short.';

  const schema = {
    name: 'meal_coaching',
    schema: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string' }
        },
        better_alternatives: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          items: {
            type: 'object',
            properties: {
              item: { type: 'string' },
              why: { type: 'string' }
            },
            required: ['item','why'],
            additionalProperties: false
          }
        }
      },
      required: ['suggestions','better_alternatives'],
      additionalProperties: false
    },
    strict: true
  } as const;

  const prompt = `User: ${name || 'friend'}, Date: ${dateKey}, Hour: ${hour}.
Generate a motivational line that feels different from previous days.`;

  const text = await callServer({ prompt, system, expectJson: true, jsonSchema: schema, temperature: 0.2 });

  try {
    const parsed = extractFirstJson(text);
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim())
      : [];

    let alts = normalizeAlternatives(parsed?.better_alternatives);
    if (alts.length === 0 && Array.isArray(parsed?.alternatives)) {
      alts = normalizeAlternatives(parsed.alternatives);
    }

    return { suggestions, better_alternatives: alts };
  } catch (e: any) {
    throw new Error(e?.message || 'Could not parse AI coaching JSON.');
  }
}

export async function getDailyGreeting(
  name: string,
  dateKey: string,
  hour: number
): Promise<string> {
  const system =
    'You are a concise, uplifting fitness & nutrition coach. ' +
    'Write ONE short motivational phrase that feels unique for this day. ' +
    'Incorporate variety based on time of day (morning, afternoon, evening). ' +
    'Keep it actionable, positive, and specific to daily adherence. ' +
    'Make it very uplifting without being to generic. ' +
    'Constraints: 6–16 words, no emojis, no hashtags, no quotes, present-tense only.';

  const prompt = `User: ${name || 'friend'}, Date: ${dateKey}, Hour: ${hour}.
Generate a motivational line that feels different from previous days.`;

  const line = await callServer({ prompt, system, temperature: 0.7 });
  return (line || '').toString();
}

// --- Step 2: Plan Week ---------------------------------
export type PlanWeekOptions = {
  goal: 'cut'|'lean'|'maintain'|'bulk';
  style: 'HIIT'|'cardio'|'strength+cardio'|'CrossFit';
  availableDays: ('Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'|'Sun')[];
  minutesPerSession: number;
  equipment: string[];
  experience: 'beginner'|'intermediate'|'advanced';
  startDate?: string;
};

export async function planWeek(opts: PlanWeekOptions) {
  const resp = await fetch('/api/plan-week', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(opts)
  });
  if(!resp.ok) throw new Error('Failed to plan week');
  return await resp.json();
}
