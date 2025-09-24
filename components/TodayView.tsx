// components/TodayView.tsx
import { ensureTodayDay } from '../services/dayService';
import { dateKeyChicago, msUntilNextChicagoMidnight, greetingForChicago } from '../lib/dateLocal';

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

// ---- Snapshot to stabilize first paint and prevent flicker ----
const SNAP_KEY = 'tm:lastDaySnapshot';
type DaySnapshot = {
  dayId: string;
  date: string;
  targets: any | null;
  totals: { foodCals: number; workoutCals: number; allowance: number; remaining: number } | null;
  updatedAt: number;
};
function loadSnapshot(): DaySnapshot | null {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSnapshot(s: DaySnapshot) {
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(s)); } catch {}
}


import {
  upsertFoodEntry,
  deleteFoodEntry,
  upsertWorkoutEntry,
  deleteWorkoutEntry,
} from '../services/loggingService';

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

// 🔒 Local storage key for immediate hydration
const LS_TARGETS_KEY = 'aiCoach.currentTargets';

// ---- tiny helper to log Supabase errors consistently ----
function logSb(where: string, error: any, extra?: Record<string, unknown>) {
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[Supabase] ${where}`, { error, ...extra });
  }
}

// ---------- Greeting helpers ----------
async function fetchDisplayName(uid: string): Promise<string> {
  // Try user_profiles first
  let { data, error } = await supabase
    .from('user_profiles')
    .select('full_name, first_name, name, username')
    .eq('user_id', uid)
    .maybeSingle();

  // Fallback: profiles (if you later add it)
  if (error || !data) {
    const res = await supabase
      .from('profiles')
      .select('full_name, first_name, name, username')
      .or(`id.eq.${uid},user_id.eq.${uid}`)
      .maybeSingle();
    data = res.data as any;
  }

  const dn =
    data?.first_name ||
    data?.full_name  ||
    data?.name       ||
    data?.username   ||
    '';
  return dn || 'Friend';
}


function toFirstName(display: string): string {
  const trimmed = (display || '').trim();
  if (!trimmed) return '';
  const first = trimmed.split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// ---- rotating motivational phrases by daypart ----
const PHRASES: Record<'Morning' | 'Afternoon' | 'Evening', string[]> = {
  Morning: [
    "Let’s set the tone today.",
    "Small wins add up—start now.",
    "Own the morning, own the day.",
    "Consistency beats intensity.",
    "Fuel smart, move with intent.",
  ],
  Afternoon: [
    "Keep the momentum going.",
    "Strong choices, strong results.",
    "You’re closer than you think.",
    "Stay locked in—finish strong.",
    "Quality over quantity—always.",
  ],
  Evening: [
    "Finish the day with purpose.",
    "Recovery is part of progress.",
    "One more good choice.",
    "Reflect, reset, and rise again.",
    "Proud of the effort today.",
  ],
};

function pickPhrase(daypart: 'Morning' | 'Afternoon' | 'Evening') {
  const list = PHRASES[daypart] || [];
  if (!list.length) return '';
  // deterministic selection per date + daypart to avoid flicker
  const key = `${dateKeyChicago()}-${daypart}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return list[hash % list.length];
}

/**
 * Smart calorie estimator for workouts:
 * 1) Calls your AI `getWorkoutCalories`.
 * 2) If AI returns 0/NaN, falls back to a MET-based estimate using parsed minutes + activity type.
 */
