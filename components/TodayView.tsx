
import * as __EventBusModule from '../lib/eventBus';
const eventBus = (typeof __EventBusModule !== 'undefined' && (__EventBusModule as any).eventBus)
  ? (__EventBusModule as any).eventBus
  : (typeof window !== 'undefined' && (window as any).eventBus)
    ? (window as any).eventBus
    : { on: () => () => {}, emit: () => {} };

// components/TodayView.tsx
import { ensureTodayDay } from '../services/dayService';
import { dateKeyChicago, msUntilNextChicagoMidnight, localDateKey } from '../lib/dateLocal';
import { supabase } from "../supabaseClient";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { recalcAndPersistDay } from '../lib/recalcDay';
import { getActiveTarget, inferGoalFromTargetText } from '../services/targetsService'
import { mifflinStJeor, activityMultiplier, adjustForGoal, defaultMacros } from '../lib/nutrition'
import { workoutStyleSuggestion, buildFiveDayMealPlan } from '../services/coachSuggest'

import { getCurrentUserId } from '../auth';
import {
  estimateMacrosForMeal,
  getMealCoaching,
  getSwapSuggestion,
  getWorkoutCalories,
  getDailyGreeting,
  // 🟣 Planner service
  planWeek,
  type PlanWeekOptions,
} from '../services/openaiService';

// ---- Snapshot to stabilize first paint and prevent flicker ----

// Optimistically adjust workoutCals/allowance/remaining in local state
function applyOptimisticWorkoutDelta(delta: number) {
  if (!delta) return;
  setDay(prev => {
    if (!prev) return prev;
    const t = prev.totals || { foodCals: 0, workoutCals: 0, allowance: 0, remaining: 0 };
    const workoutCals = Math.max(0, Math.round((t.workoutCals || 0) + delta));
    // Allowance/remaining increase with burn; keep them non-negative
    const allowance = Math.max(0, Math.round((t.allowance || (currentGoal?.calories || 0)) + delta));
    const remaining = Math.max(0, Math.round((t.remaining || (currentGoal?.calories || 0)) + delta));
    return { ...prev, totals: { ...t, workoutCals, allowance, remaining } };
  });
}




const SNAP_KEY = 'tm:lastDaySnapshot';
type DaySnapshot = {
  dayId: string;
  date: string;
  targets: any | null;
  totals: { foodCals: number; workoutCals: number; allowance: number; remaining: number } | null;
  updatedAt: number;
};
function loadSnapshot(): DaySnapshot | null {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch { return null; }
}
function saveSnapshot(s: DaySnapshot) {
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(s)); } catch {}
}

import { upsertFoodEntry, deleteFoodEntry, upsertWorkoutEntry, deleteWorkoutEntry } from '../services/loggingService';

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
  meal_summary?: string;
  name?: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

type WorkoutRow = {
  id: string;
  kind: string;
  calories: number;
};

type DayRow = {
  id: string;
  date: string;
  targets?: any;
  totals?: { foodCals: number; workoutCals: number; allowance: number; remaining: number };
};

// ---------- Greeting helpers ----------
function resolveDisplayNameFromAuth(user: any): string {
  if (!user) return '';
  const md: any = user?.user_metadata ?? {};
  const id0: any = (user?.identities && user.identities[0]?.identity_data) ?? {};
  const name =
    md.display_name ?? md.full_name ?? md.name ?? md.preferred_username ??
    md.given_name ?? md.nickname ?? id0.full_name ?? id0.name ?? id0.given_name ??
    (user?.email ? user.email.split('@')[0] : '');
  return (name ?? '').toString().trim();
}

/** Try DB table if it exists; otherwise use auth metadata (silent fail on 400/404). */
async function fetchDisplayNameSafe(): Promise<string> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user ?? null;
    const authName = resolveDisplayNameFromAuth(user);
    // REMOVE the user_profiles query entirely (it caused the 400s)
    return authName || '';
  } catch {
    return '';
  }
}


// 🔒 Local storage keys
const LS_TARGETS_KEY = 'aiCoach.currentTargets';
const LS_WEEK_PLAN = 'tm:plannedWeek';

// ---- tiny helper to log Supabase errors consistently ----
function logSb(where: string, error: any, extra?: Record<string, unknown>) {
  if (error) console.error(`[Supabase] ${where}`, { error, ...extra });
}

