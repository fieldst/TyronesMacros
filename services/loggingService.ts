// services/loggingService.ts
import { supabase } from '../supabaseClient'
import { dateKeyChicago } from '../lib/dateLocal'
import { recalcAndPersistDay } from '../lib/recalcDay'

/** ─────────────────────────────────────────────────────────────────────────────
 * Small logger for Supabase ops
 * ──────────────────────────────────────────────────────────────────────────── */
function sbLog(op: string, error: any, extra?: Record<string, any>) {
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[loggingService] ${op} error:`, error, extra ?? {})
  } else {
    // eslint-disable-next-line no-console
    console.log(`[loggingService] ${op} ok`, extra ?? {})
  }
}

/** If caller passes a YYYY-MM-DD we use it; otherwise default to today (Chicago). */
function normalizeToDateKey(dayIdOrDate?: string): string {
  if (dayIdOrDate && /^\d{4}-\d{2}-\d{2}$/.test(dayIdOrDate)) return dayIdOrDate
  return dateKeyChicago()
}

/* ────────────────────────────── FOOD (unchanged pattern) ───────────────────────────── */

export type UpsertFoodArgs = {
  id?: string
  userId: string
  dayId?: string // YYYY-MM-DD preferred; if omitted, uses today (Chicago)
  name: string   // description / free text
  calories: number
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  source?: string | null // e.g. 'nlp' | 'manual' | 'saved'
}

export async function upsertFoodEntry(args: UpsertFoodArgs) {
  const { id, userId, dayId, name, calories, protein = null, carbs = null, fat = null, source = null } = args
  if (!userId) throw new Error('Missing userId')
  if (!name || calories == null) throw new Error('Missing required food fields')

  const entry_date = normalizeToDateKey(dayId)
  const payload: any = { user_id: userId, entry_date, description: name, calories, protein, carbs, fat, source }

  let error: any
  if (id) {
    const { error: e } = await supabase.from('food_entries').update(payload).eq('id', id).eq('user_id', userId)
    error = e
  } else {
    const { error: e } = await supabase.from('food_entries').insert([payload])
    error = e
  }
  sbLog('upsertFoodEntry', error, { entry_date, calories })
  if (error) throw new Error(error.message || 'Failed to upsert food')

  await recalcAndPersistDay(userId, entry_date)
}

export async function deleteFoodEntry(args: { id: string; userId: string }) {
  const { id, userId } = args
  if (!id || !userId) throw new Error('Missing id/user')

  const { error } = await supabase.from('food_entries').delete().eq('id', id).eq('user_id', userId)
  sbLog('deleteFoodEntry', error, { id })
  if (error) throw new Error(error.message || 'Failed to delete food')
}

/* ───────────────────────────── WORKOUTS (Option A: required columns only) ───────────────────────────── */

/**
 * We accept TodayView's shape ({ kind, calories, ... }) but we only persist:
 *   user_id, entry_date, activity, calories_burned
 * to avoid column-not-found errors.
 */
export type UpsertWorkoutArgs = {
  id?: string
  userId: string
  dayId?: string               // YYYY-MM-DD preferred
  kind: string                 // mapped to activity
  calories: number             // mapped to calories_burned
  // Other fields are accepted but ignored to keep DB writes minimal/safe
  minutes?: number | null
  intensity?: string | null
  source?: string | null
  meta?: any
}

export async function upsertWorkoutEntry(args: UpsertWorkoutArgs) {
  const { id, userId, dayId, kind, calories } = args
  if (!userId) throw new Error('Missing userId')
  if (!kind) throw new Error('Missing activity/kind')

  const entry_date = normalizeToDateKey(dayId)

  // OPTION A: only required columns for workout_entries
  const payload: any = {
    user_id: userId,
    entry_date,
    activity: String(kind).trim(),
    calories_burned: Math.max(0, Math.round(calories ?? 0)),
  }

  let error: any
  if (id) {
    const { error: e } = await supabase.from('workout_entries').update(payload).eq('id', id).eq('user_id', userId)
    error = e
  } else {
    const { error: e } = await supabase.from('workout_entries').insert([payload])
    error = e
  }
  sbLog('upsertWorkoutEntry', error, { entry_date, kind })
  if (error) throw new Error(error.message || 'Failed to upsert workout')

  await recalcAndPersistDay(userId, entry_date)
}

// delete can accept dayId but ignore it; TodayView sometimes passes it
export async function deleteWorkoutEntry(args: { id: string; userId: string; dayId?: string }) {
  const { id, userId } = args
  if (!id || !userId) throw new Error('Missing id/user')
  const { error } = await supabase.from('workout_entries').delete().eq('id', id).eq('user_id', userId)
  sbLog('deleteWorkoutEntry', error, { id })
  if (error) throw new Error(error.message || 'Failed to delete workout')
}

/**
 * Bulk insert workout rows for a specific user + date.
 * Writes only: user_id, entry_date, activity, calories_burned
 * (No day_id / minutes / intensity / source / order_index / description)
 */
export async function bulkAddWorkoutsToDay(args: {
  userId: string
  dayUUID?: string            // ignored in Option A to avoid missing column errors
  dateKey?: string            // YYYY-MM-DD (defaults to today Chicago)
  items: Array<{
    activity: string
    calories_burned?: number | null
    // any other fields will be ignored in Option A
  }>
}) {
  const { userId, dateKey } = args
  if (!userId) throw new Error('Missing userId')

  const entry_date = normalizeToDateKey(dateKey)
  const rows = (args.items || [])
    .map((w) => ({
      user_id: userId,
      entry_date,
      activity: String(w.activity || '').trim(),
      calories_burned: Math.max(0, Math.round(w.calories_burned ?? 0)), // enforce NOT NULL
    }))
    .filter((r) => r.activity.length > 0)

  if (!rows.length) return

  const { error } = await supabase.from('workout_entries').insert(rows)
  sbLog('bulkAddWorkoutsToDay', error, { entry_date, count: rows.length })
  if (error) throw new Error(error.message || 'Failed to add workouts')

  await recalcAndPersistDay(userId, entry_date)
}
