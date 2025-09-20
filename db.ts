// db.ts
import { supabase } from './supabaseClient'
import type { DailyTargets } from './types'

export function todayDateString(d = new Date()) {
  const tzOffset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10) // YYYY-MM-DD
}

export async function upsertDailyTargets(userId: string, dateStr: string, targets: DailyTargets) {
  const { error } = await supabase
    .from('daily_targets')
    .upsert(
      { user_id: userId, target_date: dateStr, ...targets },
      { onConflict: 'user_id,target_date' }
    )
  if (error) throw error
}

export async function getDailyTargets(userId: string, dateStr: string): Promise<DailyTargets | null> {
  const { data, error } = await supabase
    .from('daily_targets')
    .select('calories,protein,carbs,fat')
    .eq('user_id', userId)
    .eq('target_date', dateStr)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function getTodayTotals(userId: string, dateStr: string) {
  const [{ data: foods, error: fErr }, { data: workouts, error: wErr }] = await Promise.all([
    supabase.from('food_entries').select('calories,protein,carbs,fat').eq('user_id', userId).eq('entry_date', dateStr),
    supabase.from('workout_entries').select('calories_burned').eq('user_id', userId).eq('entry_date', dateStr),
  ])
  if (fErr) throw fErr
  if (wErr) throw wErr

  const food = (foods ?? []).reduce((a, r: any) => ({
    calories: a.calories + (r.calories ?? 0),
    protein:  a.protein  + (r.protein  ?? 0),
    carbs:    a.carbs    + (r.carbs    ?? 0),
    fat:      a.fat      + (r.fat      ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })

  const exerciseCalories = (workouts ?? []).reduce((a, r: any) => a + (r.calories_burned ?? 0), 0)

  return { food, exerciseCalories }
}