function toFirstName(display: string): string {
  const first = (display || '').trim().split(/\s+/)[0] || '';
  return first ? first[0].toUpperCase() + first.slice(1) : '';
}
function greetingForLocal(now: Date = new Date()): 'Morning' | 'Afternoon' | 'Evening' {
  const hr = now.getHours(); return hr < 12 ? 'Morning' : hr < 18 ? 'Afternoon' : 'Evening';
}
function msUntilNextLocalMidnight(): number {
  const now = new Date(); const next = new Date(now); next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/** Smart calorie estimator (AI → fallback heuristic). */
async function estimateWorkoutKcalSmart(text: string, profile: Profile): Promise<number> {
  try {
    const ai = await getWorkoutCalories(text, profile);
    const aiKcal = Math.round(Number(ai?.total_calories ?? 0));
    if (Number.isFinite(aiKcal) && aiKcal > 0) return aiKcal;
  } catch {}
  const lower = text.toLowerCase();
  const durMatch = lower.match(/(\d{1,3})\s*(min|mins|minute|minutes)/);
  const minutes = durMatch ? Math.max(10, Math.min(180, parseInt(durMatch[1], 10))) : 30;

  const intense =
    /\b(intense|hard|vigorous|interval|hiit|sprint)\b/.test(lower) ? 'high' :
    /\b(moderate|tempo|threshold)\b/.test(lower) ? 'moderate' : 'easy';

  const isRun = /\b(run|jog)\b/.test(lower);
  const isWalk = /\bwalk\b/.test(lower);
  const isRide = /\b(cycle|bike|biking|cycling|spin)\b/.test(lower);
  const isRow = /\b(row|rowing|erg)\b/.test(lower);
  const isSwim = /\b(swim|laps)\b/.test(lower);
  const isLift =
    /\b(weight|lift|strength|deadlift|squat|bench|press|clean|snatch|curl|push|pull|db|barbell|kettlebell)\b/.test(lower);

  const METS = {
    walk_easy: 3.5, run_easy: 7.0, run_high: 9.8, ride_moderate: 7.5, row_moderate: 7.0,
    swim_moderate: 8.0, lift_easy: 3.5, lift_moderate: 6.0, misc_moderate: 5.0,
  };

  let met = METS.misc_moderate;
  if (isWalk) met = METS.walk_easy;
  else if (isRun) met = intense === 'high' ? METS.run_high : METS.run_easy;
  else if (isRide) met = METS.ride_moderate;
  else if (isRow) met = METS.row_moderate;
  else if (isSwim) met = METS.swim_moderate;
  else if (isLift) met = intense === 'high' ? METS.lift_moderate : METS.lift_easy;

  const kg = Math.max(40, Math.min(200, (profile?.weight_lbs ?? 180) * 0.45359237));
  return Math.round((met * 3.5 * kg / 200) * minutes);
}

// 🟣 Planner constants
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const;

export default function TodayView({
  profile,
  targets,
  onTotalsChange,
  onOpenPlanner, 
}: {
 profile: Profile;
  targets: MacroSet;
  onTotalsChange?: (totals: DayTotals) => void;
  onOpenPlanner?: () => void; 
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [dayKey, setDayKey] = useState<string>(''); // YYYY-MM-DD
  const [day, setDay] = useState<DayRow | null>(null);
  function applyOptimisticWorkoutDelta(delta: number) {
  if (!delta) return;
  setDay(prev => {
    if (!prev) return prev;
    const t = prev.totals || { foodCals: 0, workoutCals: 0, allowance: 0, remaining: 0 };
    const workoutCals = Math.max(0, Math.round((t.workoutCals || 0) + delta));
    const allowance = Math.max(0, Math.round((t.allowance || (currentGoal?.calories || 0)) + delta));
    const remaining = Math.max(0, Math.round((t.remaining || (currentGoal?.calories || 0)) + delta));
    return { ...prev, totals: { ...t, workoutCals, allowance, remaining } };
  });
}
  const [dayId, setDayId] = useState<string | null>(null);

  const [mealText, setMealText] = useState('');
  const [workoutText, setWorkoutText] = useState(''); // 🏋️ “Add workout” text
  const [meals, setMeals] = useState<MealRow[]>([]);
  const [savedMeals, setSavedMeals] = useState<{ id: string; name: string; payload: any }[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);

  const booted = useRef(false);
  const latestTotalsAt = useRef(0);
  const raf = useRef<number | null>(null);
  const pendingTotals = useRef<DayRow['totals'] | null>(null);
  const applyTotals = (incoming: DayRow['totals']) => {
    if (!incoming) return;
    const now = Date.now();
    if (now < latestTotalsAt.current) return;
    pendingTotals.current = incoming;
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const t = pendingTotals.current; pendingTotals.current = null;
      if (!t) return;
      latestTotalsAt.current = Date.now();
      setDay(prev => {
        if (!prev) return prev;
        const merged = { ...prev, totals: t };
        saveSnapshot({ dayId: prev.id, date: prev.date, targets: prev.targets, totals: t, updatedAt: latestTotalsAt.current });
        return merged;
      });
    });
  };

  const [busy, setBusy] = useState(false);

  // derived preview-only values (not persisted)
  const [swap, setSwap] = useState<string>('');
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachText, setCoachText] = useState('');

  // Workouts: edit modal state
  const [editWoOpen, setEditWoOpen] = useState(false);
  const [editWoId, setEditWoId] = useState<string | null>(null);
  const [editWoKind, setEditWoKind] = useState<string>('');
  const [editWoKcal, setEditWoKcal] = useState<number>(0);

  // Per-row suggestions modal
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestForId, setSuggestForId] = useState<string | null>(null);
  const [suggestForTitle, setSuggestForTitle] = useState<string>('');
  const [woSuggestions, setWoSuggestions] = useState<Array<{ title: string; kcal: number }>>([]);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 3200); };

  // Quick Edit Targets
  const [quickOpen, setQuickOpen] = useState(false);
  const [qCalories, setQCalories] = useState<number>(targets?.calories ?? 0);
  const [qProtein,  setQProtein]  = useState<number>(targets?.protein  ?? 0);
  const [qCarbs,    setQCarbs]    = useState<number>(targets?.carbs    ?? 0);
  const [qFat,      setQFat]      = useState<number>(targets?.fat      ?? 0);
  const [qLabel,    setQLabel]    = useState<string>(String((targets as any)?.label || ''));
  const [qWhy,      setQWhy]      = useState<string>(String((targets as any)?.rationale || ''));

  // Local target override
  const [currentGoal, setCurrentGoal] = useState<MacroSet>(targets || { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [goalLabel, setGoalLabel] = useState<string | null>(() => (targets as any)?.label ?? null);
  const [goalRationale, setGoalRationale] = useState<string | null>(String((targets as any)?.rationale || '') || null);

  // Live previews
  const [previewMeal, setPreviewMeal] = useState<MacroSet | null>(null);
  const [previewWorkoutKcal, setPreviewWorkoutKcal] = useState<number>(0);
  const mealTimer = useRef<number | null>(null);
  const woTimer = useRef<number | null>(null);

  // Personalized greeting
  const [greeting, setGreeting] = useState<'Morning' | 'Afternoon' | 'Evening'>(greetingForLocal());
  const [phrase, setPhrase] = useState<string>('');
  const [userName, setUserName] = useState<string>('');

  // 🟣 Week Planner state
  const [planOpen, setPlanOpen] = useState(false);         // open modal to (re)generate
  const [viewPlanOpen, setViewPlanOpen] = useState(false); // open modal to view plan
  const [currentPlan, setCurrentPlan] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem(LS_WEEK_PLAN) || 'null'); } catch { return null; }
  });

  const [styleSel, setStyleSel] = useState<PlanWeekOptions['style']>('HIIT');
  const [goalSel, setGoalSel] = useState<PlanWeekOptions['goal']>('lean');
  const [minutes, setMinutes] = useState<number>(30);
  const [experience, setExperience] = useState<PlanWeekOptions['experience']>('intermediate');
  const [equipmentInput, setEquipmentInput] = useState<string>('assault bike, kettlebell, dumbbells');
  const [daysSel, setDaysSel] = useState<string[]>(['Mon','Wed','Fri']);

const [currentTargetText, setCurrentTargetText] = useState<string | null>(null)
const [allowanceKcal, setAllowanceKcal] = useState<number | null>(null)
const [macroTargets, setMacroTargets] = useState<{kcal:number; protein_g:number; carbs_g:number; fat_g:number} | null>(null)
const [workoutSuggestion, setWorkoutSuggestion] = useState<{header:string; bullets:string[]} | null>(null)
const [fiveDayMeals, setFiveDayMeals] = useState<any[] | null>(null)

  const equipment = useMemo(() => equipmentInput.split(',').map(s => s.trim()).filter(Boolean), [equipmentInput]);
  function toggleDay(d: string) {
    setDaysSel(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }
  async function handleGeneratePlan() {
    try {
      setBusy(true);
      const payload: PlanWeekOptions = {
        goal: goalSel,
        style: styleSel,
        availableDays: daysSel as any,
        minutesPerSession: minutes,
        equipment,
        experience,
      };
      const res = await planWeek(payload);
      setCurrentPlan(res);
      try { localStorage.setItem(LS_WEEK_PLAN, JSON.stringify(res)); } catch {}
      setPlanOpen(false);
      setViewPlanOpen(true);
      showToast('Week plan created');
    } catch (e: any) {
      showToast(e?.message || 'Could not generate plan');
    } finally { setBusy(false); }
  }
  function clearPlan() {
    setCurrentPlan(null);
    try { localStorage.removeItem(LS_WEEK_PLAN); } catch {}
  }

  // Resolve display name (silent on missing table)
  useEffect(() => {
  const off = eventBus.on('workout:upsert', async () => {
    try {
      const uid = await getCurrentUserId()
      if (!uid) return
      const d = dateKeyChicago()
      await recalcAndPersistDay(uid, d)

       //  add this so meters/lists update immediately
      eventBus.emit('day:totals', { dayId, totals: (d as any)?.totals })
      // if you have a reloadDay() in scope, call it so the UI lists update
      // await reloadDay()
    } catch (e) {
      console.error('Failed to refresh totals after workout upsert', e)
    }
  })
  return () => off()
}, [])

  useEffect(() => {
    let canceled = false;
    (async () => {
      const name = await fetchDisplayNameSafe();
      if (!canceled) setUserName(name);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (canceled) return;
      const user = session?.user ?? null;
      setUserName(resolveDisplayNameFromAuth(user));
    });
    return () => { canceled = true; sub?.subscription?.unsubscribe?.(); };
  }, []);

  

useEffect(() => {
  (async () => {
    try {
      const uid = await getCurrentUserId()
      if (!uid) return

      // 1) Pull current Target (text + optional macros)
      const active = await getActiveTarget(uid)
      const goalText = (active && typeof active.text === 'string') ? active.text : null
      setCurrentTargetText(goalText)

      // 2) Load profile to compute allowance/macros if they’re not in Targets
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('sex, age, height_in, weight_lbs, activity_level')
        .eq('user_id', uid)
        .maybeSingle()

      const sex = (String(profile?.sex || 'male').toLowerCase().startsWith('f') ? 'female' : 'male') as 'male'|'female'
      const age = Number(profile?.age || 30)
      const heightIn = Number(profile?.height_in || 70)
      const weightLbs = Number(profile?.weight_lbs || 180)
      const bmr = mifflinStJeor({ sex, age, heightIn, weightLbs })
      const tdee = Math.round(bmr * activityMultiplier(profile?.activity_level))
      const inferred = inferGoalFromTargetText(goalText)

      const kcal = (active.kcal && active.kcal > 0) ? Math.round(active.kcal) : adjustForGoal(tdee, inferred)
      const macros = {
        kcal,
        protein_g: active.protein_g ?? defaultMacros(kcal, weightLbs, inferred).protein_g,
        carbs_g:   active.carbs_g   ?? defaultMacros(kcal, weightLbs, inferred).carbs_g,
        fat_g:     active.fat_g     ?? defaultMacros(kcal, weightLbs, inferred).fat_g,
      }

      setAllowanceKcal(kcal)
      setMacroTargets(macros)

            // Make the pill show immediately and persist for next visit
      setCurrentGoal({
        calories: macros.kcal,
        protein: macros.protein_g,
        carbs:   macros.carbs_g,
        fat:     macros.fat_g,
      });
      persistTargetsLocally({
        calories: macros.kcal,
        protein: macros.protein_g,
        carbs:   macros.carbs_g,
        fat:     macros.fat_g,
        label:   (goalText || '') || (inferred || ''),
        rationale: `Aligned to ${inferred || 'target'}`,
      });

      // 3) Build workout style suggestion (replace "AI Coach Workout Plan")
      const s = workoutStyleSuggestion({
        goalText,
        inferred,
        styleOptions: ['classic','push-pull-legs','upper-lower','circuit','crossfit'],
      })
      setWorkoutSuggestion(s)

      // 4) Build 5-day meal plan from target macros
      setFiveDayMeals(buildFiveDayMealPlan(macros))
    } catch (e) {
      console.error('TodayView: target/macros compute failed', e)
    }
  })()
}, [])



  // Persist targets locally
  function persistTargetsLocally(payload: any) {
    try { localStorage.setItem(LS_TARGETS_KEY, JSON.stringify(payload)); } catch {}
  }
  function loadTargetsFromLocal(): any | null {
    try { return JSON.parse(localStorage.getItem(LS_TARGETS_KEY) || 'null'); } catch { return null; }
  }

  // Load foods/workouts
  async function loadFoods(uId: string, dateKey: string) {
    const { data: foods, error: foodsErr } = await supabase
      .from('food_entries')
      .select('id, description, calories, protein, carbs, fat, created_at')
      .eq('user_id', uId).eq('entry_date', dateKey)
      .order('created_at', { ascending: false });
    logSb('loadFoods', foodsErr, { uId, dateKey });
    setMeals(((foods as any) || []).map((r: any) => ({
      id: r.id, meal_summary: r.description, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
    })));
  }
  async function loadWorkouts(uId: string, dateKey: string) {
    const { data, error } = await supabase
      .from('workout_entries')
      .select('id, activity, calories_burned, created_at')
      .eq('user_id', uId).eq('entry_date', dateKey)
      .order('created_at', { ascending: false });
    logSb('loadWorkouts', error, { uId, dateKey });
    setWorkouts(((data as any) || []).map((r: any) => ({
      id: r.id, kind: r.activity, calories: Math.round(r.calories_burned || 0),
    })));
  }

  // Save the current previewed meal (from the AI estimate) into saved_meals
async function saveCurrentEstimateAsMeal(name: string) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return alert('Please sign in.');

    if (!previewMeal || !mealText.trim()) {
      return alert('Add a meal description and let AI estimate first.');
    }

    const payload = {
      name,
      description: mealText.trim(),
      macros: {
        calories: Math.round(previewMeal.calories || 0),
        protein: Math.round(previewMeal.protein || 0),
        carbs: Math.round(previewMeal.carbs || 0),
        fat: Math.round(previewMeal.fat || 0),
      },
    };

    const { data, error } = await supabase
      .from('saved_meals')
      .insert([{ user_id: uid, name, payload }])
      .select('id, name, payload, created_at')
      .single();

    if (error) throw error;
    setSavedMeals((prev) => [data as any, ...prev]); // optimistic add to list
    showToast('Saved to “Saved meals”.');
  } catch (e: any) {
    alert(e?.message || 'Could not save meal.');
  }
}