async function estimateWorkoutKcalSmart(text: string, profile: Profile): Promise<number> {
  // Try AI first
  try {
    const ai = await getWorkoutCalories(text, profile);
    const aiKcal = Math.round(Number(ai?.total_calories ?? 0));
    if (Number.isFinite(aiKcal) && aiKcal > 0) return aiKcal;
  } catch {
    // ignore and try heuristic
  }

  // Heuristic fallback
  const lower = text.toLowerCase();
  // duration
  const durMatch = lower.match(/(\d{1,3})\s*(min|mins|minute|minutes)/);
  const minutes = durMatch ? Math.max(10, Math.min(180, parseInt(durMatch[1], 10))) : 30;

  // intensity
  const intense =
    /\b(intense|hard|vigorous|interval|hiit|sprint)\b/.test(lower) ? 'high' :
    /\b(moderate|tempo|threshold)\b/.test(lower) ? 'moderate' : 'easy';

  // categorize movement
  const isRun = /\b(run|jog)\b/.test(lower);
  const isWalk = /\bwalk\b/.test(lower);
  const isRide = /\b(cycle|bike|biking|cycling|spin)\b/.test(lower);
  const isRow = /\b(row|rowing|erg)\b/.test(lower);
  const isSwim = /\b(swim|laps)\b/.test(lower);
  const isLift =
    /\b(weight|lift|strength|deadlift|squat|bench|press|clean|snatch|curl|push|pull|db|barbell|kettlebell)\b/.test(lower);

  // MET table (very rough)
  const METS = {
    walk_easy: 3.5,
    run_easy: 7.0,
    run_high: 9.8,
    ride_moderate: 7.5,
    row_moderate: 7.0,
    swim_moderate: 8.0,
    lift_easy: 3.5,
    lift_moderate: 6.0,
    misc_moderate: 5.0,
  };

  let met = METS.misc_moderate;
  if (isWalk) met = METS.walk_easy;
  else if (isRun) met = intense === 'high' ? METS.run_high : METS.run_easy;
  else if (isRide) met = METS.ride_moderate;
  else if (isRow) met = METS.row_moderate;
  else if (isSwim) met = METS.swim_moderate;
  else if (isLift) met = intense === 'high' ? METS.lift_moderate : METS.lift_easy;

  const kg = Math.max(40, Math.min(200, (profile?.weight_lbs ?? 180) * 0.45359237)); // assume 180 lb if unknown
  const kcal = Math.round((met * 3.5 * kg / 200) * minutes);
  return Math.max(0, kcal);
}

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

  // today's Chicago date key
  const [dayKey, setDayKey] = useState<string>(''); // YYYY-MM-DD

  // today's `days` row
  const [day, setDay] = useState<DayRow | null>(null);
  const [dayId, setDayId] = useState<string | null>(null);

  const [mealText, setMealText] = useState('');
  const [workoutText, setWorkoutText] = useState('');
  const [meals, setMeals] = useState<MealRow[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  // NEW: hydration guard and totals coalescer
  const booted = useRef(false);
  const [hydrated, setHydrated] = useState(false);
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
      const t = pendingTotals.current;
      pendingTotals.current = null;
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

  // Workouts: edit modal state (AI-only calories)
  const [editWoOpen, setEditWoOpen] = useState(false);
  const [editWoId, setEditWoId] = useState<string | null>(null);
  const [editWoKind, setEditWoKind] = useState<string>('');
  const [editWoKcal, setEditWoKcal] = useState<number>(0); // read-only display

  // Per-row suggestions modal
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestForId, setSuggestForId] = useState<string | null>(null);
  const [suggestForTitle, setSuggestForTitle] = useState<string>('');
  const [woSuggestions, setWoSuggestions] = useState<Array<{ title: string; kcal: number }>>([]);

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
  const [goalRationale, setGoalRationale] = useState<string | null>(String((targets as any)?.rationale || '') || null);

  // Live preview (debounced) while typing
  const [previewMeal, setPreviewMeal] = useState<MacroSet | null>(null);
  const [previewWorkoutKcal, setPreviewWorkoutKcal] = useState<number>(0);
  const mealTimer = useRef<number | null>(null);
  const woTimer = useRef<number | null>(null);

  // midnight timer
  const midnightTimer = useRef<number | null>(null);

  // Personalized greeting
  const [greeting, setGreeting] = useState<'Morning' | 'Afternoon' | 'Evening'>(greetingForChicago());
  const [phrase, setPhrase] = useState<string>(pickPhrase(greeting));
  const [userName, setUserName] = useState<string>('');

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

  // Load workouts for a day (fixed select columns)
  async function loadWorkouts(uId: string, dateKey: string) {
    const { data, error } = await supabase
      .from('workout_entries')
      .select('id, activity, calories_burned, created_at')
      .eq('user_id', uId)
      .eq('entry_date', dateKey)
      .order('created_at', { ascending: false });
    logSb('loadWorkouts', error, { uId, dateKey });

    setWorkouts(((data as any) || []).map((r: any) => ({
      id: r.id,
      kind: r.activity,
      calories: Math.round(r.calories_burned || 0),
    })));
  }

  // -------- Bootstrap --------
  useEffect(() => {
    if (booted.current) return; booted.current = true;

    (async () => {
      const id = await getCurrentUserId();
      setUserId(id);

      // Fast local fallback to avoid flicker on navigation
      const ls = loadTargetsFromLocal();
      if (ls?.calories) {
        setCurrentGoal({ calories: ls.calories || 0, protein: ls.protein || 0, carbs: ls.carbs || 0, fat: ls.fat || 0 });
        if (ls.label) setGoalLabel(String(ls.label));
        if (ls.rationale) { setGoalRationale(String(ls.rationale)); setQWhy(String(ls.rationale)); }
        setQCalories(ls.calories || 0); setQProtein(ls.protein || 0); setQCarbs(ls.carbs || 0); setQFat(ls.fat || 0);
        setQLabel(String(ls.label || ''));
      }

      console.log('Current User ID:', id);


      // Set Chicago day key
      const todayKey = dateKeyChicago();
      setDayKey(todayKey);
      // Snapshot-first render (if matching date)
      const snap = loadSnapshot();
      if (snap && snap.date === todayKey && snap.dayId) {
        setDay({ id: snap.dayId, date: snap.date, targets: snap.targets, totals: snap.totals } as any);
        setDayId(String(snap.dayId));
        latestTotalsAt.current = snap.updatedAt || 0;
        const t = snap.targets || {};
        setCurrentGoal({ calories: Number(t.calories||0), protein: Number(t.protein||0), carbs: Number(t.carbs||0), fat: Number(t.fat||0) });
        if (t.label) setGoalLabel(String(t.label));
        const why = (t.rationale ? String(t.rationale) : '') || null;
        setGoalRationale(why);
      }


      if (id) {
        // Personalized name
        const dn = await fetchDisplayName(id);
        setUserName(toFirstName(dn));

        // Ensure today's day row exists (persists yesterday's targets forward)
        const todayDay = await ensureTodayDay(id);
        setDay(todayDay);
        setDayId(todayDay.id);
        saveSnapshot({ dayId: todayDay.id, date: todayKey, targets: todayDay.targets, totals: todayDay.totals, updatedAt: Date.now() });
        if (todayDay.totals) applyTotals(todayDay.totals);
        // Hydrate targets from day (authoritative)
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

          // sync quick edit
          setQCalories(macros.calories); setQProtein(macros.protein);
          setQCarbs(macros.carbs); setQFat(macros.fat);
          setQLabel(String(dayTargets.label || '')); setQWhy(why);

          persistTargetsLocally({ ...macros, label: dayTargets.label || null, rationale: why || null });
        }

        // Load today's food entries (entry_date = dayKey)
        if (todayDay.id) {
          const { data: foods, error: foodsErr } = await supabase
            .from('food_entries')
            .select('id, description, calories, protein, carbs, fat, created_at')
            .eq('user_id', id)
            .eq('entry_date', todayKey)
            .order('created_at', { ascending: false });
          logSb('bootstrap:load foods', foodsErr, { id, todayKey });

          setMeals(((foods as any) || []).map((r: any) => ({
            id: r.id,
            meal_summary: r.description,
            calories: r.calories,
            protein: r.protein,
            carbs: r.carbs,
            fat: r.fat,
          })));

          // Load today's workouts (fixed columns)
          await loadWorkouts(id, todayKey);
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

      // Persist to today's day row
      try {
        if (!userId) return;
        const { data: d, error: dErr } = await supabase
          .from('days')
          .select('id')
          .eq('user_id', userId)
          .eq('date', dateKeyChicago())
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
        // eslint-disable-next-line no-console
        console.error('Failed to persist targets to days:', err);
      }
    });

    return () => { off(); };
  }, []);

  // -------- Greeting refresh + phrase rotation --------
  useEffect(() => {
    const tick = () => setGreeting(greetingForChicago());
    tick(); // initial sync
    const id = window.setInterval(tick, 5 * 60 * 1000); // update every 5 minutes
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { setPhrase(pickPhrase(greeting)); }, [greeting]);

  // -------- Midnight rollover (America/Chicago) --------
  useEffect(() => {
    if (!userId) return;

    const schedule = () => {
      const ms = msUntilNextChicagoMidnight();
      if (midnightTimer.current) window.clearTimeout(midnightTimer.current);
      midnightTimer.current = window.setTimeout(async () => {
        // At midnight: ensure new day exists, move UI to it
        await ensureTodayDay(userId);
        const newKey = dateKeyChicago();
        setDayKey(newKey);

        // reload today’s `days` row and clear lists (new day starts empty)
        const { data: todayDay, error } = await supabase
          .from('days')
          .select('id, date, targets, totals')
          .eq('user_id', userId)
          .eq('date', newKey)
          .maybeSingle();
        logSb('midnight:fetch new day', error, { userId, newKey });

        if (!error && todayDay) {
          setDay(todayDay as DayRow);
          setDayId((todayDay as DayRow).id);
        }
        setMeals([]);
        setWoSuggestions([]);
        await loadWorkouts(userId, newKey);

        // reschedule for next midnight
        schedule();
      }, ms) as unknown as number;
    };

    schedule();
    return () => { if (midnightTimer.current) window.clearTimeout(midnightTimer.current); };
  }, [userId]);

  // Also listen for recalc broadcasts so allowance/remaining update instantly
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

    return () => {
      unsubs.forEach((fn) => { try { fn?.(); } catch {} });
    };
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

  // Totals from meals (consumed) — for the onTotalsChange callback only
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
    };
  }, [totalsFromMeals, previewMeal]);


  // Prefer today's DB targets; fall back to local targets; then last snapshot
