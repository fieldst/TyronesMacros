// components/TargetsView.tsx
import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from '../auth';
import { eventBus } from '../lib/eventBus';
import { recalcAndPersistDay } from '../lib/recalcDay';

// ✅ Use your previously working local util first (no API dependency)
import { suggestTargets, type SuggestTargetsResult } from '../utils/suggestTargets';
import { localDateKey } from '../lib/dateLocal';


type Sex = 'male'|'female'
type InferredGoal = 'cut'|'lean'|'bulk'|'recomp'
type Suggestion = {
  kcal: number; protein_g: number; carbs_g: number; fat_g: number;
  why: string; goal_label: InferredGoal;
}

// --- Goal parsing ---------------------------------------------------------
function parseGoalDetails(text: string | null) {
  const raw = (text || '').toLowerCase();

    // rates like "1 lb/week", "2lbs per week", "0.5 lb a week"
  const rateMatch = raw.match(/(\d+(\.\d+)?)\s*(lb|lbs|pounds)\s*\/?\s*(wk|week|per week)/);
  const rateLbsPerWeek = rateMatch ? Math.max(0.1, parseFloat(rateMatch[1])) : null;

  // totals like "lose 20 lb", "gain 10 pounds"
  const totalMatch = raw.match(/(lose|gain|drop|add)\s+(\d+(\.\d+)?)\s*(lb|lbs|pounds)/);
  const verb = totalMatch ? totalMatch[1] : null;
  const totalLbs = totalMatch ? parseFloat(totalMatch[2]) : null;

  // timeline like "in 8 weeks", "over 12 wk"
  const timeMatch = raw.match(/in\s+(\d+)\s*(wk|wks|week|weeks|mo|month|months)/);
  const n = timeMatch ? parseInt(timeMatch[1], 10) : null;
  const weeks = timeMatch ? (timeMatch[2].startsWith('m') ? n! * 4 : n) : null;

  // body fat from→to like "from 20% to 15%" or "20% to 15%"
  const bfMatch = raw.match(/(\d{1,2})\s*%\s*(to|→|-)\s*(\d{1,2})\s*%/);
  const bfFrom = bfMatch ? parseInt(bfMatch[1], 10) : null;
  const bfTo   = bfMatch ? parseInt(bfMatch[3], 10) : null;

  // desired direction
  const isGain = /gain|add|bulk|increase/.test(raw);
  const isLose = /lose|cut|drop|reduce/.test(raw);
  const isRecomp = /recomp|recomposition/.test(raw) || (isGain && isLose);

  let inferred: InferredGoal = 'lean';
  if (isRecomp) inferred = 'recomp';
  else if (isGain) inferred = 'bulk';
  else if (isLose) inferred = 'cut';

  // derive a rate if user gave only total + timeline
  let derivedRate = rateLbsPerWeek;
  if (!derivedRate && totalLbs && weeks && weeks > 0) {
    derivedRate = +(totalLbs / weeks).toFixed(2);
  }

  return { inferred, rateLbsPerWeek: derivedRate, totalLbs, verb, weeks, bfFrom, bfTo };
}

// Adapter to keep older calls working (module-scope)
function inferGoalFromText(text: string | null): InferredGoal {
  return parseGoalDetails(text).inferred;
}

// --- Energy math ----------------------------------------------------------
function mifflinStJeor(sex: Sex, age: number, heightIn: number, weightLbs: number) {
  const kg = weightLbs * 0.453592, cm = heightIn * 2.54;
  const base = (10*kg) + (6.25*cm) - (5*age);
  return Math.round(sex === 'male' ? base + 5 : base - 161);
}
function activityMultiplier(label?: string | null) {
  const v = (label||'').toLowerCase();
  if (v.includes('very') && v.includes('active')) return 1.725;
  if (v.includes('active')) return 1.55;
  if (v.includes('light')) return 1.375;
  if (v.includes('sedentary') || v.includes('low')) return 1.2;
  return 1.4;
}

// kcal/day delta from lbs/week (≈ 3500 kcal per lb ≈ 500/day per lb/week)
function kcalDeltaFromRate(lbsPerWeek: number) {
  return Math.round(500 * lbsPerWeek);
}

// --- Macro math -----------------------------------------------------------
function defaultMacros(kcal: number, weightLbs: number, g: InferredGoal) {
  const protein_g = Math.round((g==='cut'||g==='recomp'?1.0:0.9) * weightLbs);
  const fat_g = Math.max(40, Math.round((kcal * 0.25) / 9)); // keep a fat floor
  const carbs_g = Math.max(0, Math.round((kcal - protein_g*4 - fat_g*9) / 4));
  return { protein_g, carbs_g, fat_g };
}