// Add a saved meal payload to today's foods (persists into food_entries)
// Add a saved meal record to today's foods (ensures P/C/F; updates saved_meals if missing)
async function addSavedMealToToday(item: { id: string; name: string; payload: any }) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid || !dayId) return alert('Please sign in.');

    const payload = item?.payload || {};
    // Description we will log to food_entries
    const desc =
      (payload?.description && String(payload.description)) ||
      (payload?.name && String(payload.name)) ||
      item?.name ||
      'Saved meal';

    // Try to read macros from payload.macros or flat payload
    const src = payload?.macros || payload || {};
    let calories = Number(src?.calories ?? 0);
    let protein  = Number(src?.protein  ?? 0);
    let carbs    = Number(src?.carbs    ?? 0);
    let fat      = Number(src?.fat      ?? 0);

    const hasAnyMacros =
      Number.isFinite(calories) && calories > 0 &&
      Number.isFinite(protein)  && protein  > 0 &&
      Number.isFinite(carbs)    && carbs    > 0 &&
      Number.isFinite(fat)      && fat      > 0;

    // If any macro is missing or zero, estimate from description
    if (!hasAnyMacros) {
      try {
        const est = await estimateMacrosForMeal(desc, profile);
        calories = Math.round(est.macros.calories || 0);
        protein  = Math.round(est.macros.protein  || 0);
        carbs    = Math.round(est.macros.carbs    || 0);
        fat      = Math.round(est.macros.fat      || 0);

        // If original saved_meal lacked macros, persist them so next time is instant
        if (item?.id && calories > 0) {
          const newPayload = {
            ...payload,
            description: payload?.description ?? desc,
            macros: {
              calories: Math.max(0, calories),
              protein:  Math.max(0, protein),
              carbs:    Math.max(0, carbs),
              fat:      Math.max(0, fat),
            },
          };
          const { data: upd, error: updErr } = await supabase
            .from('saved_meals')
            .update({ name: item.name, payload: newPayload, updated_at: new Date().toISOString() })
            .eq('id', item.id)
            .eq('user_id', uid)
            .select('id, name, payload, created_at')
            .single();
          if (!updErr && upd) {
            // refresh local list so dropdown reflects macros next time
            setSavedMeals(prev => prev.map(x => (x.id === item.id ? (upd as any) : x)));
          }
        }
      } catch {
        // if estimation fails, at least ensure we log calories if we had any
        calories = Math.max(0, Math.round(calories || 0));
        protein  = Math.max(0, Math.round(protein  || 0));
        carbs    = Math.max(0, Math.round(carbs    || 0));
        fat      = Math.max(0, Math.round(fat      || 0));
      }
    } else {
      // Normalize numbers if macros were present
      calories = Math.round(calories || 0);
      protein  = Math.round(protein  || 0);
      carbs    = Math.round(carbs    || 0);
      fat      = Math.round(fat      || 0);
    }

    // Persist to food_entries with full macros
    await upsertFoodEntry({
      userId: uid,
      dayId,
      name: desc,
      calories,
      protein,
      carbs,
      fat,
      source: 'saved_meal',
    });

    // Refresh meals & totals
    await loadFoods(uid, dayKey);
    const { data: d } = await supabase.from('days').select('id, totals').eq('id', dayId).maybeSingle();
    if (d) setDay(prev => (prev ? { ...prev, totals: (d as any).totals } : prev));
    showToast(`Added saved meal: ${desc}`);
  } catch (e: any) {
    alert(e?.message || 'Could not add saved meal.');
  }
}


