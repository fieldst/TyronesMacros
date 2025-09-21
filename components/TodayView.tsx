// components/TodayView.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from '../auth';
import {
  estimateMacrosForMeal,
  getMealCoaching,
  getSwapSuggestion,
  getWorkoutCalories,
} from '../services/openaiService';
import { eventBus } from '../lib/eventBus';

export type MacroSet = { calories: number; protein: number; carbs: number; fat: number };
export type Profile = {
  sex?: 'male' | 'female';
  age?: number;
  height_in?: number;
  weight_lbs?: number;
  activity_level?: 'sedentary' | 'light' | 'moderate' | 'very';
};

type MealRow = {
  id: string;
  meal_summary: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function todayStr() { return new Date().toISOString().slice(0, 10); }

// 🔒 Local storage key for immediate hydration
const LS_TARGETS_KEY = 'aiCoach.currentTargets';

export default function TodayView({
  profile,
  targets,
  onTotalsChange,
}: {
  profile: Profile;
  targets: MacroSet; // "Current Goal Targets" from parent (updated via App/event bus)
  onTotalsChange?: (totals: MacroSet) => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [mealText, setMealText] = useState('');
  const [workoutText, setWorkoutText] = useState('');
  const [meals, setMeals] = useState<MealRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [workoutKcal, setWorkoutKcal] = useState<number>(0);
  const [swap, setSwap] = useState<string>('');
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachText, setCoachText] = useState('');

  // ---- Toast (non-intrusive) ----
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  // ---- Quick Edit Targets modal state ----
  const [quickOpen, setQuickOpen] = useState(false);
  const [qCalories, setQCalories] = useState<number>(targets?.calories ?? 0);
  const [qProtein,  setQProtein]  = useState<number>(targets?.protein  ?? 0);
  const [qCarbs,    setQCarbs]    = useState<number>(targets?.carbs    ?? 0);
  const [qFat,      setQFat]      = useState<number>(targets?.fat      ?? 0);
  const [qLabel,    setQLabel]    = useState<string>(String((targets as any)?.label || ''));
  const [qWhy,      setQWhy]      = useState<string>(String((targets as any)?.rationale || ''));

  // Local target override (updated when Targets tab saves or quick edit saves)
  const [currentGoal, setCurrentGoal] = useState<MacroSet>(targets || { calories: 0, protein: 0, carbs: 0, fat: 0 });

  // brief tag for banner chip (CUT / BULK / LEAN / RECOMP / MAINTAIN)
  const [goalLabel, setGoalLabel] = useState<string | null>(() => (targets as any)?.label ?? null);
  // Keep the AI Coach rationale as well
  const [goalRationale, setGoalRationale] = useState<string | null>(String((targets as any)?.rationale || '') || null);

  // Router style (for the link shown inside Quick Edit)
  const [usesHash, setUsesHash] = useState<boolean>(true);
  useEffect(() => {
    try {
      setUsesHash(typeof window !== 'undefined' && window.location.hash?.startsWith('#/'));
    } catch {
      setUsesHash(true);
    }
  }, []);

  // Live preview (debounced) while typing
  const [previewMeal, setPreviewMeal] = useState<MacroSet | null>(null);
  const [previewWorkoutKcal, setPreviewWorkoutKcal] = useState<number>(0);
  const mealTimer = useRef<number | null>(null);
  const woTimer = useRef<number | null>(null);

  // --- Helpers to persist/load targets locally ---
  function persistTargetsLocally(payload: any) {
    try { localStorage.setItem(LS_TARGETS_KEY, JSON.stringify(payload)); } catch {}
  }
  function loadTargetsFromLocal(): any | null {
    try {
      const raw = localStorage.getItem(LS_TARGETS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // Load user + today's data (and hydrate targets in this priority order)
  // 1) days.targets (for today) -> authoritative for Daily Allowance
  // 2) user_targets (persistent user preference)
  // 3) localStorage (fast fallback to avoid flicker between screens)
  useEffect(() => {
    (async () => {
      const id = await getCurrentUserId();
      setUserId(id);

      // Fast local fallback to avoid UI flicker on navigation
      const ls = loadTargetsFromLocal();
      if (ls?.calories) {
        setCurrentGoal({ calories: ls.calories || 0, protein: ls.protein || 0, carbs: ls.carbs || 0, fat: ls.fat || 0 });
        if (ls.label) setGoalLabel(String(ls.label));
        if (ls.rationale) { setGoalRationale(String(ls.rationale)); setQWhy(String(ls.rationale)); }
        setQCalories(ls.calories || 0); setQProtein(ls.protein || 0); setQCarbs(ls.carbs || 0); setQFat(ls.fat || 0);
        setQLabel(String(ls.label || ''));
      }

      if (id) {
        // Meals for today
        const { data: mealsData } = await supabase
          .from('meals')
          .select('id, meal_summary, calories, protein, carbs, fat')
          .eq('user_id', id)
          .eq('date', todayStr())
          .order('created_at', { ascending: false });
        setMeals((mealsData as any) || []);

        // Day row (today): workout & targets
        const { data: day } = await supabase
          .from('days')
          .select('workout_logged, workout_kcal, targets')
          .eq('user_id', id)
          .eq('date', todayStr())
          .maybeSingle();

        if (day?.workout_kcal != null) setWorkoutKcal(day.workout_kcal as number);

        // If day.targets present, hydrate from there (highest priority)
        const dayTargets = (day as any)?.targets;
        if (dayTargets && typeof dayTargets === 'object') {
          const macros = {
            calories: Number(dayTargets.calories || 0),
            protein:  Number(dayTargets.protein  || 0),
            carbs:    Number(dayTargets.carbs    || 0),
            fat:      Number(dayTargets.fat      || 0),
          };
          setCurrentGoal(macros);
          if (dayTargets.label) setGoalLabel(String(dayTargets.label));
          const why = String(dayTargets.rationale || '') || '';
          setGoalRationale(why || null);

          // Sync quick edit fields
          setQCalories(macros.calories); setQProtein(macros.protein);
          setQCarbs(macros.carbs); setQFat(macros.fat);
          setQLabel(String(dayTargets.label || ''));
          setQWhy(why);

          // Persist locally for fast next-load
          persistTargetsLocally({ ...macros, label: dayTargets.label || null, rationale: why || null });
        } else {
          // Fall back to user_targets (per-user saved baseline)
          const { data: ut, error: utErr } = await supabase
            .from('user_targets')
            .select('calories, protein, carbs, fat, label, rationale')
            .eq('user_id', id)
            .maybeSingle();

          if (!utErr && ut) {
            const macros = {
              calories: Number(ut.calories || 0),
              protein:  Number(ut.protein  || 0),
              carbs:    Number(ut.carbs    || 0),
              fat:      Number(ut.fat      || 0),
            };
            setCurrentGoal(macros);
            if (ut.label) setGoalLabel(String(ut.label));
            const why = String(ut.rationale || '') || '';
            setGoalRationale(why || null);

            // Sync quick edit fields
            setQCalories(macros.calories); setQProtein(macros.protein);
            setQCarbs(macros.carbs); setQFat(macros.fat);
            setQLabel(String(ut.label || ''));
            setQWhy(why);

            // Also mirror into today's day row so allowance math is always aligned today
            await supabase.from('days').upsert({
              user_id: id,
              date: todayStr(),
              targets: { ...macros, ...(ut.label ? { label: ut.label } : {}), ...(why ? { rationale: why } : {}) },
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id, date' });

            // Persist locally
            persistTargetsLocally({ ...macros, label: ut.label || null, rationale: why || null });
          }
        }
      }

      setLoading(false);
    })();

    // Listen for Target saves from Targets page OR quick edit (includes label/rationale)
    const off = eventBus.on<any>('targets:update', async (payload) => {
      const macros = {
        calories: payload.calories ?? 0,
        protein:  payload.protein  ?? 0,
        carbs:    payload.carbs    ?? 0,
        fat:      payload.fat      ?? 0,
      };
      setCurrentGoal(macros);
      if (payload.label) setGoalLabel(String(payload.label).toUpperCase());
      if (typeof payload.rationale === 'string') setGoalRationale(payload.rationale.trim() || null);

      // keep quick edit form in sync
      setQCalories(macros.calories);
      setQProtein(macros.protein);
      setQCarbs(macros.carbs);
      setQFat(macros.fat);
      setQLabel(String(payload.label || ''));
      setQWhy(String(payload.rationale || ''));

      // Persist to today's day row (so allowance remains when switching screens)
      try {
        if (!userId) return;
        const targetsJSON = {
          ...macros,
          ...(payload.label ? { label: String(payload.label).toUpperCase() } : {}),
          ...(payload.rationale ? { rationale: String(payload.rationale) } : {}),
        };

        const { data: existing } = await supabase
          .from('days')
          .select('id')
          .eq('user_id', userId)
          .eq('date', todayStr());

        if (existing && existing.length > 0) {
          await supabase
            .from('days')
            .update({ targets: targetsJSON, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('date', todayStr());
        } else {
          await supabase
            .from('days')
            .insert({
              user_id: userId,
              date: todayStr(),
              targets: targetsJSON,
            });
        }

        // 👍 Also stash locally for instant hydration on navigation
        persistTargetsLocally(targetsJSON);
      } catch (err) {
        console.error('Failed to persist targets to days:', err);
      }
    });

    return () => { off(); };
  }, []);

  // Keep local currentGoal / label / rationale in sync if parent changes
  useEffect(() => {
    setCurrentGoal(targets || { calories: 0, protein: 0, carbs: 0, fat: 0 });
    const lbl = (targets as any)?.label;
    if (lbl) setGoalLabel(String(lbl).toUpperCase());

    const why = String((targets as any)?.rationale || '') || '';
    setGoalRationale(why || null);

    // sync quick form when parent changes
    setQCalories(targets?.calories ?? 0);
    setQProtein(targets?.protein ?? 0);
    setQCarbs(targets?.carbs ?? 0);
    setQFat(targets?.fat ?? 0);
    setQLabel(String((targets as any)?.label || ''));
    setQWhy(why);

    // Mirror to local storage too
    persistTargetsLocally({
      calories: targets?.calories ?? 0,
      protein: targets?.protein ?? 0,
      carbs: targets?.carbs ?? 0,
      fat: targets?.fat ?? 0,
      label: (targets as any)?.label || null,
      rationale: why || null,
    });
  }, [targets]);

  // Totals from meals (consumed)
  const totalsFromMeals: MacroSet = useMemo(
    () =>
      meals.reduce(
        (acc, m) => ({
          calories: acc.calories + (m.calories || 0),
          protein:  acc.protein  + (m.protein  || 0),
          carbs:    acc.carbs    + (m.carbs    || 0),
          fat:      acc.fat      + (m.fat      || 0),
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      ),
    [meals]
  );

  // Live preview: add the estimated meal being typed
  const totalsWithPreview: MacroSet = useMemo(() => {
    if (!previewMeal) return totalsFromMeals;
    return {
      calories: totalsFromMeals.calories + (previewMeal.calories || 0),
      protein:  totalsFromMeals.protein  + (previewMeal.protein  || 0),
      carbs:    totalsFromMeals.carbs    + (previewMeal.carbs    || 0),
      fat:      totalsFromMeals.fat      + (previewMeal.fat      || 0),
    }
  }, [totalsFromMeals, previewMeal]);

  // Report consumed totals (without preview) upward if needed
  useEffect(() => {
    onTotalsChange?.(totalsFromMeals);
  }, [totalsFromMeals, onTotalsChange]);

  // Allowance / remaining math
  const baseTarget = currentGoal?.calories || 0;
  const exerciseAdded = (workoutKcal || 0) + (previewWorkoutKcal || 0);
  const dailyAllowance = baseTarget + exerciseAdded;
  const remainingCalories = dailyAllowance - totalsWithPreview.calories; // can go negative

  const remainingProtein = Math.max(0, (currentGoal?.protein || 0) - totalsWithPreview.protein);
  const remainingCarbs   = Math.max(0, (currentGoal?.carbs   || 0) - totalsWithPreview.carbs);
  const remainingFat     = Math.max(0, (currentGoal?.fat     || 0) - totalsWithPreview.fat);

  // Debounced live preview while typing meal/workout
  useEffect(() => {
    if (mealTimer.current) window.clearTimeout(mealTimer.current);
    if (!mealText.trim()) { setPreviewMeal(null); return; }
    mealTimer.current = window.setTimeout(async () => {
      try {
        const res = await estimateMacrosForMeal(mealText.trim(), profile);
        setPreviewMeal({
          calories: Math.round(res.macros.calories || 0),
          protein:  Math.round(res.macros.protein  || 0),
          carbs:    Math.round(res.macros.carbs    || 0),
          fat:      Math.round(res.macros.fat      || 0),
        });
      } catch {
        setPreviewMeal(null);
      }
    }, 800);
    return () => { if (mealTimer.current) window.clearTimeout(mealTimer.current); };
  }, [mealText, profile]);

  useEffect(() => {
    if (woTimer.current) window.clearTimeout(woTimer.current);
    if (!workoutText.trim()) { setPreviewWorkoutKcal(0); return; }
    woTimer.current = window.setTimeout(async () => {
      try {
        const res = await getWorkoutCalories(workoutText.trim(), profile);
        setPreviewWorkoutKcal(Math.round(res.total_calories || 0));
      } catch {
        setPreviewWorkoutKcal(0);
      }
    }, 800);
    return () => { if (woTimer.current) window.clearTimeout(woTimer.current); };
  }, [workoutText, profile]);

  // Actions
  async function addMealFromEstimate() {
    if (!mealText.trim()) return;
    setBusy(true);
    try {
      const res = await estimateMacrosForMeal(mealText.trim(), profile);

      if (userId) {
        const { data, error } = await supabase
          .from('meals')
          .insert({
            user_id: userId,
            date: todayStr(),
            meal_type: 'other',
            meal_summary: mealText.trim(),
            calories: Math.round(res.macros.calories || 0),
            protein: Math.round(res.macros.protein || 0),
            carbs: Math.round(res.macros.carbs || 0),
            fat: Math.round(res.macros.fat || 0),
          })
          .select('id, meal_summary, calories, protein, carbs, fat')
          .single();
        if (error) throw error;
        setMeals((list) => [data as any, ...list]);
      } else {
        const local: MealRow = {
          id: String(Date.now()),
          meal_summary: mealText.trim(),
          calories: Math.round(res.macros.calories || 0),
          protein: Math.round(res.macros.protein || 0),
          carbs: Math.round(res.macros.carbs || 0),
          fat: Math.round(res.macros.fat || 0),
        };
        setMeals((list) => [local, ...list]);
      }

      setMealText('');
      setPreviewMeal(null);
    } catch (e: any) {
      openCoaching(e?.message || 'Could not estimate meal macros.');
    } finally {
      setBusy(false);
    }
  }

  async function addWorkout() {
    if (!workoutText.trim()) return;
    setBusy(true);
    try {
      const res = await getWorkoutCalories(workoutText.trim(), profile);
      const kcal = Math.round(res.total_calories || 0);
      setWorkoutKcal(kcal);
      setPreviewWorkoutKcal(0);

      if (userId) {
        const { data: existing } = await supabase
          .from('days')
          .select('id')
          .eq('user_id', userId)
          .eq('date', todayStr());

        const targetsJSON = {
          ...(currentGoal || { calories: 0, protein: 0, carbs: 0, fat: 0 }),
          ...(goalLabel ? { label: goalLabel } : {}),
          ...(goalRationale ? { rationale: goalRationale } : {}),
        };

        if (existing && existing.length > 0) {
          const { error } = await supabase
            .from('days')
            .update({
              workout_logged: workoutText.trim(),
              workout_kcal: kcal,
              updated_at: new Date().toISOString(),
              targets: targetsJSON,
            })
            .eq('user_id', userId)
            .eq('date', todayStr());
          if (error) throw error;
        } else {
          const { error } = await supabase.from('days').insert({
            user_id: userId,
            date: todayStr(),
            workout_logged: workoutText.trim(),
            workout_kcal: kcal,
            targets: targetsJSON,
          });
          if (error) throw error;
        }

        // Also mirror locally so allowance sticks between screens
        persistTargetsLocally(targetsJSON);
      }

      setWorkoutText('');
    } catch (e: any) {
      openCoaching(e?.message || 'Could not estimate workout burn.');
    } finally {
      setBusy(false);
    }
  }

  async function coachMealRow(m: MealRow) {
    try {
      const remainingBefore: MacroSet = {
        calories: Math.max(0, (currentGoal?.calories || 0) - (totalsFromMeals.calories - (m.calories || 0))),
        protein:  Math.max(0, (currentGoal?.protein  || 0) - (totalsFromMeals.protein  - (m.protein  || 0))),
        carbs:    Math.max(0, (currentGoal?.carbs    || 0) - (totalsFromMeals.carbs    - (m.carbs    || 0))),
        fat:      Math.max(0, (currentGoal?.fat      || 0) - (totalsFromMeals.fat      - (m.fat      || 0))),
      };
      const coaching = await getMealCoaching(m.meal_summary, profile, remainingBefore, currentGoal);

      const suggestionLines = (coaching?.suggestions || [])
        .filter((s: any) => typeof s === 'string' && s.trim())
        .map((s: string) => s.trim());

      const altLines = (coaching?.better_alternatives || [])
        .map((a: any) => (a && a.item && a.why ? `Try: ${a.item} — ${a.why}` : ''))
        .filter(Boolean);

      const lines = [...suggestionLines, ...altLines];
      openCoaching(lines.length ? lines.join('\n• ') : 'No suggestions.');
    } catch (e: any) {
      openCoaching(e?.message || 'Could not fetch coaching tips.');
    }
  }

  async function removeMeal(id: string) {
    setMeals((list) => list.filter((x) => x.id !== id));
    if (userId) await supabase.from('meals').delete().eq('id', id).eq('user_id', userId);
  }

  async function suggestSwap() {
    try {
      setBusy(true);
      const tip = await getSwapSuggestion({
        calories: Math.max(0, remainingCalories),
        protein: remainingProtein,
        carbs: remainingCarbs,
        fat: remainingFat,
      });
      setSwap(tip);
    } catch {
      setSwap('Could not fetch swap suggestion.');
    } finally {
      setBusy(false);
    }
  }

  function openCoaching(text: string) {
    setCoachText(text || 'Could not fetch coaching tips.');
    setCoachOpen(true);
  }

  const pct = (num: number, den: number) => {
    if (!den || den <= 0) return 0;
    const v = Math.round((num / den) * 100);
    return Math.max(0, Math.min(100, v));
  };

  const consumedPct = {
    calories: pct(totalsWithPreview.calories, (currentGoal?.calories || 0) + (workoutKcal + previewWorkoutKcal)),
    protein:  pct(totalsWithPreview.protein,  currentGoal?.protein || 0),
    carbs:    pct(totalsWithPreview.carbs,    currentGoal?.carbs   || 0),
    fat:      pct(totalsWithPreview.fat,      currentGoal?.fat     || 0),
  };

  function openQuickEdit() {
    setQCalories(currentGoal?.calories || 0);
    setQProtein(currentGoal?.protein || 0);
    setQCarbs(currentGoal?.carbs || 0);
    setQFat(currentGoal?.fat || 0);
    setQLabel(String(goalLabel || ''));
    setQWhy(String(goalRationale || (targets as any)?.rationale || ''));
    setQuickOpen(true);
  }

  async function saveQuickEdit() {
    if (!userId) { alert('No user logged in.'); return; }
    const payload = {
      calories: Math.max(0, Math.round(qCalories || 0)),
      protein:  Math.max(0, Math.round(qProtein  || 0)),
      carbs:    Math.max(0, Math.round(qCarbs    || 0)),
      fat:      Math.max(0, Math.round(qFat      || 0)),
      label:    (qLabel || '').toUpperCase(),
      rationale: qWhy || undefined,
    };

    try {
      // Persist per-user (baseline)
      const up = await supabase
        .from('user_targets')
        .upsert({
          user_id: userId,
          calories: payload.calories,
          protein: payload.protein,
          carbs: payload.carbs,
          fat: payload.fat,
          label: payload.label || null,
          rationale: payload.rationale || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      if (up.error) throw up.error;

      // Mirror into today's day row (authoritative for today/daily allowance)
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

      // Update local state + broadcast + localStorage
      setCurrentGoal({
        calories: payload.calories,
        protein:  payload.protein,
        carbs:    payload.carbs,
        fat:      payload.fat,
      });
      setGoalLabel(payload.label || null);
      setGoalRationale(payload.rationale || null);
      eventBus.emit('targets:update', payload);
      persistTargetsLocally(payload);

      setQuickOpen(false);
      showToast('Your targets have been saved.');
    } catch (e: any) {
      alert(e?.message || 'Could not save targets.');
    }
  }

  if (loading) return <div className="text-gray-900 dark:text-gray-100">Loading…</div>;

  return (
    <div className="min-h-screen w-full bg-white dark:bg-neutral-950 text-gray-900 dark:text-neutral-100">
      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 top-4 -translate-x-1/2 z-50">
          <div className="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2 shadow-lg">
            {toast}
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-3xl px-4 pb-10 pt-4">

        {/* Header + Edit */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">Today</h1>
          <button
            onClick={openQuickEdit}
            className="text-sm font-medium rounded-lg px-3 py-1.5 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            Edit Targets
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 mb-4">
          <SummaryPill label="Current target" value={goalLabel ? String(goalLabel).toUpperCase() : '—'} />
          <SummaryPill label="Exercise added" value={`${Math.round(exerciseAdded)} kcal`} />
          <SummaryPill label="Daily allowance" value={`${Math.round(dailyAllowance)} kcal`} />
        </div>

        {/* Macro meters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <MacroMeter title="Calories" used={totalsWithPreview.calories} goal={dailyAllowance} unit="kcal" />
          <MacroMeter title="Protein"  used={totalsWithPreview.protein}  goal={currentGoal?.protein || 0} unit="g" />
          <MacroMeter title="Carbs"    used={totalsWithPreview.carbs}    goal={currentGoal?.carbs   || 0} unit="g" />
          <MacroMeter title="Fat"      used={totalsWithPreview.fat}      goal={currentGoal?.fat     || 0} unit="g" />
        </div>

        {/* Food eaten & Remaining */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <MiniCard
            title="Food eaten"
            rows={[
              ['Calories', `${Math.round(totalsWithPreview.calories)} kcal`],
              ['Protein',  `${Math.round(totalsWithPreview.protein)} g`],
              ['Carbs',    `${Math.round(totalsWithPreview.carbs)} g`],
              ['Fat',      `${Math.round(totalsWithPreview.fat)} g`],
            ]}
          />
          <MiniCard
            title="Remaining"
            rows={[
              ['Calories', `${Math.max(0, Math.round(remainingCalories))} kcal`],
              ['Protein',  `${Math.max(0, Math.round(remainingProtein))} g`],
              ['Carbs',    `${Math.max(0, Math.round(remainingCarbs))} g`],
              ['Fat',      `${Math.max(0, Math.round(remainingFat))} g`],
            ]}
          />
        </div>

        {/* Meal input */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-2 bg-white dark:bg-neutral-900 mb-4">
          <label className="text-sm font-medium">Log a meal</label>
          <textarea
            className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
            rows={3}
            placeholder="e.g., 1 bowl oatmeal with milk and banana; 2 eggs scrambled in olive oil"
            value={mealText}
            onChange={(e) => setMealText(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={addMealFromEstimate}
              disabled={busy || !mealText.trim()}
              className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black disabled:opacity-60"
            >
              AI Coach: Estimate & add
            </button>
            <button
              onClick={suggestSwap}
              disabled={busy}
              type="button"
              className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800 disabled:opacity-60"
            >
              AI Coach: Quick swap
            </button>
            {swap && <div className="text-sm">• {swap}</div>}
          </div>
          {previewMeal && (
            <div className="text-xs text-neutral-600 dark:text-neutral-300">
              Preview impact: −{previewMeal.calories} kcal, −{previewMeal.protein}P, −{previewMeal.carbs}C, −{previewMeal.fat}F
            </div>
          )}
        </div>

        {/* Workout input */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-2 bg-white dark:bg-neutral-900 mb-6">
          <label className="text-sm font-medium">Log today’s workout</label>
          <input
            className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
            placeholder="e.g., 30 min brisk walk; or 45 min weight training moderate"
            value={workoutText}
            onChange={(e) => setWorkoutText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={addWorkout}
              disabled={busy || !workoutText.trim()}
              className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black disabled:opacity-60"
            >
              AI Coach: Estimate burn
            </button>
            {(workoutKcal > 0 || previewWorkoutKcal > 0) && (
              <div className="text-sm">
                {previewWorkoutKcal > 0 ? `Preview: +${previewWorkoutKcal} kcal` : `Saved: +${workoutKcal} kcal to allowance`}
              </div>
            )}
          </div>
        </div>

        {/* Meals table */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-x-auto bg-white dark:bg-neutral-900">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-neutral-100 dark:bg-neutral-800 text-left">
                <th className="p-2">Meal</th>
                <th className="p-2">Cal</th>
                <th className="p-2">P</th>
                <th className="p-2">C</th>
                <th className="p-2">F</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {meals.map((m) => (
                <tr key={m.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="p-2 align-top">{m.meal_summary}</td>
                  <td className="p-2">{m.calories}</td>
                  <td className="p-2">{m.protein}</td>
                  <td className="p-2">{m.carbs}</td>
                  <td className="p-2">{m.fat}</td>
                  <td className="p-2 flex gap-2">
                    <button
                      className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800"
                      onClick={() => coachMealRow(m)}
                    >
                      AI Coach: Coach
                    </button>
                    <button
                      className="px-2 py-1 rounded-lg bg-red-600 text-white dark:bg-red-500"
                      onClick={() => removeMeal(m.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 font-semibold">
                <td className="p-2">Totals (meals)</td>
                <td className="p-2">{totalsFromMeals.calories}</td>
                <td className="p-2">{totalsFromMeals.protein}</td>
                <td className="p-2">{totalsFromMeals.carbs}</td>
                <td className="p-2">{totalsFromMeals.fat}</td>
                <td className="p-2"></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Coaching modal */}
        <Modal isOpen={coachOpen} onClose={() => setCoachOpen(false)} title="AI Coach Suggestions">
          <div>{coachText ? `• ${coachText}` : 'No suggestions.'}</div>
        </Modal>

        {/* Quick Edit Targets modal */}
        <Modal
          isOpen={quickOpen}
          onClose={() => setQuickOpen(false)}
          title={
            <div className="flex items-center justify-between w-full">
              <span>Quick Edit Targets</span>
              <a
                href={usesHash ? '#/targets' : '/targets'}
                className="text-xs underline opacity-80 hover:opacity-100"
              >
                Open full Targets page
              </a>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="text-xs text-neutral-500">Label</div>
              <input
                className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
                placeholder="e.g., LEAN / CUT / BULK"
                value={qLabel}
                onChange={(e) => setQLabel(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Calories" value={qCalories} onChange={setQCalories} suffix="kcal" />
              <Field label="Protein"  value={qProtein}  onChange={setQProtein}  suffix="g" />
              <Field label="Carbs"    value={qCarbs}    onChange={setQCarbs}    suffix="g" />
              <Field label="Fat"      value={qFat}      onChange={setQFat}      suffix="g" />
            </div>

            <div>
              <div className="text-xs text-neutral-500 mb-1">Why / notes (optional)</div>
              <textarea
                rows={3}
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
                placeholder="Short rationale for these targets…"
                value={qWhy}
                onChange={(e) => setQWhy(e.target.value)}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={saveQuickEdit}
                className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black"
              >
                Save targets
              </button>
              <button
                onClick={() => setQuickOpen(false)}
                className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}

/* ---------- UI atoms ---------- */

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function MacroMeter({
  title,
  used,
  goal,
  unit,
}: {
  title: string;
  used: number;
  goal: number;
  unit: string;
}) {
  const pct = Math.max(0, Math.min(100, (used / Math.max(goal, 1)) * 100));
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {Math.round(used)} / {Math.round(goal)} {unit}
        </span>
      </div>
      <div className="h-3 w-full rounded-full bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
        <div
          className="h-3 rounded-full bg-purple-600"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-right text-[11px] text-neutral-500 dark:text-neutral-400">
        {Math.round(pct)}%
      </div>
    </div>
  );
}

function MiniCard({
  title,
  rows,
}: {
  title: string;
  rows: [string, string][];
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-sm font-semibold mb-2">{title}</div>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-sm">
            <dt className="text-neutral-500 dark:text-neutral-400">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Field({
  label, value, onChange, suffix
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div>
      <div className="text-xs text-neutral-500 mb-1">{label}{suffix ? ` (${suffix})` : ''}</div>
      <input
        type="number"
        min={0}
        className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value || 0))}
      />
    </div>
  );
}