// --- Main local coach ------------------------------------------------------
export function localCoachSuggestion(params: {
  sex: Sex; age: number; heightIn: number; weightLbs: number; activity: string; goalText: string | null
}): Suggestion {
  const parsed = parseGoalDetails(params.goalText);
  const bmr  = mifflinStJeor(params.sex, params.age, params.heightIn, params.weightLbs);
  const tdee = Math.round(bmr * activityMultiplier(params.activity));

  // choose sign for rate: gain => +, loss => -
  const sign = parsed.inferred === 'bulk' ? +1 : parsed.inferred === 'cut' ? -1 : 0;

  // requested rate (lbs/wk), with safety caps
  // fat loss: cap 0.25–1.25 lb/wk (most users), bulking cap 0.25–0.75 lb/wk
  const capLoss = 1.25, capGain = 0.75;
  let rate = parsed.rateLbsPerWeek ?? (parsed.inferred === 'bulk' ? 0.35 : parsed.inferred === 'cut' ? 0.75 : 0.25);
  if (sign < 0) rate = Math.min(rate, capLoss);
  if (sign > 0) rate = Math.min(rate, capGain);
  if (sign === 0) rate = 0.25; // gentle recomposition / lean

  // translate rate -> kcal delta, then clamp by % of TDEE too (±20%)
  let kcal = tdee + sign * kcalDeltaFromRate(rate);
  const maxDeficit = Math.round(tdee * 0.20);
  const maxSurplus = Math.round(tdee * 0.20);
  if (sign < 0) kcal = Math.max(tdee - maxDeficit, kcal);
  if (sign > 0) kcal = Math.min(tdee + maxSurplus, kcal);

  const macros = defaultMacros(kcal, params.weightLbs, parsed.inferred);

  // dynamic “why” that echoes user text + method + safety
  const direction = parsed.inferred === 'bulk' ? 'gain' :
                    parsed.inferred === 'cut' ? 'lose' :
                    parsed.inferred === 'recomp' ? 'recomp (build while trimming)' : 'maintain';
  const method = `Method: ~${(sign!==0?rate:0.25)} lb/week ${direction}${
      parsed.weeks ? ` over ~${parsed.weeks} weeks` : ''
    } via ${sign<0?'deficit':'surplus'} ≈ ${Math.abs(kcal - tdee)} kcal/day; protein ${macros.protein_g}g; fats ~25% kcal; carbs fuel training.`;
  const safety = `Safety: capped rate to protect performance, recovery, and injury risk; adjust weekly by bodyweight trend and gym performance.`;
  const why = `You said: “${params.goalText || '—'}”. ${method} ${safety}`;

  return { kcal, ...macros, goal_label: parsed.inferred, why };
}




// ---------------------------------------------------------------------------

// --- Five-day meal plan (local fallback if API returns none) -------------
function pick<T>(arr: T[]) { return arr[Math.floor(Math.random()*arr.length)]; }