// Saved meals manager
const [manageSavedOpen, setManageSavedOpen] = useState(false);
const [editMealId, setEditMealId] = useState<string | null>(null);
const [editName, setEditName] = useState('');
const [editDesc, setEditDesc] = useState('');
const [editCals, setEditCals] = useState<number | ''>('');
const [editProt, setEditProt] = useState<number | ''>('');
const [editCarb, setEditCarb] = useState<number | ''>('');
const [editFat, setEditFat] = useState<number | ''>('');



  // -------- Bootstrap --------
  useEffect(() => {
    if (booted.current) return; booted.current = true;
    (async () => {
      const id = await getCurrentUserId(); setUserId(id);
      const ls = loadTargetsFromLocal();
      if (ls?.calories) {
        setCurrentGoal({ calories: ls.calories || 0, protein: ls.protein || 0, carbs: ls.carbs || 0, fat: ls.fat || 0 });
        if (ls.label) setGoalLabel(String(ls.label));
        if (ls.rationale) { setGoalRationale(String(ls.rationale)); setQWhy(String(ls.rationale)); }
        setQCalories(ls.calories || 0); setQProtein(ls.protein || 0); setQCarbs(ls.carbs || 0); setQFat(ls.fat || 0); setQLabel(String(ls.label || ''));
      }

      const todayKey = localDateKey(); setDayKey(todayKey);
      const snap = loadSnapshot();
      if (snap && snap.date === todayKey && snap.dayId) {
        setDay({ id: snap.dayId, date: snap.date, targets: snap.targets, totals: snap.totals } as any);
        setDayId(String(snap.dayId));
        latestTotalsAt.current = snap.updatedAt || 0;
        const t = snap.targets || {};
        setCurrentGoal({ calories: Number(t.calories||0), protein: Number(t.protein||0), carbs: Number(t.carbs||0), fat: Number(t.fat||0) });
        if (t.label) setGoalLabel(String(t.label));
        setGoalRationale((t.rationale ? String(t.rationale) : '') || null);
      }

      if (id) {
        // Ensure today exists
        const todayDay = await ensureTodayDay(id);
        setDay(todayDay); setDayId(todayDay.id);
        saveSnapshot({ dayId: todayDay.id, date: todayKey, targets: todayDay.targets, totals: todayDay.totals, updatedAt: Date.now() });
        if (todayDay.totals) applyTotals(todayDay.totals);

        // Hydrate targets from day
        const dayTargets = todayDay.targets;
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

          setQCalories(macros.calories); setQProtein(macros.protein);
          setQCarbs(macros.carbs); setQFat(macros.fat);
          setQLabel(String(dayTargets.label || '')); setQWhy(why);
          persistTargetsLocally({ ...macros, label: dayTargets.label || null, rationale: why || null });
        }

        await loadFoods(id, todayKey);
        await loadWorkouts(id, todayKey);
      }

      setLoading(false);
    })();

    // Listen for Target saves
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

      setQCalories(macros.calories); setQProtein(macros.protein); setQCarbs(macros.carbs); setQFat(macros.fat);
      setQLabel(String(payload.label || '')); setQWhy(String(payload.rationale || ''));

      try {
        if (!userId) return;
        const { data: d, error: dErr } = await supabase
          .from('days')
          .select('id')
          .eq('user_id', userId)
          .eq('date', localDateKey())
          .maybeSingle();
        logSb('targets:update fetch day', dErr, { userId });

        if ((d as any)?.id) {
          const { error: updErr } = await supabase
            .from('days')
            .update({ targets: payload, updated_at: new Date().toISOString() })
            .eq('id', (d as any).id);
          logSb('targets:update update days.targets', updErr, { dayId: (d as any).id });
          setDay(prev => prev ? { ...prev, targets: payload } : prev);
        }
        persistTargetsLocally(payload);
      } catch (err) {
        console.error('Failed to persist targets to days:', err);
      }
    });

    return () => { off(); };
  }, []);

  // Greeting + phrase refresh
  useEffect(() => {
    const t = window.setInterval(() => setGreeting(greetingForLocal()), 5 * 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  // Load user's saved meals (owner-only)
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) return;
        const { data, error } = await supabase
          .from('saved_meals')
          .select('id, name, payload, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false });
        if (!error && data && !canceled) setSavedMeals(data as any);
      } catch {}
    })();
    return () => { canceled = true; };
  }, []);

  // Daily phrase (cached)
  useEffect(() => {
    let canceled = false;
    let midnightTimer: number | undefined;
    async function run() {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) return;
        const dayKey = localDateKey();
        const cacheKey = `dailyGreeting:${uid}:${dayKey}`;
          const cached = localStorage.getItem(cacheKey);
              if (cached && cached.trim()) {
                let val = cached.trim();
                // If it's a JSON blob from old runs, unwrap it
                if (val.startsWith('{')) {
                  try {
                    const j = JSON.parse(val);
                    val = (j && j.data && typeof j.data.text === 'string') ? j.data.text : val;
                  } catch {}
                }
              if (!canceled) setPhrase(val);
            }
            else {
          const name = (userName || '').trim();
          const hour = new Date().getHours();
          const result = await getDailyGreeting(name, dayKey, hour);

// result might be { success:true, data:{ text:"..." } }
const line = typeof result === 'string'
  ? result.trim()
  : (result && result.data && typeof result.data.text === 'string' ? result.data.text : '').trim();

          const clean = line.replace(/\s+/g, ' ').replace(/^["“]|["”]$/g, '');
          if (!canceled && clean) {
            setPhrase(clean);
            try { localStorage.setItem(cacheKey, clean); } catch {}
          }
        }
      } catch {}
      window.clearTimeout(midnightTimer);
      midnightTimer = window.setTimeout(run, msUntilNextLocalMidnight());
    }
    run();
    return () => { canceled = true; if (midnightTimer) window.clearTimeout(midnightTimer); };
  }, [userName]);

  // Chicago midnight rollover
  const midnightTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!userId) return;
    const schedule = () => {
      const ms = msUntilNextChicagoMidnight();
      if (midnightTimer.current) window.clearTimeout(midnightTimer.current);
      midnightTimer.current = window.setTimeout(async () => {
        await ensureTodayDay(userId);
        const newKey = localDateKey();
        setDayKey(newKey);
        const { data: todayDay, error } = await supabase
          .from('days').select('id, date, targets, totals')
          .eq('user_id', userId).eq('date', newKey).maybeSingle();
        logSb('midnight:fetch new day', error, { userId, newKey });
        if (!error && todayDay) { setDay(todayDay as DayRow); setDayId((todayDay as DayRow).id); }
        setMeals([]); setWoSuggestions([]);
        await loadWorkouts(userId, newKey);
        schedule();
      }, ms) as unknown as number;
    };
    schedule();
    return () => { if (midnightTimer.current) window.clearTimeout(midnightTimer.current); };
  }, [userId]);

  // Recalc broadcasts
  useEffect(() => {
    const onTotals = (payload: { dayId: string; totals: any }) => {
      setDay(prev => (prev && prev.id === payload.dayId) ? { ...prev, totals: payload.totals } : prev);
    };
    const unsubs = [
      eventBus.on('day:totals', onTotals),
      eventBus.on('meal:upsert', onTotals),
      eventBus.on('meal:delete', onTotals),
      eventBus.on('workout:upsert', onTotals),
      eventBus.on('workout:delete', onTotals),
    ];
    return () => { unsubs.forEach(fn => { try { fn?.(); } catch {} }); };
  }, []);

  // Sync local currentGoal if parent changes
  useEffect(() => {
  // Guard: don't clobber the pill if today's row/props have no targets yet
  if (!targets || Number(targets.calories || 0) <= 0) return;

  setCurrentGoal(targets);
  const lbl = (targets as any)?.label; if (lbl) setGoalLabel(String(lbl).toUpperCase());
  const why = String((targets as any)?.rationale || '') || '';
  setGoalRationale(why || null);
  setQCalories(targets.calories ?? 0); setQProtein(targets.protein ?? 0);
  setQCarbs(targets.carbs ?? 0); setQFat(targets.fat ?? 0);
  setQLabel(String((targets as any)?.label || '')); setQWhy(why);
  persistTargetsLocally({
    calories: targets.calories ?? 0, protein: targets.protein ?? 0, carbs: targets.carbs ?? 0, fat: targets.fat ?? 0,
    label: (targets as any)?.label || null, rationale: why || null,
  });
}, [targets]);


  // Totals from meals
  const totalsFromMeals: MacroSet = useMemo(
    () => meals.reduce((acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein:  acc.protein  + (m.protein  || 0),
      carbs:    acc.carbs    + (m.carbs    || 0),
      fat:      acc.fat      + (m.fat      || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }),
    [meals]
  );

  // Live preview totals (meals)
  const totalsWithPreview: MacroSet = useMemo(() => {
    if (!previewMeal) return totalsFromMeals;
    return {
      calories: totalsFromMeals.calories + (previewMeal.calories || 0),
      protein:  totalsFromMeals.protein  + (previewMeal.protein  || 0),
      carbs:    totalsFromMeals.carbs    + (previewMeal.carbs    || 0),
      fat:      totalsFromMeals.fat      + (previewMeal.fat      || 0),
    };
  }, [totalsFromMeals, previewMeal]);

  const persistedAllowance  = day?.totals?.allowance ?? (currentGoal?.calories || 0);
  const persistedRemaining  = day?.totals?.remaining ?? (currentGoal?.calories || 0);
  const previewWorkoutDelta = previewWorkoutKcal > 0 ? previewWorkoutKcal : 0;
  const dailyAllowance = Math.max(0, Math.round(persistedAllowance + previewWorkoutDelta));
  const remainingCalories = Math.round((persistedRemaining + previewWorkoutDelta) - (previewMeal?.calories || 0));

  // Scaled macro goals
  const scaledProteinGoal = useMemo(() => {
    const base = currentGoal?.protein || 0, baseCal = currentGoal?.calories || 0;
    if (baseCal <= 0) return base; return Math.round(base * (dailyAllowance / baseCal));
  }, [currentGoal, dailyAllowance]);
  const scaledCarbGoal = useMemo(() => {
    const base = currentGoal?.carbs || 0, baseCal = currentGoal?.calories || 0;
    if (baseCal <= 0) return base; return Math.round(base * (dailyAllowance / baseCal));
  }, [currentGoal, dailyAllowance]);
  const scaledFatGoal = useMemo(() => {
    const base = currentGoal?.fat || 0, baseCal = currentGoal?.calories || 0;
    if (baseCal <= 0) return base; return Math.round(base * (dailyAllowance / baseCal));
  }, [currentGoal, dailyAllowance]);

  const remainingProtein = Math.max(0, scaledProteinGoal - totalsWithPreview.protein);
  const remainingCarbs   = Math.max(0, scaledCarbGoal   - totalsWithPreview.carbs);
  const remainingFat     = Math.max(0, scaledFatGoal    - totalsWithPreview.fat);

  // Debounced live previews
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
      } catch { setPreviewMeal(null); }
    }, 800);
    return () => { if (mealTimer.current) window.clearTimeout(mealTimer.current); };
  }, [mealText, profile]);

  useEffect(() => {
    if (woTimer.current) window.clearTimeout(woTimer.current);
    if (!workoutText.trim()) { setPreviewWorkoutKcal(0); return; }
    woTimer.current = window.setTimeout(async () => {
      try {
        const kcal = await estimateWorkoutKcalSmart(workoutText.trim(), profile);
        setPreviewWorkoutKcal(kcal);
      } catch { setPreviewWorkoutKcal(0); }
    }, 800);
    return () => { if (woTimer.current) window.clearTimeout(woTimer.current); };
  }, [workoutText, profile]);

  // ---- Actions ----
  async function addMealFromEstimate() {
    if (!mealText.trim() || !userId || !dayId) return;
    setBusy(true);
    try {
      const res = await estimateMacrosForMeal(mealText.trim(), profile);
      await upsertFoodEntry({
        userId, dayId, name: mealText.trim(),
        calories: Math.round(res.macros.calories || 0),
        protein:  Math.round(res.macros.protein  || 0),
        carbs:    Math.round(res.macros.carbs    || 0),
        fat:      Math.round(res.macros.fat      || 0),
        meta: { source: 'ai_estimate' },
      });
      await loadFoods(userId, dayKey);
      setMealText(''); setPreviewMeal(null);
      const { data: d } = await supabase.from('days').select('id, totals').eq('id', dayId).maybeSingle();
      if (d) setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);
    } catch (e: any) {
      openCoaching(e?.message || 'Could not estimate/add meal.');
    } finally { setBusy(false); }
  }

  // Remove a meal row and refresh today's totals
