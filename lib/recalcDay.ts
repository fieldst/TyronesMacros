// lib/recalcDay.ts
import { supabase } from '../supabaseClient';
import { saveDaySnapshot } from '../services/dayService';

export type DayTotals = {
  food_cals: number;
  workout_cals: number;
  allowance: number;
  remaining: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  // NEW: support locking the “remaining” number
  locked_remaining?: boolean;          // when true, never auto-change remaining
  remaining_override?: number | null;  // manual override if user edits remaining
};

/**
 * Recalculate totals for a day and persist them to days.totals.
 * - food_entries: sum(calories, protein, carbs, fat)
 * - workout_entries: sum(calories_burned)
 * - allowance = baseTarget + workout_cals
 * - remaining = allowance - food_cals
 */
export async function recalcAndPersistDay(
  userId: string,
  date: string,
  baseTarget?: number
): Promise<DayTotals> {
  // Totals: food
  const { data: foodAgg, error: foodErr } = await supabase
    .from('food_entries')
    .select('calories, protein, carbs, fat')
    .eq('user_id', userId)
    .eq('entry_date', date);
  if (foodErr) throw foodErr;
  
  const foodTotals = (foodAgg as any[] | null)?.reduce((acc, r) => ({
    calories: acc.calories + (Number(r.calories) || 0),
    protein: acc.protein + (Number(r.protein) || 0),
    carbs: acc.carbs + (Number(r.carbs) || 0),
    fat: acc.fat + (Number(r.fat) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };

  // Totals: workouts (use calories_burned)
  const { data: woAgg, error: woErr } = await supabase
    .from('workout_entries')
    .select('calories_burned')
    .eq('user_id', userId)
    .eq('entry_date', date);
  if (woErr) throw woErr;
  const workout_cals = (woAgg as any[] | null)?.reduce((s, r) => s + (Number(r.calories_burned) || 0), 0) ?? 0;

  // Get base target from days table if not provided
  let base = baseTarget;
  if (typeof base !== 'number') {
    const { data: dayRow } = await supabase
      .from('days')
      .select('targets')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle();
    base = Number(dayRow?.targets?.calories || 2200);
  }

  // Check the previous totals to see if remaining is locked
const { data: prevRow } = await supabase
  .from('days')
  .select('totals')
  .eq('user_id', userId)
  .eq('date', date)
  .maybeSingle();

const prevTotals = (prevRow?.totals ?? {}) as Partial<DayTotals>;

const allowance = Math.max(0, Math.round(base + workout_cals));

// Default remaining if not locked
let remaining = Math.round(allowance - foodTotals.calories);

// If remaining is locked, keep the existing number (or explicit override)
if (prevTotals.locked_remaining) {
  if (typeof prevTotals.remaining_override === 'number') {
    remaining = Math.round(Number(prevTotals.remaining_override));
  } else if (typeof prevTotals.remaining === 'number') {
    remaining = Math.round(Number(prevTotals.remaining));
  }
}

const totals: DayTotals = { 
  food_cals: foodTotals.calories, 
  workout_cals, 
  allowance, 
  remaining,
  protein: foodTotals.protein,
  carbs: foodTotals.carbs,
  fat: foodTotals.fat,
  locked_remaining: Boolean(prevTotals.locked_remaining),
  remaining_override: (typeof prevTotals.remaining_override === 'number')
    ? Number(prevTotals.remaining_override)
    : null,
};


  // Persist back to days.totals
  const { error: updErr } = await supabase
    .from('days')
    .update({ totals, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('date', date);
  if (updErr) throw updErr;

  // Update snapshot cache
  const { data: dayRow } = await supabase
    .from('days')
    .select('targets')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();
    
  if (dayRow?.targets) {
    saveDaySnapshot({
      date,
      targets: dayRow.targets,
      totals
    });
  }

  return totals;
}