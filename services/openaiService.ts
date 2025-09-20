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

async function callServer(body: any): Promise<string> {
  const model = getSelectedModel();
  const url = '/api/generate'; // always same-origin; Vite dev proxy handles 5173->3001 in dev

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, ...body }),
      signal: ac.signal,
    });

    // Rate headers -> banner (best-effort)
    try {
      const limit = Number(res.headers.get('X-RateLimit-Limit') || 0);
      const remaining = Number(res.headers.get('X-RateLimit-Remaining') || 0);
      const reset = Number(res.headers.get('X-RateLimit-Reset') || 0);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rate-update', { detail: { limit, remaining, reset } }));
      }
    } catch {}

    // Always read as text first so we can debug raw responses
    const raw = await res.text();
    let payload: any = null;
    try { payload = JSON.parse(raw); } catch { payload = { text: raw }; }

    if (!res.ok) {
      const msg = payload?.error || payload?.message || raw || `HTTP ${res.status}`;
      console.error('API /api/generate error:', { status: res.status, msg, payload });
      throw new Error(msg);
    }

    const out = (payload?.text ?? raw) as string;
    if ((import.meta as any).env?.VITE_DEBUG_AI) {
      console.debug('AI raw text:', out.slice(0, 800));
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/* ================= Features ================= */

export async function estimateMacrosForMeal(mealText: string, profile: Profile): Promise<{ macros: MacroSet; note: string }> {
  const schema = {
    name: 'macro_estimate',
    schema: { type: 'object', properties: {
      calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' },
      portion_grams: { type: 'number' }, assumptions: { type: 'string' }, confidence: { type: 'number' }
    }, required: ['calories','protein','carbs','fat'], additionalProperties: false },
    strict: true,
  };
  const system = 'You are a nutrition assistant. Use standard nutrition references and realistic portions. Return only valid JSON per the schema.';
  const prompt = `Estimate macros for this meal for a person of weight ${profile?.weight_lbs ?? 'unknown'} lbs. Respond with JSON only: calories, protein, carbs, fat. Meal: ${mealText}`;
  const text = await callServer({ prompt, system, expectJson: true, jsonSchema: schema, temperature: 0.2 });
  try {
    const obj = extractFirstJson(text);
    const macros: MacroSet = { calories: +obj.calories || 0, protein: +obj.protein || 0, carbs: +obj.carbs || 0, fat: +obj.fat || 0 };
    return { macros, note: 'AI estimate' };
  } catch {
    return { macros: { calories: 0, protein: 0, carbs: 0, fat: 0 }, note: 'AI estimate (unparsed)' };
  }
}

export async function getWorkoutCalories(workout: string, profile: Profile): Promise<{ total_calories: number }> {
  const schema = { name: 'workout_energy', schema: { type: 'object', properties: { total_calories: { type: 'number' }, assumptions: { type: 'string' } }, required: ['total_calories'], additionalProperties: false }, strict: true };
  const system = 'You are a fitness assistant. Use MET-based logic by activity type/intensity with user weight. Return valid JSON only.';
  const prompt = `Given weight ${profile?.weight_lbs ?? 'unknown'} lbs, estimate TOTAL calories burned for this workout. Return JSON only as { "total_calories": number }. Workout: ${workout}`;
  const text = await callServer({ prompt, system, expectJson: true, jsonSchema: schema, temperature: 0.2 });
  try { const obj = extractFirstJson(text); return { total_calories: +obj.total_calories || 0 }; } catch { return { total_calories: 0 }; }
}

export async function getSwapSuggestion(remaining: MacroSet): Promise<string> {
  const system = 'You are a concise nutrition coach.';
  const prompt = `Suggest one quick food swap to hit these remaining macros: ${JSON.stringify(remaining)}. Keep it to one sentence.`;
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
  const prompt = `Given profile ${JSON.stringify(profile)} and goal "${goal}", compute BMR, TDEE, and derive specific targets. Output JSON with a 'notes' string and an 'options' list with labeled macro targets (calories, protein, carbs, fat).`;
  const text = await callServer({ prompt, system, expectJson: true, jsonSchema: schema, temperature: 0.2 });
  try { const parsed = extractFirstJson(text); if (!Array.isArray(parsed?.options)) throw new Error('Bad shape'); return parsed as { options: TargetOption[]; notes: string }; } catch { return { notes: 'AI options unavailable', options: [] }; }
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
      // Try to split "Item — why" | "Item - why" | "Item: why"
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

  // Strong schema + explicit example to anchor output
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

  const example = {
    suggestions: [
      "Choose grilled over fried to reduce fats",
      "Add ~25g lean protein to better hit targets"
    ],
    better_alternatives: [
      { item: "Grilled chicken wrap (no mayo)", why: "keeps protein, cuts fat" }
    ]
  };

  const prompt =
`User just logged a meal: "${mealText}".
Profile: ${JSON.stringify(profile)}.
Daily targets: ${JSON.stringify(targets)}.
Remaining before this meal: ${JSON.stringify(remainingBefore)}.

Return STRICT JSON that satisfies the schema exactly. No extra keys, no prose.
Example ONLY for shape (do not repeat these values verbatim):
${JSON.stringify(example)}`;

  const text = await callServer({
    prompt, system, expectJson: true, jsonSchema: schema, temperature: 0.2
  });

  try {
    const parsed = extractFirstJson(text);
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim())
      : [];

    let alts = normalizeAlternatives(parsed?.better_alternatives);

    // If model still failed the shape, attempt recovery by scraping from a common fallback field
    if (alts.length === 0 && Array.isArray(parsed?.alternatives)) {
      alts = normalizeAlternatives(parsed.alternatives);
    }

    return { suggestions, better_alternatives: alts };
  } catch (e: any) {
    throw new Error(e?.message || 'Could not parse AI coaching JSON.');
  }
}