async function deleteFoodLocal(id: string) {
  if (!userId || !dayId) return;
  setBusy(true);
  try {
    // delete from DB
    await deleteFoodEntry({ id, userId });

    // refresh meals list
    await loadFoods(userId, dayKey);

    // refresh day totals so allowance/remaining update
    const { data: d } = await supabase
      .from('days')
      .select('id, totals')
      .eq('id', dayId)
      .maybeSingle();

    if (d) {
      setDay(prev => (prev ? { ...prev, totals: (d as any).totals } : prev));
      try {
        // let other views react (if they listen)
        eventBus.emit('day:totals', { dayId, totals: (d as any).totals });

      } catch {}
    }

    showToast('Meal removed.');
  } catch (e: any) {
    alert(e?.message || 'Could not remove meal.');
  } finally {
    setBusy(false);
  }
}

  async function addWorkout() {
  if (!workoutText.trim() || !userId || !dayId) return;
  setBusy(true);
  try {
    const kcal = await estimateWorkoutKcalSmart(workoutText.trim(), profile);

    // ⬅️ NEW: optimistic UI update
    applyOptimisticWorkoutDelta(kcal);

    await upsertWorkoutEntry({ userId, dayId, kind: workoutText.trim(), calories: kcal, meta: { source: 'ai_estimate' } });
    setWorkoutText(''); setPreviewWorkoutKcal(0);
    showToast(`Added +${kcal} kcal to allowance`);
    await loadWorkouts(userId, dayKey);

    const { data: d } = await supabase.from('days').select('id, totals').eq('id', dayId).maybeSingle();
    if (d) {
      setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);

      // ⬅️ NEW: broadcast with payload so other listeners get the fresh totals
      try { eventBus.emit('day:totals', { dayId, totals: (d as any).totals }); } catch {}
    }
  } catch (e: any) {
    openCoaching(e?.message || 'Could not estimate workout burn.');
  } finally { setBusy(false); }
}


  function startEditWorkout(w: WorkoutRow) {
    setEditWoId(w.id); setEditWoKind(w.kind); setEditWoKcal(w.calories); setEditWoOpen(true);
  }
  async function estimateEditWorkoutKcal() {
    if (!editWoKind.trim()) return;
    setBusy(true);
    try { const kcal = await estimateWorkoutKcalSmart(editWoKind.trim(), profile); setEditWoKcal(kcal); showToast(`Estimated ~${kcal} kcal`); }
    finally { setBusy(false); }
  }
  
