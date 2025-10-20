// services/dayService.ts
import { supabase } from '../supabaseClient';
import { getCurrentChicagoDateKey } from '../lib/dateLocal';
import { getCurrentUserId } from '../auth';

export type DayRow = {
  id: string;
  date: string;
  targets: any | null;
  totals: { 
    food_cals: number; 
    workout_cals: number; 
    allowance: number; 
    remaining: number;
    protein: number;
    carbs: number;
    fat: number;
    // NEW
    locked_remaining?: boolean;
    remaining_override?: number | null;
  };
};


export type DaySnapshot = {
  date: string;
  targets: any | null;
  totals: any | null;
};

/**
 * Save/load day snapshot to localStorage for instant hydration
 */
export function saveDaySnapshot(snapshot: DaySnapshot) {
  try {
    localStorage.setItem('lastDaySnapshot', JSON.stringify(snapshot));
  } catch (e) {
    console.warn('Failed to save day snapshot:', e);
  }
}

export function loadDaySnapshot(): DaySnapshot | null {
  try {
    const raw = localStorage.getItem('lastDaySnapshot');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Failed to load day snapshot:', e);
    return null;
  }
}

/**
 * Get today's snapshot for instant hydration
 */
export function getTodaySnapshot(): DaySnapshot | null {
  const snapshot = loadDaySnapshot();
  const today = getCurrentChicagoDateKey();
  
  if (snapshot && snapshot.date === today) {
    return snapshot;
  }
  
  return null;
}

/**
 * Get food entries for a specific date
 */
export async function getFoodForDate(userId: string, date: string) {
  const { data, error } = await supabase
    .from('food_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('entry_date', date)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get workout entries for a specific date
 */
export async function getWorkoutsForDate(userId: string, date: string) {
  const { data, error } = await supabase
    .from('workout_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('entry_date', date)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Ensures a `days` row exists for today's Chicago date.
 */
export async function ensureTodayDay(userId: string): Promise<DayRow> {
  const today = getCurrentChicagoDateKey();

  // Try to get existing day
  const { data: existing, error: fetchErr } = await supabase
    .from('days')
    .select('id, date, targets, totals')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  if (existing) {
    const result = existing as DayRow;
    
    // Save snapshot for next load
    saveDaySnapshot({
      date: result.date,
      targets: result.targets,
      totals: result.totals
    });
    
    return result;
  }

  // Create new day
  const { data: newDay, error: insertErr } = await supabase
    .from('days')
    .insert({
      user_id: userId,
      date: today,
      targets: { calories: 2200, protein: 170, carbs: 210, fat: 60 },
      totals: { 
  food_cals: 0, 
  workout_cals: 0, 
  allowance: 2200, 
  remaining: 2200, 
  protein: 0, 
  carbs: 0, 
  fat: 0,
  locked_remaining: true,
  remaining_override: null
}

    })
    .select('id, date, targets, totals')
    .single();

  if (insertErr) throw insertErr;
  
  const result = newDay as DayRow;
  
  // Save snapshot for next load
  saveDaySnapshot({
    date: result.date,
    targets: result.targets,
    totals: result.totals
  });
  
  return result;
}

/**
 * Get day data for a specific date
 */
export async function getDayData(userId: string, date: string): Promise<DayRow | null> {
  const { data, error } = await supabase
    .from('days')
    .select('id, date, targets, totals')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();

  if (error) throw error;
  return data as DayRow | null;
}