function buildFiveDayMealPlan(macros: MacroSet, goal: InferredGoal): MealPlanDay[] {
  const pPerMeal = Math.max(22, Math.round((macros.protein || 0) / 4));

  const breakfasts = [
    `3/4 cup (170 g) Greek yogurt + 1/2 cup berries + 1/3 cup dry oats (~${Math.round(pPerMeal*0.9)}g protein)`,
    `3 whole eggs + 2 egg whites scrambled, 1 slice whole-grain toast (~${Math.round(pPerMeal*1.0)}g protein)`,
    `Overnight oats: 1/2 cup oats + 1 scoop whey + 1 cup milk (~${Math.round(pPerMeal*1.1)}g protein)`,
    `1 cup (220 g) cottage cheese + 1/2 cup pineapple + 1/4 cup granola (~${Math.round(pPerMeal*0.9)}g protein)`,
  ];

  const lunches = [
    `6–7 oz cooked chicken breast + 1 cup cooked rice + 1 cup mixed veggies (~${Math.round(pPerMeal*1.1)}g protein)`,
    `6 oz turkey breast sandwich (2 slices bread) + 1 small apple + 5 oz yogurt (~${Math.round(pPerMeal*1.0)}g protein)`,
    `1.5 cups beef chili + 1 medium baked potato (~${Math.round(pPerMeal*1.0)}g protein)`,
    `1 can (5 oz) tuna + 3/4 cup cooked quinoa + 2 cups salad, 2 tbsp vinaigrette (~${Math.round(pPerMeal*1.1)}g protein)`,
  ];

  const snacks = [
    `1 scoop whey + 1 medium banana (~${Math.round(pPerMeal*0.7)}g protein)`,
    `3/4 cup (170 g) Greek yogurt + 1 oz almonds (~${Math.round(pPerMeal*0.8)}g protein)`,
    `Protein bar (read label) + 1 medium apple (~${Math.round(pPerMeal*0.7)}g protein)`,
    `1 cup (220 g) cottage cheese + 8 crackers (~${Math.round(pPerMeal*0.7)}g protein)`,
  ];

  const dinners = [
    `6 oz salmon + 1 cup roasted potatoes + 2 cups salad, 2 tbsp dressing (~${Math.round(pPerMeal*1.0)}g protein)`,
    `6 oz lean steak + 1 cup cooked rice + 1 cup green beans (~${Math.round(pPerMeal*1.1)}g protein)`,
    `6 oz chicken thighs + 3/4 cup couscous + 1 cup veggies (~${Math.round(pPerMeal*1.0)}g protein)`,
    `8 oz tofu stir-fry + 1 cup cooked rice (~${Math.round(pPerMeal*1.0)}g protein)`,
  ];

  const note =
    goal === 'cut'
      ? 'Coach: Keep veggies high-volume; hydrate before meals; trim starch slightly on full rest days.'
      : goal === 'bulk'
      ? 'Coach: Add 1 extra carb serving near training and consider a small pre-bed protein snack.'
      : goal === 'recomp'
      ? 'Coach: Keep protein steady; place more carbs near training; keep fats moderate.'
      : 'Coach: Keep intake steady; prioritize whole foods and consistency.';

  const days = ['Day 1','Day 2','Day 3','Day 4','Day 5'];
  return days.map((day, i) => ({
    day,
    meals: [
      { label: 'Breakfast', idea: breakfasts[(i+0) % breakfasts.length] },
      { label: 'Lunch',     idea: lunches[(i+1) % lunches.length]     },
      { label: 'Snack',     idea: snacks[(i+2) % snacks.length]       },
      { label: 'Dinner',    idea: dinners[(i+3) % dinners.length]     },
    ],
    notes: note,
  }));
}


function workoutStyleSuggestion(opts: { goalText: string | null; inferred: InferredGoal }) {
  const styles: Array<'classic'|'push-pull-legs'|'upper-lower'|'circuit'|'crossfit'> =
    ['classic','upper-lower','push-pull-legs','circuit','crossfit'];

  const explain: Record<string,string> = {
    classic: 'Organizes primary muscle groups to push hard and recover—great for steady hypertrophy.',
    'upper-lower': 'Higher frequency on big lifts with balanced recovery.',
    'push-pull-legs': 'Even volume across movement patterns; excellent for muscle gain.',
    circuit: 'Time-efficient stations that keep HR up while touching multiple patterns—great for recomposition/cuts.',
    crossfit: 'Mixed strength/conditioning/skill with varied stimuli for conditioning.',
  };

  let rec: string[] = [];
  if (opts.inferred === 'bulk') rec = ['push-pull-legs','upper-lower'];
  else if (opts.inferred === 'cut') rec = ['circuit','crossfit'];
  else if (opts.inferred === 'recomp') rec = ['upper-lower','circuit'];
  else rec = ['classic','upper-lower'];

  const header = opts.goalText
    ? `Target: “${opts.goalText}”. We chose styles that best match this goal.`
    : 'Recommended styles based on your goal and training balance.';

  return {
    header,
    bullets: rec.map(k =>
      `**${k === 'push-pull-legs' ? 'Push/Pull/Legs' : k === 'upper-lower' ? 'Upper/Lower' : k[0].toUpperCase()+k.slice(1)}** — ${explain[k]}`
    ),
  };
}

// ------------------------------------------------------------------------


// Optional secondary path: service calc (if you add it later)
let svcGetTargetsSuggestion: null | ((args: any) => Promise<any>) = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  svcGetTargetsSuggestion = require('../services/openaiService').getTargetsSuggestion;
} catch { /* ignore if not present */ }

type MacroSet = { calories: number; protein: number; carbs: number; fat: number };
type Profile = {
  sex?: 'male' | 'female';
  age?: number;
  height_in?: number;
  weight_lbs?: number;
  activity_level?: 'sedentary' | 'light' | 'moderate' | 'very';
};

type MealPlanDay = {
  day: string;
  meals: Array<{ label: string; idea: string; approx?: Partial<MacroSet> }>;
  notes?: string;
};

