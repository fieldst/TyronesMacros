// lib/recalcDay.ts
// Minimal, safe implementation that matches how TargetsView calls it:
//   await recalcAndPersistDay(userId, dateKey)
//
// It sums foods/workouts for the day, derives an allowance (targets.calories + workout_cals),
// respects locked_remaining/remaining_override, and writes totals back to days.totals.

import { supabase } from '../supabaseClient';

export type DayTotals = {
  food_cals: number;
  workout_cals: number;
  allowance: number;
  remaining: number;
  locked_remaining?: boolean;
  remaining_override?: number | null;
  protein?: number;
  carbs?: number;
  fat?: number;
};

type SumRow = { calories?: number | null; calories_burned?: number | null };

async function sumFoods(userId: string, dateKey: string): Promise<number> {
  const { data, error } = await supabase
    .from('foods')
    .select('calories')
    .eq('user_id', userId)
    .eq('date', dateKey);
  if (error || !Array.isArray(data)) return 0;
  return (data as SumRow[]).reduce((n, r) => n + (Number(r.calories) || 0), 0);
}

async function sumWorkouts(userId: string, dateKey: string): Promise<number> {
  const { data, error } = await supabase
    .from('workouts')
    .select('calories_burned')
    .eq('user_id', userId)
    .eq('date', dateKey);
  if (error || !Array.isArray(data)) return 0;
  return (data as SumRow[]).reduce((n, r) => n + (Number(r.calories_burned) || 0), 0);
}

async function readDayRow(userId: string, dateKey: string) {
  const { data } = await supabase
    .from('days')
    .select('id, totals, targets')
    .eq('user_id', userId)
    .eq('date', dateKey)
    .maybeSingle();
  return data as { id?: string; totals?: any; targets?: any } | null;
}

async function upsertDayTotals(userId: string, dateKey: string, totals: DayTotals) {
  const { data: existing } = await supabase
    .from('days')
    .select('id')
    .eq('user_id', userId)
    .eq('date', dateKey)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from('days')
      .update({ totals, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('date', dateKey);
  } else {
    await supabase
      .from('days')
      .insert({ user_id: userId, date: dateKey, totals, updated_at: new Date().toISOString() });
  }
}

/**
 * Recalculate and persist totals for a user/day.
 * Safe to call repeatedly; respects locked_remaining.
 */
export async function recalcAndPersistDay(userId: string, dateKey: string): Promise<DayTotals> {
  if (!userId || !dateKey) throw new Error('recalcAndPersistDay: missing params');

  const [foodCals, workoutCals, dayRow] = await Promise.all([
    sumFoods(userId, dateKey),
    sumWorkouts(userId, dateKey),
    readDayRow(userId, dateKey),
  ]);

  // Base target calories: prefer today's targets.calories; fallback to 0
  const baseTarget =
    (dayRow?.targets && Number(dayRow.targets.calories)) ||
    0;

  const allowance = Math.max(0, baseTarget + workoutCals);

  // Prior totals (for lock behavior)
  const prior = (dayRow?.totals || {}) as Partial<DayTotals>;

  let remaining = allowance - foodCals;
  if (prior?.locked_remaining) {
    if (typeof prior.remaining_override === 'number') {
      remaining = prior.remaining_override;
    } else if (typeof prior.remaining === 'number') {
      remaining = prior.remaining;
    }
  }

  const totals: DayTotals = {
    food_cals: foodCals,
    workout_cals: workoutCals,
    allowance,
    remaining,
    locked_remaining: Boolean(prior?.locked_remaining),
    remaining_override: prior?.remaining_override ?? null,

    // Keep any existing macros if present (don’t zero them)
    protein: typeof prior?.protein === 'number' ? prior.protein : undefined,
    carbs: typeof prior?.carbs === 'number' ? prior.carbs : undefined,
    fat: typeof prior?.fat === 'number' ? prior.fat : undefined,
  };

  await upsertDayTotals(userId, dateKey, totals);
  return totals;
}