const SNAP_KEY = 'tm:lastDaySnapshot';
function loadSnapshot() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch { return null; }
}
const LS_TARGETS_KEY = 'tm:targets';
function loadTargetsFromLocal() {
  try { return JSON.parse(localStorage.getItem(LS_TARGETS_KEY) || 'null'); } catch { return null; }
}

const displayTargets = useMemo(() => {
  const t =
    (day?.targets) ||
    loadTargetsFromLocal() ||
    (loadSnapshot()?.targets) ||
    {};
  return {
    calories: Number(t.calories || 0),
    protein:  Number(t.protein  || 0),
    carbs:    Number(t.carbs    || 0),
    fat:      Number(t.fat      || 0),
  };
}, [day?.targets]);




  // Report consumed totals (without preview) upward if needed
  useEffect(() => {
    onTotalsChange?.(totalsFromMeals);
  }, [totalsFromMeals, onTotalsChange]);

  // Allowance / remaining math: use persisted totals + preview overlays
  const persistedAllowance  = day?.totals?.allowance ?? (currentGoal?.calories || 0);
  const persistedRemaining  = day?.totals?.remaining ?? (currentGoal?.calories || 0); // before preview overlay
  const previewWorkoutDelta = previewWorkoutKcal > 0 ? previewWorkoutKcal : 0;
  const dailyAllowance = Math.max(0, Math.round(persistedAllowance + previewWorkoutDelta));
  const remainingCalories = Math.round(
    (persistedRemaining + previewWorkoutDelta) - (previewMeal?.calories || 0)
  );

  // >>> Scaled macro goals so workouts expand macro budgets proportionally <<<
  const scaledProteinGoal = useMemo(() => {
    const base = currentGoal?.protein || 0;
    const baseCal = currentGoal?.calories || 0;
    if (baseCal <= 0) return base;
    const scale = dailyAllowance / baseCal;
    return Math.round(base * scale);
  }, [currentGoal, dailyAllowance]);

  const scaledCarbGoal = useMemo(() => {
    const base = currentGoal?.carbs || 0;
    const baseCal = currentGoal?.calories || 0;
    if (baseCal <= 0) return base;
    const scale = dailyAllowance / baseCal;
    return Math.round(base * scale);
  }, [currentGoal, dailyAllowance]);

  const scaledFatGoal = useMemo(() => {
    const base = currentGoal?.fat || 0;
    const baseCal = currentGoal?.calories || 0;
    if (baseCal <= 0) return base;
    const scale = dailyAllowance / baseCal;
    return Math.round(base * scale);
  }, [currentGoal, dailyAllowance]);

  const remainingProtein = Math.max(0, scaledProteinGoal - totalsWithPreview.protein);
  const remainingCarbs   = Math.max(0, scaledCarbGoal   - totalsWithPreview.carbs);
  const remainingFat     = Math.max(0, scaledFatGoal    - totalsWithPreview.fat);

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
        const kcal = await estimateWorkoutKcalSmart(workoutText.trim(), profile);
        setPreviewWorkoutKcal(kcal);
      } catch {
        setPreviewWorkoutKcal(0);
      }
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
        userId,
        dayId,
        name: mealText.trim(),
        calories: Math.round(res.macros.calories || 0),
        protein: Math.round(res.macros.protein || 0),
        carbs: Math.round(res.macros.carbs || 0),
        fat: Math.round(res.macros.fat || 0),
        meta: { source: 'ai_estimate' },
      });

      // Refresh the list
      const { data: foods, error: foodsErr } = await supabase
        .from('food_entries')
        .select('id, description, calories, protein, carbs, fat, created_at')
        .eq('user_id', userId)
        .eq('entry_date', dayKey)
        .order('created_at', { ascending: false });
      logSb('addMealFromEstimate:reload foods', foodsErr, { userId, dayKey });

      setMeals(((foods as any) || []).map((r: any) => ({
        id: r.id,
        meal_summary: r.description,
        calories: r.calories,
        protein: r.protein,
        carbs: r.carbs,
        fat: r.fat,
      })));

      setMealText('');
      setPreviewMeal(null);

      // Also refresh day totals immediately (in case event loop/render lags)
      const { data: d, error: dayErr } = await supabase
        .from('days')
        .select('id, totals')
        .eq('id', dayId)
        .maybeSingle();
      logSb('addMealFromEstimate:reload day totals', dayErr, { dayId });
      if (!dayErr && d) setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);
    } catch (e: any) {
      openCoaching(e?.message || 'Could not estimate/add meal.');
    } finally {
      setBusy(false);
    }
  }

  // Local delete wrapper for meals
  async function deleteFoodLocal(id: string) {
    if (!userId || !dayId) return;
    await deleteFoodEntry({ id, userId, dayId });

    const { data: foods, error: foodsErr } = await supabase
      .from('food_entries')
      .select('id, description, calories, protein, carbs, fat, created_at')
      .eq('user_id', userId)
      .eq('entry_date', dayKey)
      .order('created_at', { ascending: false });
    logSb('deleteFood:reload foods', foodsErr, { userId, dayKey });

    setMeals(((foods as any) || []).map((r: any) => ({
      id: r.id,
      meal_summary: r.description,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
    })));

    // refresh day totals
    const { data: d, error: dayErr } = await supabase
      .from('days')
      .select('id, totals')
      .eq('id', dayId)
      .maybeSingle();
    logSb('deleteFood:reload day totals', dayErr, { dayId });
    if (!dayErr && d) setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);
  }

  async function addWorkout() {
    if (!workoutText.trim() || !userId || !dayId) return;
    setBusy(true);
    try {
      // ✅ Use smart estimator so we never silently log 0
      const kcal = await estimateWorkoutKcalSmart(workoutText.trim(), profile);

      await upsertWorkoutEntry({
        userId,
        dayId,
        kind: workoutText.trim(),
        calories: kcal,
        meta: { source: 'ai_estimate' },
      });

      setWorkoutText('');
      setPreviewWorkoutKcal(0);
      showToast(`Added +${kcal} kcal to allowance`);

      // refresh list + day totals immediately
      await loadWorkouts(userId, dayKey);
      const { data: d, error: dayErr } = await supabase
        .from('days')
        .select('id, totals')
        .eq('id', dayId)
        .maybeSingle();
      logSb('addWorkout:reload day totals', dayErr, { dayId });
      if (!dayErr && d) setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);
    } catch (e: any) {
      openCoaching(e?.message || 'Could not estimate workout burn.');
    } finally {
      setBusy(false);
    }
  }

  function startEditWorkout(w: WorkoutRow) {
    setEditWoId(w.id);
    setEditWoKind(w.kind);
    setEditWoKcal(w.calories); // initial display (read-only); AI will re-estimate on Save
    setEditWoOpen(true);
  }

  async function estimateEditWorkoutKcal() {
    if (!editWoKind.trim()) return;
    setBusy(true);
    try {
      const kcal = await estimateWorkoutKcalSmart(editWoKind.trim(), profile);
      setEditWoKcal(kcal); // read-only display update
      showToast(`Estimated ~${kcal} kcal`);
    } finally {
      setBusy(false);
    }
  }

  async function saveEditWorkout() {
    if (!userId || !dayId || !editWoId) return;
    setBusy(true);
    try {
      // Always re-estimate based on the edited workout text (AI is the only editor)
      const aiKcal = await estimateWorkoutKcalSmart(editWoKind.trim(), profile);
      setEditWoKcal(aiKcal);

      await upsertWorkoutEntry({
        id: editWoId,
        userId,
        dayId,
        kind: editWoKind.trim(),
        calories: Math.max(0, aiKcal),
        meta: { source: 'manual_edit_ai_estimated' },
      });

      await loadWorkouts(userId, dayKey);
      // refresh day totals
      const { data: d, error: dayErr } = await supabase
        .from('days')
        .select('id, totals')
        .eq('id', dayId)
        .maybeSingle();
      logSb('saveEditWorkout:reload day totals', dayErr, { dayId });
      if (!dayErr && d) setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);

      setEditWoOpen(false);
      showToast(`Saved with AI-estimated ${aiKcal} kcal`);
    } finally {
      setBusy(false);
    }
  }

  function cancelEditWorkout() {
    setEditWoOpen(false);
    setEditWoId(null);
  }

  async function removeWorkout(id: string) {
    if (!userId || !dayId) return;
    await deleteWorkoutEntry({ id, userId, dayId });
    await loadWorkouts(userId, dayKey);

    // refresh day totals
    const { data: d, error: dayErr } = await supabase
      .from('days')
      .select('id, totals')
      .eq('id', dayId)
      .maybeSingle();
    logSb('removeWorkout:reload day totals', dayErr, { dayId });
    if (!dayErr && d) setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);
  }

  // Meal swap suggestion
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

  // Per-row workout suggestions — tailored to the seed workout
  async function suggestWorkoutForRow(seedTitle: string, rowId: string) {
    if (!profile) return;
    setBusy(true);
    setSuggestForId(rowId);
    setSuggestForTitle(seedTitle);
    setWoSuggestions([]);
    setSuggestOpen(true);

    try {
      const base = seedTitle.toLowerCase();

      const isCardio =
        /\b(run|jog|walk|row|cycle|bike|elliptical|stair|swim|treadmill|rowing|cycling|hike)\b/.test(base);

      const isStrength =
        /\b(weight|lift|strength|push|pull|squat|deadlift|bench|press|clean|snatch|curl|lunge|row)\b/.test(base);

      const durMatch = base.match(/(\d{2,3})\s*(?:min|mins|minute|minutes)/);
      const minutes = durMatch ? Math.max(10, Math.min(120, parseInt(durMatch[1], 10))) : 30;

      let candidates: string[] = [];
      if (isCardio && !isStrength) {
        candidates = [
          `${minutes} min brisk walk`,
          `${Math.round(minutes * 0.8)} min interval run (hard/easy)`,
          `${minutes} min rowing steady`,
          `${minutes} min cycling moderate`,
        ];
      } else if (isStrength && !isCardio) {
        candidates = [
          `${minutes} min full-body compound lifts`,
          `${minutes} min push/pull superset session`,
          `${minutes} min strength training moderate`,
          `${minutes} min kettlebell circuit`,
        ];
      } else {
        candidates = [
          `${minutes} min jog easy-moderate`,
          `${minutes} min kettlebell circuit`,
          `${minutes} min weight training moderate`,
        ];
      }

      const scored: Array<{ title: string; kcal: number }> = [];
      for (const c of candidates) {
        try {
          const kcal = await estimateWorkoutKcalSmart(c, profile);
          scored.push({ title: c, kcal });
        } catch { /* ignore single candidate errors */ }
      }
      setWoSuggestions(scored);
    } finally {
      setBusy(false);
    }
  }

  async function addSuggestedWorkout(title: string, kcal: number) {
    if (!userId || !dayId) return;
    setBusy(true);
    try {
      await upsertWorkoutEntry({
        userId, dayId, kind: title, calories: Math.max(0, Math.round(kcal || 0)),
        meta: { source: 'ai_suggestion' },
      });
      await loadWorkouts(userId, dayKey);
      // refresh day totals
      const { data: d, error: dayErr } = await supabase
        .from('days')
        .select('id, totals')
        .eq('id', dayId)
        .maybeSingle();
      logSb('addSuggestedWorkout:reload day totals', dayErr, { dayId });
      if (!dayErr && d) setDay(prev => prev ? { ...prev, totals: (d as any).totals } : prev);

      showToast(`Added: ${title} (+${kcal} kcal)`);
      setSuggestOpen(false);
    } finally {
      setBusy(false);
    }
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

  function openCoaching(text: string) {
    setCoachText(text || 'Could not fetch coaching tips.');
    setCoachOpen(true);
  }

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
      // Persist per-user (baseline) — user_targets
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
      logSb('saveQuickEdit: upsert user_targets', up.error, { userId });

      // Mirror into today's day row (authoritative for today/daily allowance)
      const { data: d, error: dErr } = await supabase
        .from('days')
        .select('id')
        .eq('user_id', userId)
        .eq('date', dateKeyChicago())
        .maybeSingle();
      logSb('saveQuickEdit: fetch today day', dErr, { userId });

      if ((d as any)?.id) {
        const upd = await supabase.from('days')
          .update({ targets: payload, updated_at: new Date().toISOString() })
          .eq('id', (d as any).id);
        logSb('saveQuickEdit: update days.targets', upd.error, { dayId: (d as any).id });
        setDay(prev => prev ? { ...prev, targets: payload } : prev);
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
      // eslint-disable-next-line no-console
      console.error(e);
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

        {/* Header + Edit + Personalized greeting */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold">Today</h1>
            <span className="text-sm text-neutral-600 dark:text-neutral-300 mt-1">
              Good {greeting}{userName ? `, ${userName}` : ''} — {phrase}
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
          <SummaryPill label="Current target" value={goalLabel ? String(goalLabel).toUpperCase() : '—'} />
          <SummaryPill label="Exercise added" value={`${Math.round(day?.totals?.workoutCals ?? 0)} kcal`} />
          <SummaryPill label="Daily allowance" value={`${Math.round(dailyAllowance)} kcal`} />
        </div>

        {/* Macro meters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <MacroMeter title="Calories" used={totalsWithPreview.calories} goal={displayTargets.calories} unit="kcal" />
          <MacroMeter title="Protein"  used={totalsWithPreview.protein}       goal={displayTargets.protein}  unit="g" />
          <MacroMeter title="Carbs"    used={totalsWithPreview.carbs}         goal={displayTargets.carbs}    unit="g" />
          <MacroMeter title="Fat"      used={totalsWithPreview.fat}           goal={displayTargets.fat}      unit="g" />
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
          <label className="text-sm font-medium">
            Log a meal
            <span className="ml-1 text-[11px] text-neutral-500">— be as specific as possible (ingredients, amounts, cooking method)</span>
          </label>
          <textarea
            className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
            rows={3}
            placeholder="e.g., 1 bowl oatmeal (60g oats) with 200ml 2% milk + 1 banana; 2 eggs scrambled in 1 tsp olive oil"
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
          <label className="text-sm font-medium">
            Log today’s workout
            <span className="ml-1 text-[11px] text-neutral-500">— be as specific as possible (duration, intensity, distance, sets/reps/weight)</span>
          </label>
          <input
            className="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2 text-sm bg-white dark:bg-neutral-950"
            placeholder="e.g., 45 min weight training (moderate: full-body); or 30 min jog @10 min/mi; or 5x5 squats 185lb + 3x12 bench 135lb"
            value={workoutText}
            onChange={(e) => setWorkoutText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={addWorkout}
              disabled={busy || !workoutText.trim()}
              className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black disabled:opacity-60"
            >
              Estimate burn & add
            </button>
            {previewWorkoutKcal > 0 && (
              <div className="text-sm">Preview: +{previewWorkoutKcal} kcal</div>
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
                  <td className="p-2 align-top">{m.meal_summary || m.name}</td>
                  <td className="p-2">{m.calories}</td>
                  <td className="p-2">{m.protein ?? '—'}</td>
                  <td className="p-2">{m.carbs ?? '—'}</td>
                  <td className="p-2">{m.fat ?? '—'}</td>
                  <td className="p-2 flex gap-2">
                    <button
                      className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800"
                      onClick={() => coachMealRow(m)}
                    >
                      AI Coach: Suggest Alternative
                    </button>
                    <button
                      className="px-2 py-1 rounded-lg bg-red-600 text-white dark:bg-red-500"
                      onClick={() => deleteFoodLocal(m.id)}
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
                    <button
                      className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800"
                      onClick={() => startEditWorkout(w)}
                    >
                      Edit
                    </button>
                    <button
                      className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800"
                      onClick={() => suggestWorkoutForRow(w.kind, w.id)}
                    >
                      Suggest workout
                    </button>
                    <button
                      className="px-2 py-1 rounded-lg bg-red-600 text-white dark:bg-red-500"
                      onClick={() => removeWorkout(w.id)}
                    >
                      Remove
                    </button>
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

        {/* Edit Workout modal (AI-only calories) */}
        <Modal isOpen={editWoOpen} onClose={cancelEditWorkout} title="Edit workout">
          <div className="space-y-3">
            <div>
              <div className="text-xs text-neutral-500 mb-1">
                Workout <span className="ml-1 text-[11px]">— be as specific as possible (duration, intensity, distance, sets/reps/weight)</span>
              </div>
              <input
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm bg-white dark:bg-neutral-900"
                value={editWoKind}
                onChange={(e) => setEditWoKind(e.target.value)}
                placeholder="e.g., 30 min interval run (hard/easy); or 5x5 squats 185lb + 3x12 bench 135lb"
              />
            </div>

            {/* Read-only AI calories */}
            <div>
              <div className="text-xs text-neutral-500 mb-1">Estimated burn (kcal)</div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{Number.isFinite(editWoKcal) ? editWoKcal : 0}</div>
                <button
                  onClick={estimateEditWorkoutKcal}
                  className="px-2 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-sm"
                  type="button"
                >
                  Estimate calories
                </button>
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">AI will re-estimate automatically when you press Save.</div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={saveEditWorkout}
                className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black"
                disabled={busy || !editWoKind.trim()}
              >
                Save
              </button>
              <button
                onClick={cancelEditWorkout}
                className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>

        {/* Suggest workout modal */}
        <Modal isOpen={suggestOpen} onClose={() => setSuggestOpen(false)} title="Suggest workout">
          <div className="space-y-2 text-sm">
            {suggestForTitle && (
              <div className="text-neutral-600 dark:text-neutral-300">
                Based on: <span className="font-medium">{suggestForTitle}</span>
              </div>
            )}
            {woSuggestions.length === 0 ? (
              <div className="text-neutral-500 dark:text-neutral-400">Finding options…</div>
            ) : (
              <ul className="space-y-1">
                {woSuggestions.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span>{s.title} — {s.kcal} kcal</span>
                    <button
                      className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800"
                      onClick={() => addSuggestedWorkout(s.title, s.kcal)}
                    >
                      Use
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>

        {/* Quick Edit Targets modal */}
        <Modal
          isOpen={quickOpen}
          onClose={() => setQuickOpen(false)}
          title={
            <div className="flex items-center justify-between w-full">
              <span>Quick Edit Targets</span>
              <a
                href={'#/targets'}
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
  // Only compute % when a real goal exists; otherwise, show 0% and a dash for goal.
  const hasGoal = Number(goal) > 0;
  const pct = hasGoal ? Math.max(0, Math.min(100, (used / goal) * 100)) : 0;
  const goalLabel = hasGoal ? Math.round(goal).toString() : '—';

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {Math.round(used)} / {goalLabel} {unit}
        </span>
      </div>
      <div className="h-3 w-full rounded-full bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
        <div
  className="h-3 rounded-full bg-purple-600 transition-[width] duration-300"
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
      <div className="text-xs text-neutral-500 mb-1">
        {label}{suffix ? ` (${suffix})` : ''}
      </div>
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


