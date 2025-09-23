// services/loggingService.ts
import { supabase } from '../supabaseClient';
import { eventBus } from '../lib/eventBus';
import { recalcAndPersistDay } from '../lib/recalcDay';

export type FoodEntryUpsert = {
  id?: string;
  userId: string;
  dayId: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  meta?: { source?: string } | any;
};

export type WorkoutEntryUpsert = {
  id?: string;
  userId: string;
  dayId: string;
  kind: string;
  calories: number;
  duration_min?: number;
  intensity?: string;
  meta?: { source?: string; intensity?: string } | any;
};

type Totals = { foodCals: number; workoutCals: number; allowance: number; remaining: number };

async function getBaseTargetCalories(dayId: string, userId: string): Promise<number> {
  const { data: day } = await supabase
    .from('days')
    .select('targets')
    .eq('id', dayId)
    .eq('user_id', userId)
    .maybeSingle();

  const dayTarget = Number((day as any)?.targets?.calories ?? NaN);
  if (!Number.isNaN(dayTarget)) return dayTarget;

  const { data: latestTarget } = await supabase
    .from('targets')
    .select('calories')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return Number((latestTarget as any)?.calories ?? 0) || 0;
}

async function recalcAndBroadcast(dayId: string, userId: string): Promise<Totals> {
  const baseTarget = await getBaseTargetCalories(dayId, userId);
  const totals = await recalcAndPersistDay(dayId, userId, baseTarget);
  eventBus.emit('day:totals', { dayId, totals });
  return totals;
}

async function getDayDate(dayId: string): Promise<string> {
  const { data } = await supabase.from('days').select('date').eq('id', dayId).maybeSingle();
  return (data as any)?.date as string;
}

/** ---------------- FOOD ---------------- */
export async function upsertFoodEntry(params: FoodEntryUpsert): Promise<Totals> {
  const { id, userId, dayId, name, calories, protein, carbs, fat, meta } = params;

  const entry_date = await getDayDate(dayId);

  const payload: any = {
    user_id: userId,
    description: name,
    calories,
    protein,
    carbs,
    fat,
    updated_at: new Date().toISOString(),
  };
  if (meta?.source) payload.source = String(meta.source);

  const q = supabase.from('food_entries');
  if (id) {
    // Update without overwriting entry_date
    const { error } = await q.update(payload).eq('id', id).eq('user_id', userId);
    if (error) throw error;
  } else {
    // Insert with entry_date
    payload.entry_date = entry_date;
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

/** ---------------- WORKOUTS ---------------- */
export async function upsertWorkoutEntry(params: WorkoutEntryUpsert): Promise<Totals> {
  const { id, userId, dayId, kind, calories, duration_min, intensity, meta } = params;

  const entry_date = await getDayDate(dayId);

  const payload: any = {
    user_id: userId,
    activity: kind,
    minutes: typeof duration_min === 'number' ? duration_min : null,
    calories_burned: calories,
    updated_at: new Date().toISOString(),
  };

  const resolvedIntensity = intensity ?? meta?.intensity;
  if (resolvedIntensity) payload.intensity = String(resolvedIntensity);
  if (meta?.source) payload.source = String(meta.source);

  const q = supabase.from('workout_entries');
  if (id) {
    // Update without overwriting entry_date
    const { error } = await q.update(payload).eq('id', id).eq('user_id', userId);
    if (error) throw error;
  } else {
    // Insert with entry_date
    payload.entry_date = entry_date;
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