async function saveEditWorkout() {
  if (!userId || !dayId || !editWoId) return;
  setBusy(true);
  try {
    const oldKcal = Number(editWoKcal || 0);
    const aiKcal = await estimateWorkoutKcalSmart(editWoKind.trim(), profile);
    setEditWoKcal(aiKcal);

    // ⬅️ NEW: optimistic delta (new - old)
    applyOptimisticWorkoutDelta(Math.max(0, aiKcal) - Math.max(0, oldKcal));

    await upsertWorkoutEntry({
      id: editWoId, userId, dayId,
      kind: editWoKind.trim(),
      calories: Math.max(0, aiKcal),
      meta: { source: 'manual_edit_ai_estimated' }
    });

    await loadWorkouts(userId, dayKey);
    const { data: d } = await supabase.from('days').select('id, totals').eq('id', dayId).maybeSingle();
    if (d) {
      setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);
      try { eventBus.emit('day:totals', { dayId, totals: (d as any).totals }); } catch {}
    }
    setEditWoOpen(false); showToast(`Saved with AI-estimated ${aiKcal} kcal`);
  } finally { setBusy(false); }
}


  function cancelEditWorkout() { setEditWoOpen(false); setEditWoId(null); }
  async function removeWorkout(id: string) {
  if (!userId || !dayId) return;

  // ⬅️ NEW: find kcal of the row being removed to compute delta
  const row = workouts.find(w => w.id === id);
  const kcal = row ? Math.max(0, Number(row.calories || 0)) : 0;

  // ⬅️ NEW: optimistic decrease
  if (kcal) applyOptimisticWorkoutDelta(-kcal);

  await deleteWorkoutEntry({ id, userId, dayId });
  await loadWorkouts(userId, dayKey);

  const { data: d } = await supabase.from('days').select('id, totals').eq('id', dayId).maybeSingle();
  if (d) {
    setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);
    try { eventBus.emit('day:totals', { dayId, totals: (d as any).totals }); } catch {}
  }
}


  async function suggestSwap() {
    try {
      setBusy(true);
      const tip = await getSwapSuggestion({
        calories: Math.max(0, remainingCalories),
        protein: remainingProtein, carbs: remainingCarbs, fat: remainingFat,
      });
      setSwap(tip);
    } catch { setSwap('Could not fetch swap suggestion.'); }
    finally { setBusy(false); }
  }

  async function suggestWorkoutForRow(seedTitle: string, rowId: string) {
    if (!profile) return;
    setBusy(true); setSuggestForId(rowId); setSuggestForTitle(seedTitle); setWoSuggestions([]); setSuggestOpen(true);
    try {
      const base = seedTitle.toLowerCase();
      const isCardio = /\b(run|jog|walk|row|cycle|bike|elliptical|stair|swim|treadmill|rowing|cycling|hike)\b/.test(base);
      const isStrength = /\b(weight|lift|strength|push|pull|squat|deadlift|bench|press|clean|snatch|curl|lunge|row)\b/.test(base);
      const durMatch = base.match(/(\d{2,3})\s*(?:min|mins|minute|minutes)/);
      const minutes = durMatch ? Math.max(10, Math.min(120, parseInt(durMatch[1], 10))) : 30;
      const candidates = isCardio && !isStrength ? [
        `${minutes} min brisk walk`, `${Math.round(minutes * 0.8)} min interval run (hard/easy)`,
        `${minutes} min rowing steady`, `${minutes} min cycling moderate`,
      ] : isStrength && !isCardio ? [
        `${minutes} min full-body compound lifts`, `${minutes} min push/pull superset session`,
        `${minutes} min strength training moderate`, `${minutes} min kettlebell circuit`,
      ] : [
        `${minutes} min jog easy-moderate`, `${minutes} min kettlebell circuit`, `${minutes} min weight training moderate`,
      ];
      const scored: Array<{ title: string; kcal: number }> = [];
      for (const c of candidates) { try { scored.push({ title: c, kcal: await estimateWorkoutKcalSmart(c, profile) }); } catch {} }
      setWoSuggestions(scored);
    } finally { setBusy(false); }
  }
 
  async function addSuggestedWorkout(title: string, kcal: number) {
  if (!userId || !dayId) return;
  setBusy(true);
  try {
    const k = Math.max(0, Math.round(kcal || 0));

    // ⬅️ NEW: optimistic bump
    applyOptimisticWorkoutDelta(k);

    await upsertWorkoutEntry({ userId, dayId, kind: title, calories: k, meta: { source: 'ai_suggestion' } });
    await loadWorkouts(userId, dayKey);

    const { data: d } = await supabase.from('days').select('id, totals').eq('id', dayId).maybeSingle();
    if (d) {
      setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);
      try { eventBus.emit('day:totals', { dayId, totals: (d as any).totals }); } catch {}
    }
    showToast(`Added: ${title} (+${k} kcal)`); setSuggestOpen(false);
  } finally { setBusy(false); }
}


  async function coachMealRow(m: MealRow) {
    try {
      const before = {
        calories: Math.max(0, (currentGoal?.calories || 0) - ((totalsFromMeals.calories - (m.calories || 0)))),
        protein:  Math.max(0, (currentGoal?.protein  || 0) - ((totalsFromMeals.protein  - (m.protein  || 0)))),
        carbs:    Math.max(0, (currentGoal?.carbs    || 0) - ((totalsFromMeals.carbs    - (m.carbs    || 0)))),
        fat:      Math.max(0, (currentGoal?.fat      || 0) - ((totalsFromMeals.fat      - (m.fat      || 0)))),
      };
      const title = (m.meal_summary || m.name || '').toString();
      const coaching = await getMealCoaching(title, profile, before, currentGoal);
      const suggestionLines = (coaching?.suggestions || []).filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim());
      const altLines = (coaching?.better_alternatives || [])
        .map((a: any) => (a && a.item && a.why ? `Try: ${a.item} — ${a.why}` : ''))
        .filter(Boolean);
      const lines = [...suggestionLines, ...altLines];
      openCoaching(lines.length ? lines.join('\n• ') : 'No suggestions.');
    } catch (e: any) { openCoaching(e?.message || 'Could not fetch coaching tips.'); }
  }

  function openCoaching(text: string) { setCoachText(text || 'Could not fetch coaching tips.'); setCoachOpen(true); }
  function openQuickEdit() {
    setQCalories(currentGoal?.calories || 0); setQProtein(currentGoal?.protein || 0);
    setQCarbs(currentGoal?.carbs || 0); setQFat(currentGoal?.fat || 0);
    setQLabel(String(goalLabel || '')); setQWhy(String(goalRationale || (targets as any)?.rationale || ''));
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
      await supabase.from('user_targets').upsert({
        user_id: userId, calories: payload.calories, protein: payload.protein, carbs: payload.carbs, fat: payload.fat,
        label: payload.label || null, rationale: payload.rationale || null, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      const { data: d } = await supabase.from('days').select('id').eq('user_id', userId).eq('date', localDateKey()).maybeSingle();
      if ((d as any)?.id) {
        await supabase.from('days').update({ targets: payload, updated_at: new Date().toISOString() }).eq('id', (d as any).id);
        setDay(prev => prev ? { ...prev, targets: payload } : prev);
      }
      setCurrentGoal({ calories: payload.calories, protein: payload.protein, carbs: payload.carbs, fat: payload.fat });
      setGoalLabel(payload.label || null); setGoalRationale(payload.rationale || null);
      eventBus.emit('targets:update', payload); persistTargetsLocally(payload);
      setQuickOpen(false); showToast('Your targets have been saved.');
    } catch (e: any) { console.error(e); alert(e?.message || 'Could not save targets.'); }
  }

  if (loading) return <div className="text-gray-900 dark:text-gray-100">Loading…</div>;

  return (
    <div className="min-h-screen w-full bg-white dark:bg-neutral-950 text-gray-900 dark:text-neutral-100">
      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 top-4 -translate-x-1/2 z-50">
          <div className="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2 shadow-lg">{toast}</div>
        </div>
      )}

      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-3xl px-4 pb-10 pt-4">
        {/* Header + greeting */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold">Today</h1>
            <span className="text-sm text-neutral-600 dark:text-neutral-300 mt-1">
              Good {greeting}{userName ? `, ${toFirstName(userName)}` : ''} — {phrase}
            </span>
          </div>
          <button
            onClick={openQuickEdit}
            className="text-sm font-medium rounded-lg px-3 py-1.5 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            Edit Targets
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 mb-4">
          <SummaryPill
  label="Current target"
  value={
    currentGoal?.calories
      ? `${currentGoal.calories} kcal`
      : // fallback to whatever you computed from AI/macros if present
        (macroTargets?.calories ? `${macroTargets.calories} kcal` : '—')
  }
/>

          <SummaryPill label="Exercise added" value={`${Math.round(day?.totals?.workoutCals ?? 0)} kcal`} />
          <SummaryPill label="Daily allowance" value={`${Math.round(dailyAllowance)} kcal`} />
        </div>

        {/* Macro meters */}
        {/* Macro meters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <MacroMeter title="Calories" used={totalsWithPreview.calories} goal={dailyAllowance} unit="kcal" />
          <MacroMeter title="Protein"  used={totalsWithPreview.protein}  goal={scaledProteinGoal}  unit="g" />
          <MacroMeter title="Carbs"    used={totalsWithPreview.carbs}    goal={scaledCarbGoal}    unit="g" />
          <MacroMeter title="Fat"      used={totalsWithPreview.fat}      goal={scaledFatGoal}      unit="g" />
        </div>


        {/* Food input */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-3 bg-white dark:bg-neutral-900 mb-4">
          <label className="text-sm font-medium">Log a meal
            <span className="ml-1 text-[11px] text-neutral-500">— be as specific as possible (ingredients, amounts, cooking method)</span>
          </label>
          <textarea
            className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
            rows={3}
            placeholder="e.g., 1 bowl oatmeal (60g oats) with 200ml 2% milk + 1 banana; 2 eggs in 1 tsp olive oil"
            value={mealText} onChange={(e) => setMealText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={addMealFromEstimate} disabled={busy || !mealText.trim()} className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black disabled:opacity-60">AI Coach: Estimate & add</button>
            <button onClick={suggestSwap} disabled={busy} className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800">AI Coach: Quick swap</button>
            <button
              onClick={() => { const name = prompt('Name this meal to reuse later:'); if (name && name.trim()) saveCurrentEstimateAsMeal(name.trim()); }}
              disabled={busy || !previewMeal}
              className="rounded-xl px-3 py-2 text-sm bg-indigo-600 text-white dark:bg-indigo-500 disabled:opacity-60"
              title="Save the current AI estimate as a reusable meal"
            >
              Save meal for future use
            </button>
            {swap && <div className="text-sm text-neutral-800 dark:text-neutral-200">• {swap}</div>}
          </div>
          {previewMeal && (
            <div className="text-xs text-neutral-600 dark:text-neutral-300">
              Preview impact: −{previewMeal.calories} kcal, −{previewMeal.protein}P, −{previewMeal.carbs}C, −{previewMeal.fat}F
            </div>
          )}
          {/* Saved meals dropdown */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Saved meals</label>
            <button
              type="button"
              className="text-[11px] px-2 py-0.5 rounded border border-neutral-200 dark:border-neutral-800"
              onClick={() => setManageSavedOpen(true)}
              title="Edit or delete saved meals"
            >
              Manage
            </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-sm p-2"
                defaultValue=""
                onChange={(e) => {
                const id = e.target.value; if (!id) return;
                const item = savedMeals.find((m) => m.id === id); if (item) addSavedMealToToday(item);
                e.currentTarget.value = '';
                }}

                
              >
                <option value="" disabled>Choose a saved meal…</option>
                {savedMeals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <span className="text-xs text-neutral-500">Selecting will add it to today</span>
            </div>
          </div>
        </div>

        {/* Meals table */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-x-auto bg-white dark:bg-neutral-900">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-neutral-100 dark:bg-neutral-800 text-left">
                <th className="p-2">Meal</th><th className="p-2">Cal</th><th className="p-2">P</th><th className="p-2">C</th><th className="p-2">F</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {meals.map((m) => (
                <tr key={m.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="p-2 align-top">{m.meal_summary || m.name}</td>
                  <td className="p-2">{m.calories}</td>
                  <td className="p-2">{m.protein ?? '—'}</td>
                  <td className="p-2">{m.carbs ?? '—'}</td>
                  <td className="p-2">{m.fat ?? '—'}</td>
                  <td className="p-2 flex gap-2">
                    <button className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800" onClick={() => coachMealRow(m)}>AI Coach: Suggest Alternative</button>
                    <button className="px-2 py-1 rounded-lg bg-red-600 text-white dark:bg-red-500" onClick={() => deleteFoodLocal(m.id)}>Remove</button>
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

        {/* 🟣 Add Workout section (button relocated here) */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-3 bg-white dark:bg-neutral-900 mt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Add workout</div>
            <div className="flex items-center gap-2">
              {currentPlan?.plan ? (
                <button className="text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1" onClick={() => setViewPlanOpen(true)}>
                  View plan
                </button>
              ) : null}
              <button
                className="text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1"
                onClick={() => (onOpenPlanner ? onOpenPlanner() : setPlanOpen(true))}

                title="Have the AI plan your week"
              >
                Plan my week
              </button>
            </div>
          </div>

          <input
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
            value={workoutText}
            onChange={(e) => setWorkoutText(e.target.value)}
            placeholder="e.g., 30 min interval run (hard/easy) or 5x5 squats 185lb + 3x12 bench 135lb"
          />

          {previewWorkoutKcal > 0 && (
            <div className="text-xs text-neutral-600 dark:text-neutral-300">
              Estimated burn preview: +{previewWorkoutKcal} kcal
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={addWorkout} disabled={busy || !workoutText.trim()} className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black disabled:opacity-60">
              Add workout (AI calories)
            </button>
            {currentPlan?.plan ? (
              <button
                onClick={() => setViewPlanOpen(true)}
                className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800"
                title="Pick one of your planned workouts to add (Step 3 will wire this insertion)"
              >
                Add from plan (Step 3)
              </button>
            ) : null}
          </div>
        </div>

        {/* Workouts table */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-x-auto bg-white dark:bg-neutral-900 mt-4">
          <div className="px-3 pt-3 text-sm font-semibold">Workouts</div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-neutral-100 dark:bg-neutral-800 text-left">
                <th className="p-2">Workout</th>
                <th className="p-2">Burn (kcal)</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {workouts.map((w) => (
                <tr key={w.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="p-2">{w.kind}</td>
                  <td className="p-2">{w.calories}</td>
                  <td className="p-2 flex gap-2">
                    <button className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800" onClick={() => startEditWorkout(w)}>Edit</button>
                    <button className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800" onClick={() => suggestWorkoutForRow(w.kind, w.id)}>Suggest workout</button>
                    <button className="px-2 py-1 rounded-lg bg-red-600 text-white dark:bg-red-500" onClick={() => removeWorkout(w.id)}>Remove</button>
                  </td>
                </tr>
              ))}
              {workouts.length === 0 && (
                <tr>
                  <td className="p-2 text-neutral-500 dark:text-neutral-400" colSpan={3}>No workouts logged yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Coaching modal */}
        <Modal isOpen={coachOpen} onClose={() => setCoachOpen(false)} title="AI Coach Suggestions">
          <div>{coachText ? `• ${coachText}` : 'No suggestions.'}</div>
        </Modal>

        {/* Edit Workout modal */}
        <Modal isOpen={editWoOpen} onClose={cancelEditWorkout} title="Edit workout">
          <div className="space-y-3">
            <div>
              <div className="text-xs text-neutral-500 mb-1">
                Workout <span className="ml-1 text-[11px]">— include duration, intensity, distance, sets/reps/weight</span>
              </div>
              <input
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
                value={editWoKind}
                onChange={(e) => setEditWoKind(e.target.value)}
                placeholder="e.g., 30 min interval run (hard/easy); or 5x5 squats 185lb + 3x12 bench 135lb"
              />
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-1">Estimated burn (kcal)</div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{Number.isFinite(editWoKcal) ? editWoKcal : 0}</div>
                <button onClick={estimateEditWorkoutKcal} className="px-2 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-sm" type="button">
                  Estimate calories
                </button>
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">AI will re-estimate automatically when you press Save.</div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={saveEditWorkout} className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black" disabled={busy || !editWoKind.trim()}>Save</button>
              <button onClick={cancelEditWorkout} className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800">Cancel</button>
            </div>
          </div>
        </Modal>

        {/* Suggest workout modal */}
        <Modal isOpen={suggestOpen} onClose={() => setSuggestOpen(false)} title="Suggest workout">
          <div className="space-y-2 text-sm">
            {suggestForTitle && <div className="text-neutral-600 dark:text-neutral-300">Based on: <span className="font-medium">{suggestForTitle}</span></div>}
            {woSuggestions.length === 0 ? (
              <div className="text-neutral-500 dark:text-neutral-400">Finding options…</div>
            ) : (
              <ul className="space-y-1">
                {woSuggestions.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span>{s.title} — {s.kcal} kcal</span>
                    <button className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800" onClick={() => addSuggestedWorkout(s.title, s.kcal)}>Use</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>


        {/* Manage Saved Meals modal */}
<Modal isOpen={manageSavedOpen} onClose={() => setManageSavedOpen(false)} title="Manage saved meals">
  <div className="space-y-3 text-sm">
    {savedMeals.length === 0 ? (
      <div className="text-neutral-500 dark:text-neutral-400">No saved meals yet.</div>
    ) : (
      <ul className="space-y-2">
        {savedMeals.map((m) => {
          const payload = m.payload || {};
          const macros = payload.macros || payload;
          const desc = payload.description || payload.name || m.name || '';
          const kcal = Math.round(Number(macros?.calories ?? 0)) || '—';
          return (
            <li key={m.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate max-w-[42ch]">
                    {desc} {kcal !== '—' ? `• ${kcal} kcal` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800"
                    onClick={() => {
                      setEditMealId(m.id);
                      setEditName(String(m.name || ''));
                      setEditDesc(String(desc || ''));
                      setEditCals(typeof macros?.calories === 'number' ? Math.round(macros.calories) : '');
                      setEditProt(typeof macros?.protein  === 'number' ? Math.round(macros.protein)  : '');
                      setEditCarb(typeof macros?.carbs    === 'number' ? Math.round(macros.carbs)    : '');
                      setEditFat(typeof macros?.fat      === 'number' ? Math.round(macros.fat)      : '');
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="px-2 py-1 rounded-lg bg-red-600 text-white dark:bg-red-500"
                    onClick={async () => {
                      if (!confirm('Delete this saved meal?')) return;
                      const { data: auth } = await supabase.auth.getUser();
                      const uid = auth?.user?.id;
                      if (!uid) return;
                      const { error } = await supabase.from('saved_meals').delete().eq('id', m.id).eq('user_id', uid);
                      if (!error) setSavedMeals((prev) => prev.filter((x) => x.id !== m.id));
                      else alert(error.message || 'Could not delete.');
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {editMealId === m.id && (
                <div className="mt-2 space-y-2">
                  <input
                    className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
                    value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name"
                  />
                  <textarea
                    className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
                    rows={2}
                    value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Description shown when adding"
                  />
                  <div className="grid grid-cols-4 gap-2">
                    <input className="rounded-lg border p-2 text-sm bg-white dark:bg-neutral-900" type="number" min={0}
                      value={editCals} onChange={(e) => setEditCals(e.target.value === '' ? '' : Number(e.target.value))} placeholder="kcal" />
                    <input className="rounded-lg border p-2 text-sm bg-white dark:bg-neutral-900" type="number" min={0}
                      value={editProt} onChange={(e) => setEditProt(e.target.value === '' ? '' : Number(e.target.value))} placeholder="P" />
                    <input className="rounded-lg border p-2 text-sm bg-white dark:bg-neutral-900" type="number" min={0}
                      value={editCarb} onChange={(e) => setEditCarb(e.target.value === '' ? '' : Number(e.target.value))} placeholder="C" />
                    <input className="rounded-lg border p-2 text-sm bg-white dark:bg-neutral-900" type="number" min={0}
                      value={editFat} onChange={(e) => setEditFat(e.target.value === '' ? '' : Number(e.target.value))} placeholder="F" />
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-2 rounded-lg bg-black text-white dark:bg-white dark:text-black text-sm"
                      onClick={async () => {
                        const { data: auth } = await supabase.auth.getUser();
                        const uid = auth?.user?.id;
                        if (!uid || !editMealId) return;

                        // If kcal blank but description present, try to re-estimate
                        let kcal = editCals === '' ? 0 : Number(editCals || 0);
                        let p = editProt === '' ? 0 : Number(editProt || 0);
                        let c = editCarb === '' ? 0 : Number(editCarb || 0);
                        let f = editFat === '' ? 0 : Number(editFat || 0);

                        if (!(kcal > 0) && editDesc.trim()) {
                          try {
                            const est = await estimateMacrosForMeal(editDesc.trim(), profile);
                            kcal = Math.round(est.macros.calories || 0);
                            p = Math.round(est.macros.protein || 0);
                            c = Math.round(est.macros.carbs || 0);
                            f = Math.round(est.macros.fat || 0);
                          } catch {}
                        }

                        const payload = {
                          name: editName || 'Saved meal',
                          description: editDesc || '',
                          macros: { calories: Math.max(0, kcal), protein: Math.max(0, p), carbs: Math.max(0, c), fat: Math.max(0, f) },
                        };

                        const { data, error } = await supabase
                          .from('saved_meals')
                          .update({ name: editName, payload, updated_at: new Date().toISOString() })
                          .eq('id', editMealId)
                          .eq('user_id', uid)
                          .select('id, name, payload, created_at')
                          .single();

                        if (error) return alert(error.message || 'Could not save changes.');
                        // update local list
                        setSavedMeals((prev) => prev.map((x) => (x.id === editMealId ? (data as any) : x)));
                        setEditMealId(null);
                        showToast('Saved meal updated.');
                      }}
                    >
                      Save changes
                    </button>
                    <button className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-sm"
                      onClick={() => setEditMealId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    )}
  </div>
</Modal>


        {/* 🟣 Planner: Generate modal */}
        <Modal isOpen={planOpen} onClose={() => setPlanOpen(false)} title="Plan your week">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col text-sm">Style
                <select className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-10 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-10" value={styleSel} onChange={e=>setStyleSel(e.target.value as any)}>
                  <option>HIIT</option><option>cardio</option><option>strength+cardio</option><option>CrossFit</option>
                </select>
              </label>
              <label className="flex flex-col text-sm">Goal
                <select className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-10" value={goalSel} onChange={e=>setGoalSel(e.target.value as any)}>
                  <option>cut</option><option>lean</option><option>maintain</option><option>bulk</option><option value="recomp">recomp</option><option>combat</option><option>lifestyle</option>
                </select>
              </label>
              <label className="flex flex-col text-sm">Minutes per session
                <input type="number" className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-10" min={15} max={120} value={minutes}
                  onChange={e=>setMinutes(Math.max(15, Math.min(120, parseInt(e.target.value || '30', 10))))} />
              </label>
              <label className="flex flex-col text-sm">Experience
                <select className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-10" value={experience} onChange={e=>setExperience(e.target.value as any)}>
                  <option>beginner</option><option>intermediate</option><option>advanced</option>
                </select>
              </label>
              <label className="col-span-2 flex flex-col text-sm">Equipment (comma-separated)
                <input className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-10" value={equipmentInput} onChange={e=>setEquipmentInput(e.target.value)}
                  placeholder="assault bike, kettlebell, dumbbells, barbell" />
              </label>
              <div className="col-span-2">
                <div className="text-sm mb-1">Available days</div>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map(d => (
                    <button key={d} type="button" onClick={() => toggleDay(d)}
                      className={`px-3 py-1 rounded-full border ${daysSel.includes(d) ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button className="px-4 py-2 rounded-xl border" onClick={() => setPlanOpen(false)}>Close</button>
              <button className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-60" disabled={busy || daysSel.length === 0} onClick={handleGeneratePlan}>
                {busy ? 'Generating…' : 'Generate plan'}
              </button>
            </div>
          </div>
        </Modal>

        {/* 🟣 Planner: View modal — detailed tables */}
        <Modal isOpen={viewPlanOpen} onClose={() => setViewPlanOpen(false)} title="Your weekly plan">
          {!currentPlan?.plan ? (
            <div className="text-sm text-neutral-600">No plan yet. Click “Plan my week”.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    {currentPlan.plan.style} ({currentPlan.plan.minutesPerSession} min) — {currentPlan.plan.goal}
                  </div>
                  <div className="text-xs text-neutral-600 dark:text-neutral-300">{currentPlan.plan.benefits}</div>
                  <div className="text-xs text-neutral-500 mt-1">Week of {currentPlan.plan.weekOf}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1" onClick={() => setPlanOpen(true)}>Regenerate</button>
                  <button className="text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1" onClick={clearPlan}>Clear</button>
                </div>
              </div>

              {(currentPlan.plan.sessions ?? []).map((s: any) => (
                <div key={s.day} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">{s.day}: {s.title}</div>
                    <div className="text-xs opacity-80">~{s.estCalories ?? '—'} kcal</div>
                  </div>
                  <div className="overflow-x-auto mt-2">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left">
                          <th className="p-1">Activity</th>
                          <th className="p-1 w-24">Minutes</th>
                          <th className="p-1">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(s.blocks ?? []).map((b: any, i: number) => (
                          <tr key={i} className="border-t border-neutral-200 dark:border-neutral-800">
                            <td className="p-1">{b.activity}</td>
                            <td className="p-1">{b.minutes}</td>
                            <td className="p-1">{b.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Step 3: hook to add this session to today */}
                  {/* <div className="mt-2">
                    <button className="text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1">Add to today</button>
                  </div> */}
                </div>
              ))}
            </div>
          )}
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
function MacroMeter({ title, used, goal, unit }: { title: string; used: number; goal: number; unit: string }) {
  const hasGoal = Number(goal) > 0;
  const pct = hasGoal ? Math.max(0, Math.min(100, (used / goal) * 100)) : 0;
  const goalLabel = hasGoal ? Math.round(goal).toString() : '—';
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{Math.round(used)} / {goalLabel} {unit}</span>
      </div>
      <div className="h-3 w-full rounded-full bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
        <div className="h-3 rounded-full" style={{ width: `${pct}%`, background: 'currentColor' }} />
      </div>
      <div className="mt-1 text-right text-[11px] text-neutral-500 dark:text-neutral-400">{Math.round(pct)}%</div>
    </div>
  );
}
function MiniCard({ title, rows }: { title: string; rows: [string, string][] }) {
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
function Field({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; }) {
  return (
    <div>
      <div className="text-xs text-neutral-500 mb-1">{label}{suffix ? ` (${suffix})` : ''}</div>
      <input type="number" min={0} className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
        value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value || 0))} />
    </div>
  );
}