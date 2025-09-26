// components/TargetsView.tsx
import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from '../auth';
import { eventBus } from '../lib/eventBus';

// ✅ Use your previously working local util first (no API dependency)
import { suggestTargets, type SuggestTargetsResult } from '../utils/suggestTargets';
import { localDateKey } from '../lib/dateLocal';

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

type ComboResponse = {
  targets: { calories: number; protein: number; carbs: number; fat: number; label?: string; rationale?: string; rationale_detailed?: string };
  mealPlan?: MealPlanDay[];
  workoutPlan?: WorkoutPlanDay[];
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
  async function fetchComboViaApi(p: Profile, t: string, seed?: MacroSet): Promise<ComboResponse> {
    const system = [
      'You are an evidence-based nutrition & training coach.',
      'Return STRICT JSON ONLY (no prose, no fences).',
      'Schema:',
      '{',
      '  "targets": { "calories": number, "protein": number, "carbs": number, "fat": number,',
      '               "label": string, "rationale": string, "rationale_detailed": string },',
      '  "mealPlan": [',
      '    { "day": string, "meals": [ { "label": string, "idea": string } ], "notes"?: string },',
      '    { "day": string, "meals": [ { "label": string, "idea": string } ], "notes"?: string },',
      '    { "day": string, "meals": [ { "label": string, "idea": string } ], "notes"?: string }',
      '  ],',
      '  "workoutPlan": [',
      '    { "day": string, "blocks": [',
      '        { "title": string, "items": [ { "name": string, "volume"?: string, "notes"?: string } ] }',
      '      ], "notes"?: string',
      '    }',
      '  ]',
      '}',
      'Explain the target choice in practical, personalized terms.',
      'Workouts should match the user’s experience implied by the inputs and their goal; keep them safe and scalable.',
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
        prompt: `Create daily targets + a 3-day meal plan + a 3-day workout plan for this user as strict JSON only:\n${JSON.stringify(payload)}`,
        model: 'gpt-4o-mini'
      })
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json(); // { text: string }
    const parsed = parseJsonFromText<ComboResponse>(data?.text || '');
    if (!parsed || !parsed.targets) throw new Error('Bad AI response');
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
    if (!isFormComplete) return;
    setBusy(true);
    try {
      // Save the profile now so it persists even if they don't accept yet
      await saveProfile();

      // 1) Local util first
      const s: SuggestTargetsResult = await suggestTargets({
        sex: profile.sex || undefined,
        age: profile.age || undefined,
        heightIn: profile.height_in || undefined,
        weightLbs: profile.weight_lbs || undefined,
        activity: profile.activity_level || undefined,
        goal: undefined,
        goalText: pretext?.trim() || undefined,
      });

      const base =
        s?.calories
          ? s
          : svcGetTargetsSuggestion
          ? await svcGetTargetsSuggestion({ profile, pretext })
          : null;

      const seedTargets: MacroSet | undefined = base?.calories
        ? {
            calories: Math.round(Number(base.calories || 0)),
            protein:  Math.round(Number(base.protein  || 0)),
            carbs:    Math.round(Number(base.carbs    || 0)),
            fat:      Math.round(Number(base.fat      || 0)),
          }
        : undefined;

      // 2) Fetch combined targets + meal plan + workout
      const combo = await fetchComboViaApi(profile, pretext, seedTargets);

      const next: MacroSet = {
        calories: Math.round(Number(combo.targets.calories || 0)),
        protein:  Math.round(Number(combo.targets.protein  || 0)),
        carbs:    Math.round(Number(combo.targets.carbs    || 0)),
        fat:      Math.round(Number(combo.targets.fat      || 0)),
      };
      const nextLabel = (combo.targets.label || 'LEAN').toString().toUpperCase();
      const nextRationale = (combo.targets.rationale || '').toString().trim();
      const nextRationaleDetailed = (combo.targets.rationale_detailed || nextRationale || 'AI Coach could not generate an explanation.').toString().trim();
      const plan: MealPlanDay[] | null = Array.isArray(combo.mealPlan) ? combo.mealPlan : null;
      const wplan: WorkoutPlanDay[] | null = Array.isArray(combo.workoutPlan) ? combo.workoutPlan : null;

      const when = new Date();
      setSuggested(next);
      setLabel(nextLabel);
      setRationale(nextRationale);
      setRationaleDetailed(nextRationaleDetailed);
      setSuggestedAt(when);
      setMealPlan(plan);
      setWorkoutPlan(wplan);

      // Cache both
      saveCache({
        label: nextLabel,
        rationale: nextRationale,
        rationale_detailed: nextRationaleDetailed,
        targets: next,
        suggestedAtISO: when.toISOString(),
        mealPlan: plan || undefined,
        workoutPlan: wplan || undefined,
      });

      // Reset accordion defaults when opening after fresh suggestion
      setOpenTargetsAcc(true);
      setOpenMealsAcc(false);
      setOpenWorkoutAcc(false);

      setOpen(true);
    } catch (e: any) {
      alert(e?.message || 'Could not get AI Coach suggestion + plans.');
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
      eventBus.emit('targets:update', payload);

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
    <div className="min-h-screen w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
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
              title="AI Coach Workout Plan"
              subtitle="3-day sample to match your goal"
              open={openWorkoutAcc}
              onToggle={() => setOpenWorkoutAcc((v) => !v)}
            >
              {workoutPlan && workoutPlan.length > 0 ? (
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