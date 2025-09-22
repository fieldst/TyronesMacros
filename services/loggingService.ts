// services/loggingService.ts
import { supabase } from '../supabaseClient';
import { eventBus } from '../lib/eventBus';
import { recalcAndPersistDay } from '../lib/recalcDay';

/** ---------------- Types used by UI ---------------- */
export type FoodEntryUpsert = {
  id?: string;
  userId: string;
  dayId: string;          // we derive entry_date from this
  name: string;           // meal text -> maps to food_entries.description
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  meta?: { source?: string } | any;
};

export type WorkoutEntryUpsert = {
  id?: string;
  userId: string;
  dayId: string;          // we derive entry_date from this
  kind: string;           // -> workout_entries.activity
  calories: number;       // -> workout_entries.calories_burned
  duration_min?: number;  // -> workout_entries.minutes
  intensity?: string;     // optional UI field (or pass via meta)
  meta?: { source?: string; intensity?: string } | any;
};

type Totals = { foodCals: number; workoutCals: number; allowance: number; remaining: number };

/** ---------------- Helpers ---------------- */

/** Prefer days.targets.calories, else daily_targets / targets fallbacks. */
async function getBaseTargetCalories(dayId: string, userId: string): Promise<number> {
  const { data: day, error: dayErr } = await supabase
    .from('days')
    .select('targets')
    .eq('id', dayId)
    .eq('user_id', userId)
    .maybeSingle();
  if (dayErr) throw dayErr;

  const dayTarget = Number((day as any)?.targets?.calories ?? NaN);
  if (!Number.isNaN(dayTarget)) return dayTarget;

  const { data: daily } = await supabase
    .from('daily_targets')
    .select('calories')
    .eq('user_id', userId)
    .eq('day_id', dayId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const dailyCals = Number((daily as any)?.calories ?? NaN);
  if (!Number.isNaN(dailyCals)) return dailyCals;

  const { data: latestTarget } = await supabase
    .from('targets')
    .select('calories')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const targetCals = Number((latestTarget as any)?.calories ?? NaN);
  if (!Number.isNaN(targetCals)) return targetCals;

  return 0;
}

/** After any change, recalc totals and emit one event all listeners can use. */
async function recalcAndBroadcast(dayId: string, userId: string): Promise<Totals> {
  const baseTarget = await getBaseTargetCalories(dayId, userId);
  const totals = await recalcAndPersistDay(dayId, userId, baseTarget);
  eventBus.emit('day:totals', { dayId, totals });
  return totals;
}

/** Resolve YYYY-MM-DD for a given dayId. */
async function getDayDate(dayId: string): Promise<string> {
  const { data, error } = await supabase
    .from('days')
    .select('date')
    .eq('id', dayId)
    .maybeSingle();
  if (error) throw error;
  return (data as any)?.date as string; // e.g., "2025-09-21"
}

/** ---------------- FOOD (food_entries) ---------------- */
export async function upsertFoodEntry(params: FoodEntryUpsert): Promise<Totals> {
  const { id, userId, dayId, name, calories, protein, carbs, fat, meta } = params;

  const entry_date = await getDayDate(dayId);

  const payload: any = {
    user_id: userId,
    entry_date,                 // date
    description: name,          // text
    calories, protein, carbs, fat,
  };
  if (meta?.source) payload.source = String(meta.source);

  const q = supabase.from('food_entries');
  if (id) {
    const { error } = await q.update(payload).eq('id', id).eq('user_id', userId);
    if (error) throw error;
  } else {
    const { error } = await q.insert([payload]);
    if (error) throw error;
  }

  const totals = await recalcAndBroadcast(dayId, userId);
  eventBus.emit('meal:upsert', { dayId, totals });
  eventBus.emit('food:upsert', { dayId, totals });
  return totals;
}

export async function deleteFoodEntry(params: { id: string; userId: string; dayId: string }): Promise<Totals> {
  const { id, userId, dayId } = params;
  const { error } = await supabase.from('food_entries').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;

  const totals = await recalcAndBroadcast(dayId, userId);
  eventBus.emit('meal:delete', { dayId, totals });
  eventBus.emit('food:delete', { dayId, totals });
  return totals;
}

/** ---------------- WORKOUTS (workout_entries) ----------------
 * Your table columns:
 *   user_id, entry_date, activity, minutes, calories_burned, intensity, source
 */
export async function upsertWorkoutEntry(params: WorkoutEntryUpsert): Promise<Totals> {
  const { id, userId, dayId, kind, calories, duration_min, intensity, meta } = params;

  const entry_date = await getDayDate(dayId);

  const payload: any = {
    user_id: userId,
    entry_date,
    activity: kind,
    minutes: typeof duration_min === 'number' ? duration_min : null,
    calories_burned: calories,
  };

  // optional fields
  const resolvedIntensity = intensity ?? meta?.intensity;
  if (resolvedIntensity) payload.intensity = String(resolvedIntensity);
  if (meta?.source) payload.source = String(meta.source);

  const q = supabase.from('workout_entries');
  if (id) {
    const { error } = await q.update(payload).eq('id', id).eq('user_id', userId);
    if (error) throw error;
  } else {
    const { error } = await q.insert([payload]);
    if (error) throw error;
  }

  const totals = await recalcAndBroadcast(dayId, userId);
  eventBus.emit('workout:upsert', { dayId, totals });
  return totals;
}

export async function deleteWorkoutEntry(params: { id: string; userId: string; dayId: string }): Promise<Totals> {
  const { id, userId, dayId } = params;
  const { error } = await supabase.from('workout_entries').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;

  const totals = await recalcAndBroadcast(dayId, userId);
  eventBus.emit('workout:delete', { dayId, totals });
  return totals;
}
