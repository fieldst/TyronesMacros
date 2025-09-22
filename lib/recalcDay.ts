// lib/recalcDay.ts
import { supabase } from '../supabaseClient';

export type DayTotals = {
  foodCals: number;
  workoutCals: number;
  allowance: number;
  remaining: number;
};

/**
 * Recalculate totals for a day and persist them to days.totals.
 * - food_entries: sum(calories)
 * - workout_entries: sum(calories_burned)
 * - allowance = baseTarget + workoutCals
 * - remaining = allowance - foodCals
 */
export async function recalcAndPersistDay(
  dayId: string,
  userId: string,
  baseTarget?: number
): Promise<DayTotals> {
  // Resolve the day date (YYYY-MM-DD)
  const { data: dayRow, error: dayErr } = await supabase
    .from('days')
    .select('date, targets')
    .eq('id', dayId)
    .eq('user_id', userId)
    .maybeSingle();
  if (dayErr) throw dayErr;

  const dayDate = (dayRow as any)?.date as string;

  // Totals: food
  const { data: foodAgg, error: foodErr } = await supabase
    .from('food_entries')
    .select('calories')
    .eq('user_id', userId)
    .eq('entry_date', dayDate);
  if (foodErr) throw foodErr;
  const foodCals = (foodAgg as any[] | null)?.reduce((s, r) => s + (Number(r.calories) || 0), 0) ?? 0;

  // Totals: workouts (use calories_burned)
  const { data: woAgg, error: woErr } = await supabase
    .from('workout_entries')
    .select('calories_burned')
    .eq('user_id', userId)
    .eq('entry_date', dayDate);
  if (woErr) throw woErr;
  const workoutCals = (woAgg as any[] | null)?.reduce((s, r) => s + (Number(r.calories_burned) || 0), 0) ?? 0;

  // Base target priority: param > days.targets.calories > 0
  const base = typeof baseTarget === 'number'
    ? baseTarget
    : Number((dayRow as any)?.targets?.calories || 0);

  const allowance = Math.max(0, Math.round(base + workoutCals));
  const remaining = Math.round(allowance - foodCals);

  const totals: DayTotals = { foodCals, workoutCals, allowance, remaining };

  // Persist back to days.totals
  const { error: updErr } = await supabase
    .from('days')
    .update({ totals, updated_at: new Date().toISOString() })
    .eq('id', dayId)
    .eq('user_id', userId);
  if (updErr) throw updErr;

  return totals;
}