type WorkoutItem = { name: string; volume?: string; notes?: string };
type WorkoutPlanDay = { day: string; blocks: Array<{ title: string; items: WorkoutItem[] }>; notes?: string };

// --- Dynamic API shape (all authored by the model) ---
type ComboResponse = {
  targets: {
    calories: number; protein: number; carbs: number; fat: number;
    label: string;
    rationale: string;            // short “why”
    rationale_detailed: string;   // long “why” (echo user goal, method, safety)
  };
  mealPlan: Array<{
    day: string;
    meals: Array<{ label: string; idea: string; protein_estimate_g?: number }>;
    notes?: string;
  }>;
  workoutStyle: {                 // replaces workoutPlan
    header: string;               // dynamic summary explaining the choice
    bullets: string[];            // dynamic reasons/tips
  };
};

type CachedSuggestion = {
  label?: string;
  rationale?: string;
  rationale_detailed?: string;
  targets: MacroSet;
  suggestedAtISO: string;
  mealPlan?: MealPlanDay[];
  workoutPlan?: WorkoutPlanDay[];
};

const LS_KEY = 'aiCoachTargetsSuggestion';
const LS_PROFILE = 'aiCoachUserProfile';
function todayStr() { return localDateKey(); }

// Parse possible ```json fenced responses
function parseJsonFromText<T = any>(text: string): T | null {
  if (!text) return null as any;
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function TargetsView({
  initialProfile,
  initialLabel,
}: {
  initialProfile?: Profile;
  initialLabel?: string | null;
}) {
  const [userId, setUserId] = useState<string | null>(null);

  // Form fields
  const [profile, setProfile] = useState<Profile>(initialProfile || {});
  const [pretext, setPretext] = useState<string>('');

  // Suggestion state
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState<MacroSet | null>(null);
  const [label, setLabel] = useState<string>(initialLabel || '');
  const [rationale, setRationale] = useState<string>('');
  const [rationaleDetailed, setRationaleDetailed] = useState<string>(''); // ⭐ richer explanations
  const [suggestedAt, setSuggestedAt] = useState<Date | null>(null);

  // Plans
  const [mealPlan, setMealPlan] = useState<MealPlanDay[] | null>(null);
  const [workoutPlan, setWorkoutPlan] = useState<WorkoutPlanDay[] | null>(null);

  // Modal + accordions
  const [open, setOpen] = useState(false);
  const [openTargetsAcc, setOpenTargetsAcc] = useState(true);   // default OPEN
  const [openMealsAcc, setOpenMealsAcc] = useState(false);      // default CLOSED
  const [openWorkoutAcc, setOpenWorkoutAcc] = useState(false);  // default CLOSED

  // Cached suggestion availability
  const [hasCached, setHasCached] = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  const [styleCoach, setStyleCoach] = useState<{ header: string; bullets: string[] } | null>(null);


  // Require all inputs before enabling the button
  const isFormComplete = useMemo(() => {
    return Boolean(
      profile.sex &&
      profile.age &&
      profile.height_in &&
      profile.weight_lbs &&
      profile.activity_level &&
      pretext.trim()
    );
  }, [profile, pretext]);

  /* ------------------------------------------------------------------ */
  /* Load/save profile (per-user)                                      */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    (async () => {
      const id = await getCurrentUserId();
      setUserId(id);

      // 1) Load from Supabase user_profiles (if exists)
      if (id) {
        try {
          // Minimal expected schema:
          // create table user_profiles (
          //   user_id uuid primary key references auth.users(id) on delete cascade,
          //   sex text, age int, height_in int, weight_lbs int, activity_level text,
          //   goal_pretext text, updated_at timestamptz default now()
          // );
          const { data, error } = await supabase
            .from('user_profiles')
            .select('sex, age, height_in, weight_lbs, activity_level, goal_pretext')
            .eq('user_id', id)
            .maybeSingle();

          if (!error && data) {
            setProfile({
              sex: (data as any)?.sex || profile.sex,
              age: (data as any)?.age ?? profile.age,
              height_in: (data as any)?.height_in ?? profile.height_in,
              weight_lbs: (data as any)?.weight_lbs ?? profile.weight_lbs,
              activity_level: (data as any)?.activity_level || profile.activity_level,
            });
            setPretext((data as any)?.goal_pretext || pretext);
          }
        } catch {/* ignore */}
      }

      // 2) Fallback to localStorage
      try {
        const raw = localStorage.getItem(LS_PROFILE);
        if (raw) {
          const p = JSON.parse(raw);
          setProfile((prev) => ({ ...prev, ...p?.profile }));
          if (p?.pretext) setPretext(p.pretext);
        }
      } catch { /* ignore */ }

      // Load cached suggestion presence
      try {
        const rawS = localStorage.getItem(LS_KEY);
        if (rawS) {
          const parsed: CachedSuggestion = JSON.parse(rawS);
          if (parsed?.targets) setHasCached(true);
        }
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile() {
    // Save per-user to Supabase
    if (userId) {
      try {
        const { error } = await supabase
          .from('user_profiles')
          .upsert({
            user_id: userId,
            sex: profile.sex || null,
            age: profile.age ?? null,
            height_in: profile.height_in ?? null,
            weight_lbs: profile.weight_lbs ?? null,
            activity_level: profile.activity_level || null,
            goal_pretext: pretext || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        if (error) console.warn('saveProfile supabase error:', error.message);
      } catch (e) {
        console.warn('saveProfile supabase exception:', e);
      }
    }
    // Also store locally as a UX fallback
    try {
      localStorage.setItem(LS_PROFILE, JSON.stringify({ profile, pretext }));
    } catch { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* API: one call for targets + meal plan + workout plan               */
  /* ------------------------------------------------------------------ */
  // Require the model to write ALL text dynamically
async function fetchComboViaApi(p: Profile, t: string, seed?: MacroSet): Promise<ComboResponse> {
  const system = [
    'You are an evidence-based nutrition & training coach.',
    'Return STRICT JSON ONLY (no prose, no fences).',
    'Schema:',
    '{',
    '  "targets": {',
    '    "calories": number, "protein": number, "carbs": number, "fat": number,',
    '    "label": string,',
    '    "rationale": string,',
    '    "rationale_detailed": string',
    '  },',
    '  "mealPlan": [',
    '    { "day": string, "meals": [ { "label": string, "idea": string, "protein_estimate_g"?: number } ], "notes"?: string },',
    '    { "day": string, "meals": [ { "label": string, "idea": string, "protein_estimate_g"?: number } ], "notes"?: string },',
    '    { "day": string, "meals": [ { "label": string, "idea": string, "protein_estimate_g"?: number } ], "notes"?: string },',
    '    { "day": string, "meals": [ { "label": string, "idea": string, "protein_estimate_g"?: number } ], "notes"?: string },',
    '    { "day": string, "meals": [ { "label": string, "idea": string, "protein_estimate_g"?: number } ], "notes"?: string }',
    '  ],',
    '  "workoutStyle": { "header": string, "bullets": string[] }',
    '}',
    'Guidelines:',
    '- Echo the user’s goal text in the rationale_detailed and explain the method (deficit/surplus, protein logic, carb timing) and safety (progression, injury avoidance).',
    '- Meal plan must have 5 days; each meal lists a short idea and a protein estimate.',
    '- WorkoutStyle must recommend styles from ["classic","upper-lower","push-pull-legs","circuit","crossfit"] and explain why they fit this user’s goal and context.',
  ].join('\n');

  const payload = {
    sex: p.sex, age: p.age, height_in: p.height_in, weight_lbs: p.weight_lbs,
    activity_level: p.activity_level, goal_pretext: t, seed_targets: seed || null
  };

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      system,
      prompt: `Create "targets", "mealPlan", and "workoutStyle" for this user as strict JSON only:\n${JSON.stringify(payload)}`,
      model: 'gpt-4o-mini'
    })
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json(); // { text: string }
  const parsed = parseJsonFromText<ComboResponse>(data?.text || '');
  if (!parsed || !parsed.targets || !parsed.mealPlan || !parsed.workoutStyle) {
    throw new Error('Bad AI response');
  }
  return parsed;
}

  /* ------------------------------------------------------------------ */
  /* Cached helpers                                                     */
  /* ------------------------------------------------------------------ */
  function saveCache(payload: CachedSuggestion) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
      setHasCached(true);
    } catch { /* ignore */ }
  }

  function loadCacheAndOpen() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed: CachedSuggestion = JSON.parse(raw);
      if (!parsed?.targets) return;

      setSuggested({
        calories: Number(parsed.targets.calories || 0),
        protein:  Number(parsed.targets.protein  || 0),
        carbs:    Number(parsed.targets.carbs    || 0),
        fat:      Number(parsed.targets.fat      || 0),
      });
      setLabel((parsed.label || '').toString().toUpperCase());
      setRationale((parsed.rationale || '').toString());
      setRationaleDetailed((parsed.rationale_detailed || '').toString());
      setSuggestedAt(parsed.suggestedAtISO ? new Date(parsed.suggestedAtISO) : null);
      setMealPlan(parsed.mealPlan || null);
      setWorkoutPlan(parsed.workoutPlan || null);

      // Reset accordion defaults on open
      setOpenTargetsAcc(true);
      setOpenMealsAcc(false);
      setOpenWorkoutAcc(false);

      setOpen(true);
    } catch { /* ignore */ }
  }

  function clearCached() {
    try { localStorage.removeItem(LS_KEY); } catch {}
    setHasCached(false);
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                            */
  /* ------------------------------------------------------------------ */
 async function handleSuggest() {
   if (busy) return; 
  try {
    setBusy(true);

    // Inputs from form/profile
    const sex: 'male'|'female' =
      String(profile?.sex || 'male').toLowerCase().startsWith('f') ? 'female' : 'male';
    const age       = Number(profile?.age || 30);
    const heightIn  = Number((profile as any)?.height_in ?? (profile as any)?.heightIn ?? 70);
    const weightLbs = Number((profile as any)?.weight_lbs ?? (profile as any)?.weightLbs ?? 180);
    const activity  = String((profile as any)?.activity_level ?? (profile as any)?.activity ?? 'Active');
    const goalText  = (String(pretext || '').trim() || null);

    // Local suggestion (always available)
    const local = localCoachSuggestion({ sex, age, heightIn, weightLbs, activity, goalText });

    // Seed for API
    const seed: MacroSet & { label: string } = {
      calories: local.kcal,
      protein:  local.protein_g,
      carbs:    local.carbs_g,
      fat:      local.fat_g,
      label:    local.goal_label,
    };

    // Try API
    let combo: ComboResponse | null = null;
    try {
      combo = await fetchComboViaApi(profile, goalText ?? '', seed);
    } catch (e) {
      console.warn('AI combo fetch failed; using local targets only:', e);
      combo = null;
    }

    // ---- Normalize results (declare once, assign conditionally) ----
    let next: MacroSet;
    let nextLabel: string;
    let whyShort: string;
    let whyLong: string;
    let plan: MealPlanDay[] | null;
    let style: { header: string; bullets: string[] } | null;

    const inferred: InferredGoal = parseGoalDetails(goalText).inferred;

    if (combo) {
      // Use fully dynamic API text
      next = {
        calories: Math.round(Number(combo.targets.calories)),
        protein:  Math.round(Number(combo.targets.protein)),
        carbs:    Math.round(Number(combo.targets.carbs)),
        fat:      Math.round(Number(combo.targets.fat)),
      };
      nextLabel = String(combo.targets.label || '').toUpperCase();
      whyShort  = String(combo.targets.rationale || '').trim();
      whyLong   = String(combo.targets.rationale_detailed || '').trim();
      plan      = Array.isArray(combo.mealPlan) ? combo.mealPlan : null;
      style     = combo.workoutStyle ?? null;
    } else {
      // Local fallback (still dynamic from user inputs)
      
      next = {
        calories: Math.round(local.kcal),
        protein:  Math.round(local.protein_g),
        carbs:    Math.round(local.carbs_g),
        fat:      Math.round(local.fat_g),
      };
      nextLabel = String(local.goal_label || 'lean').toUpperCase();
      const method =
        `Method: calories set ${inferred==='cut'?'~20% below':inferred==='recomp'?'~10% below':inferred==='bulk'?'~10% above':'at'} TDEE; ` +
        `protein ${next.protein}g; fats ~25% of calories; carbs fill training energy.`;
      const safety = 'Safety: progress gradually; adjust weekly by bodyweight trend and performance.';
      const baseWhy = /you said:/i.test(local.why)
        ? local.why
        : `You said: “${goalText || '—'}”. ${local.why}`;
      whyLong  = `${baseWhy}\n${method}\n${safety}`.trim();
      whyShort = baseWhy;
      plan     = buildFiveDayMealPlan(next, inferred);
      style    = workoutStyleSuggestion({ goalText, inferred });
    }

    // ---- Set state (uses your existing setters) ----
    setSuggested(next);
    setLabel(nextLabel);
    setRationale(whyShort);
    setRationaleDetailed(whyLong);
    setMealPlan(plan);
    setWorkoutPlan(null);     // we show a style recommendation instead of a plan
    setStyleCoach(style);
    setSuggestedAt(new Date());

    // Cache for “View last suggestion”
    saveCache({
      label: nextLabel,
      rationale: whyShort,
      rationale_detailed: whyLong,
      targets: next,
      suggestedAtISO: new Date().toISOString(),
      mealPlan: plan || undefined,
      // workoutPlan intentionally omitted (style rec instead)
    });

    // Open modal w/ default accordion states
    setOpenTargetsAcc(true);
    setOpenMealsAcc(false);
    setOpenWorkoutAcc(false);
    setOpen(true);
  } catch (e: any) {
    alert(e?.message || 'Could not build a suggestion.');
  } finally {
    setBusy(false);
  }
}




  async function useTarget() {
    if (!suggested) return;
    const payload = {
      ...suggested,
      label: (label || '').toUpperCase(),
      rationale: (rationaleDetailed || rationale || undefined),
    };

    try {
      // Save today’s targets into days.targets
      if (userId) {
        const { data: existing } = await supabase
          .from('days')
          .select('id')
          .eq('user_id', userId)
          .eq('date', todayStr());

        if (existing && existing.length > 0) {
          const { error } = await supabase
            .from('days')
            .update({ targets: payload, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('date', todayStr());
          if (error) throw error;
        } else {
          const { error } = await supabase.from('days').insert({
            user_id: userId,
            date: todayStr(),
            targets: payload,
          });
          if (error) throw error;
        }
      }

      // Broadcast to TodayView
      try { await recalcAndPersistDay(userId!, localDateKey()); eventBus.emit('day:totals'); } catch {}
      eventBus.emit('targets:update', payload);
      try { eventBus.emit('targets:applied', payload); } catch {}

      // Persist profile again to be safe
      await saveProfile();

      // Toast success (and keep modal open or close—your call; we’ll close)
      setToast('Your targets have been applied.');
      setTimeout(() => setToast(null), 3500);
      setOpen(false);
    } catch (e: any) {
      alert(e?.message || 'Could not save targets.');
    }
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                 */
  /* ------------------------------------------------------------------ */
  return (
    <div className="min-h-[100svh] w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">Targets</h1>

        {/* Toast */}
        {toast && (
          <div className="fixed left-1/2 top-4 -translate-x-1/2 z-50">
            <div className="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2 shadow-lg">
              {toast}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 bg-white dark:bg-neutral-900 space-y-3 mb-4">
          {/* Profile inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm">Sex</label>
              <select
                className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
                value={profile.sex || ''}
                onChange={(e) => setProfile((p) => ({ ...p, sex: e.target.value as any }))}
              >
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>

            <div>
              <label className="text-sm">Age</label>
              <input
                type="number"
                min={0}
                className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
                value={profile.age ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, age: Number(e.target.value || 0) }))}
              />
            </div>

            <div>
              <label className="text-sm">Height (in)</label>
              <input
                type="number"
                min={0}
                className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
                value={profile.height_in ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, height_in: Number(e.target.value || 0) }))}
              />
            </div>

            <div>
              <label className="text-sm">Weight (lbs)</label>
              <input
                type="number"
                min={0}
                className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
                value={profile.weight_lbs ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, weight_lbs: Number(e.target.value || 0) }))}
              />
            </div>

            <div className="col-span-2">
              <label className="text-sm">Activity level</label>
              <select
                className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
                value={profile.activity_level || ''}
                onChange={(e) => setProfile((p) => ({ ...p, activity_level: e.target.value as any }))}
              >
                <option value="">—</option>
                <option value="sedentary">Sedentary</option>
                <option value="light">Light</option>
                <option value="moderate">Moderate</option>
                <option value="very">Very Active</option>
              </select>
            </div>
          </div>

          {/* Goal / pretext */}
          <div>
            <label className="text-sm">Tell us your goal (free text)</label>
            <textarea
              rows={3}
              className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
              placeholder="e.g., Lean out while maintaining strength; ~1 lb/week loss; evening workouts; lactose sensitive."
              value={pretext}
              onChange={(e) => setPretext(e.target.value)}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleSuggest}
              disabled={!isFormComplete || busy}
              className="relative rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black disabled:opacity-60"
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <div>Suggested Target</div>
              <div className="text-[10px] text-neutral-300 dark:text-neutral-600">by AI coach</div>
            </button>

            <button
              onClick={loadCacheAndOpen}
              disabled={!hasCached}
              className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800 disabled:opacity-60"
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              AI Coach: View last suggestion
            </button>

            <button
              onClick={clearCached}
              disabled={!hasCached}
              className="rounded-xl px-3 py-2 text-xs border border-neutral-200 dark:border-neutral-800 disabled:opacity-60"
              title="Remove locally cached suggestion"
            >
              Clear cached
            </button>

            {label ? (
              <span className="ml-auto text-xs px-2 py-1 rounded-lg bg-purple-600 text-white">
                {label}
              </span>
            ) : null}
          </div>

          {/* No macros on the page; only in the modal */}
        </div>

        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Tip: include preferences (e.g., high-protein, low-dairy), schedule, and constraints for better suggestions.
        </p>

        {suggestedAt && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
            Last suggested: {suggestedAt.toLocaleString()}
          </div>
        )}
      </div>

      {/* Modal: accordions for Targets + Meal Plan + Workout Plan */}
      <Modal isOpen={open} onClose={() => setOpen(false)} title="AI Coach Suggestions">
        {/* Scrollable body */}
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          <div className="space-y-3">
            <Accordion
              title="Suggested Targets"
              subtitle="AI Coach Recommendation"
              open={openTargetsAcc}
              onToggle={() => setOpenTargetsAcc((v) => !v)}
            >
              {/* Detailed rationale */}
              {(rationaleDetailed || rationale) ? (
                <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 text-sm mb-3">
                  <div className="font-medium mb-1">Why this target</div>
                  <div className="whitespace-pre-wrap">
                    {rationaleDetailed || rationale}
                  </div>
                </div>
              ) : null}

              {suggested ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Metric title="Calories" value={suggested.calories} unit="kcal" />
                  <Metric title="Protein"  value={suggested.protein}  unit="g" />
                  <Metric title="Carbs"    value={suggested.carbs}    unit="g" />
                  <Metric title="Fat"      value={suggested.fat}      unit="g" />
                </div>
              ) : (
                <div className="text-sm">No target yet.</div>
              )}
            </Accordion>

            <Accordion
              title="AI Coach Meal Plan"
              subtitle="Sample ideas for a few days"
              open={openMealsAcc}
              onToggle={() => setOpenMealsAcc((v) => !v)}
            >
              {mealPlan && mealPlan.length > 0 ? (
                <div className="space-y-3">
                  {mealPlan.map((d) => (
                    <div key={d.day} className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
                      <div className="text-sm font-semibold mb-1">{d.day}</div>
                      <ul className="space-y-1 text-sm">
                        {d.meals.map((m, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="min-w-[84px] text-neutral-500 dark:text-neutral-400">{m.label}:</span>
                            <span className="flex-1">{m.idea}</span>
                          </li>
                        ))}
                      </ul>
                      {d.notes ? (
                        <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{d.notes}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm">No meal plan yet.</div>
              )}
            </Accordion>

            <Accordion
              title="AI Coach Workout Style"
              subtitle="Why these styles match your goal"
              open={openWorkoutAcc}
              onToggle={() => setOpenWorkoutAcc((v) => !v)}
            >
              {styleCoach ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">{styleCoach.header}</div>
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {styleCoach.bullets.map((b, i) => (<li key={i} dangerouslySetInnerHTML={{__html: b}}/>))}
                  </ul>
                </div>
              ) : workoutPlan && workoutPlan.length > 0 ? (
                <div className="space-y-3">
                  {workoutPlan.map((d) => (
                    <div key={d.day} className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
                      <div className="text-sm font-semibold mb-1">{d.day}</div>
                      <div className="space-y-2">
                        {d.blocks.map((b, bi) => (
                          <div key={bi}>
                            <div className="text-sm font-medium">{b.title}</div>
                            <ul className="mt-1 text-sm space-y-1">
                              {b.items.map((it, ii) => (
                                <li key={ii} className="flex items-start gap-2">
                                  <span className="flex-1">
                                    {it.name}{it.volume ? ` — ${it.volume}` : ''}
                                  </span>
                                  {it.notes ? <span className="text-xs text-neutral-500 dark:text-neutral-400">{it.notes}</span> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      {d.notes ? (
                        <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{d.notes}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm">No workout plan yet.</div>
              )}
            </Accordion>

            <div className="flex gap-2 pt-2 sticky bottom-0 bg-white/80 dark:bg-neutral-950/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-neutral-950/60 py-2">
              <button
                onClick={useTarget}
                className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black"
              >
                AI Coach: Use this target
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- UI bits ---------- */

function Metric({ title, value, unit }: { title: string; value: number; unit: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-sm text-neutral-600 dark:text-neutral-300">{title}</div>
      <div className="text-2xl font-bold">
        {Math.round(value)} <span className="text-base font-semibold">{unit}</span>
      </div>
    </div>
  );
}

function Accordion({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle && <div className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</div>}
        </div>
        <span className="text-xl leading-none select-none">{open ? '–' : '+'}</span>
      </button>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </div>
  );
}