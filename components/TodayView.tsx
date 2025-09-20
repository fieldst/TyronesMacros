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

  // Local target override (updated when Targets tab saves)
  const [currentGoal, setCurrentGoal] = useState<MacroSet>(targets || { calories: 0, protein: 0, carbs: 0, fat: 0 });

  // Live preview (debounced) while typing
  const [previewMeal, setPreviewMeal] = useState<MacroSet | null>(null);
  const [previewWorkoutKcal, setPreviewWorkoutKcal] = useState<number>(0);
  const mealTimer = useRef<number | null>(null);
  const woTimer = useRef<number | null>(null);

  // Load user + today's data
  useEffect(() => {
    (async () => {
      const id = await getCurrentUserId();
      setUserId(id);

      if (id) {
        const { data: mealsData } = await supabase
          .from('meals')
          .select('id, meal_summary, calories, protein, carbs, fat')
          .eq('user_id', id)
          .eq('date', todayStr())
          .order('created_at', { ascending: false });
        setMeals((mealsData as any) || []);

        const { data: day } = await supabase
          .from('days')
          .select('workout_logged, workout_kcal, targets')
          .eq('user_id', id)
          .eq('date', todayStr())
          .maybeSingle();

        if (day?.workout_kcal != null) setWorkoutKcal(day.workout_kcal as number);
      }
      setLoading(false);
    })();

    // Listen for Target saves from Targets tab
    const off = eventBus.on<MacroSet>('targets:update', (payload) => {
      setCurrentGoal({
        calories: payload.calories ?? 0,
        protein:  payload.protein  ?? 0,
        carbs:    payload.carbs    ?? 0,
        fat:      payload.fat      ?? 0,
      });
    });

    return () => { off(); };
  }, []);

  // Keep local currentGoal in sync if parent changes
  useEffect(() => {
    setCurrentGoal(targets || { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }, [targets]);

  // Totals from meals (consumed)
  const totalsFromMeals: MacroSet = useMemo(
    () =>
      meals.reduce(
        (acc, m) => ({
          calories: acc.calories + (m.calories || 0),
          protein: acc.protein + (m.protein || 0),
          carbs: acc.carbs + (m.carbs || 0),
          fat: acc.fat + (m.fat || 0),
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

  // Realistic calorie math:
  // Allowance = Current Goal Target (base) + (workoutKcal + previewWorkoutKcal)
  // Remaining = Allowance - (Food eaten + preview meal)
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

        if (existing && existing.length > 0) {
          const { error } = await supabase
            .from('days')
            .update({ workout_logged: workoutText.trim(), workout_kcal: kcal, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('date', todayStr());
          if (error) throw error;
        } else {
          const { error } = await supabase.from('days').insert({
            user_id: userId,
            date: todayStr(),
            workout_logged: workoutText.trim(),
            workout_kcal: kcal,
            targets: currentGoal || { calories: 0, protein: 0, carbs: 0, fat: 0 },
          });
          if (error) throw error;
        }
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
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim());

      const altLines = (coaching?.better_alternatives || [])
        .map((a) => (a && a.item && a.why ? `Try: ${a.item} — ${a.why}` : ''))
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

  if (loading) return <div className="text-gray-900 dark:text-gray-100">Loading…</div>;

  return (
    <div className="p-4 space-y-6">
      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Current Goal Target" value={baseTarget} />
        <Stat label="Exercise added" value={exerciseAdded} />
        <Stat label="Daily allowance" value={dailyAllowance} />
        <Stat label="Food eaten" value={totalsWithPreview.calories} />
        <Stat
          label="Remaining"
          value={remainingCalories}
          emphasize
          hint={remainingCalories < 0 ? 'Over target' : undefined}
        />
      </div>

      {/* Meal input */}
      <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-2 bg-white dark:bg-gray-800">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Log a meal</label>
        <textarea
          className="w-full border border-gray-200 dark:border-gray-700 rounded p-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          rows={3}
          placeholder="e.g., 1 bowl oatmeal with milk and banana; 2 eggs scrambled in olive oil"
          value={mealText}
          onChange={(e) => setMealText(e.target.value)}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={addMealFromEstimate}
            disabled={busy || !mealText.trim()}
            className="btn btn-primary disabled:opacity-60 bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 rounded-xl px-3 py-1"
          >
            {busy ? 'Estimating…' : 'Estimate macros & add'}
          </button>
          <button
            onClick={suggestSwap}
            disabled={busy}
            className="btn btn-ghost rounded-xl px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            type="button"
          >
            Quick swap for remaining
          </button>
          {swap && <div className="text-sm text-gray-700 dark:text-gray-200">• {swap}</div>}
        </div>
        {previewMeal && (
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Preview impact: −{previewMeal.calories} kcal, −{previewMeal.protein}P, −{previewMeal.carbs}C, −{previewMeal.fat}F
          </div>
        )}
      </div>

      {/* Workout input */}
      <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-2 bg-white dark:bg-gray-800">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Log today’s workout</label>
        <input
          className="w-full border border-gray-200 dark:border-gray-700 rounded p-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          placeholder="e.g., 30 min brisk walk; or 45 min weight training moderate"
          value={workoutText}
          onChange={(e) => setWorkoutText(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={addWorkout}
            disabled={busy || !workoutText.trim()}
            className="btn btn-primary disabled:opacity-60 bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 rounded-xl px-3 py-1"
          >
            {busy ? 'Estimating…' : 'Estimate burn & save'}
          </button>
          {(workoutKcal > 0 || previewWorkoutKcal > 0) && (
            <div className="text-sm text-gray-700 dark:text-gray-200">
              {previewWorkoutKcal > 0 ? `Preview: +${previewWorkoutKcal} kcal` : `Saved: +${workoutKcal} kcal to allowance`}
            </div>
          )}
        </div>
      </div>

      {/* Meals table */}
      <div className="rounded border border-gray-200 dark:border-gray-700 overflow-x-auto bg-white dark:bg-gray-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-700 text-left text-gray-900 dark:text-gray-100">
              <th className="p-2">Meal</th>
              <th className="p-2">Cal</th>
              <th className="p-2">P</th>
              <th className="p-2">C</th>
              <th className="p-2">F</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody className="text-gray-900 dark:text-gray-100">
            {meals.map((m) => (
              <tr key={m.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="p-2 align-top">{m.meal_summary}</td>
                <td className="p-2">{m.calories}</td>
                <td className="p-2">{m.protein}</td>
                <td className="p-2">{m.carbs}</td>
                <td className="p-2">{m.fat}</td>
                <td className="p-2 flex gap-2">
                  <button className="btn btn-ghost px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100" onClick={() => coachMealRow(m)}>Coach</button>
                  <button className="btn btn-danger px-2 py-1 rounded-lg bg-red-600 text-white dark:bg-red-500" onClick={() => removeMeal(m.id)}>Remove</button>
                </td>
              </tr>
            ))}

            {/* Totals row */}
            <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-semibold text-gray-900 dark:text-white">
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

      {/* Macro remaining (numbers high-contrast) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CardStat label="Remaining Calories" value={remainingCalories} />
        <CardStat label="Remaining Protein (g)" value={remainingProtein} />
        <CardStat label="Remaining Carbs (g)" value={remainingCarbs} />
        <CardStat label="Remaining Fat (g)" value={remainingFat} />
      </div>

      <Modal isOpen={coachOpen} onClose={() => setCoachOpen(false)} title="AI Suggestions">
        <div className="text-gray-900 dark:text-gray-100">{coachText ? `• ${coachText}` : 'No suggestions.'}</div>
      </Modal>
    </div>
  );
}

function Stat({ label, value, emphasize=false, hint }: { label: string; value: number; emphasize?: boolean; hint?: string }) {
  return (
    <div className={`p-3 rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 ${emphasize ? 'ring-2 ring-gray-900 dark:ring-gray-200' : ''}`}>
      <div className="text-sm text-gray-600 dark:text-gray-300">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      {hint && <div className="text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  )
}

function CardStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-900 dark:text-white">{value}</div>
    </div>
  )
}
