// services/dayService.ts
import { supabase } from '../supabaseClient';
import { dateKeyChicago } from '../lib/dateLocal';

type DayRow = {
  id: string;
  date: string;
  targets: any | null;
  totals: { foodCals: number; workoutCals: number; allowance: number; remaining: number } | null;
};

// simple logger you can reuse
function logSb(where: string, error: any, extra?: Record<string, unknown>) {
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[Supabase] ${where}`, { error, ...extra });
  }
}

/**
 * Ensures a `days` row exists for today's Chicago date.
 * If missing, it clones yesterday's targets so your "current target" persists,
 * and zeros out totals.
 */
export async function ensureTodayDay(userId: string): Promise<DayRow> {
  const today = dateKeyChicago();

  // Already have today?
  const { data: existing, error: exErr } = await supabase
    .from('days')
    .select('id, date, targets, totals')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  logSb('ensureTodayDay:fetch today', exErr, { userId, today });

  if (!exErr && existing) return existing as DayRow;

  // Get most recent prior day to carry forward targets
  const { data: lastDays, error: lastErr } = await supabase
    .from('days')
    .select('targets, date')
    .eq('user_id', userId)
    .lt('date', today)
    .order('date', { ascending: false })
    .limit(1);
  logSb('ensureTodayDay:fetch last day', lastErr, { userId, today });

  const carryTargets = lastDays?.[0]?.targets ?? null;
  const baseCalories = Number(carryTargets?.calories ?? 0) || 0;

  const newRow = {
    user_id: userId,
    date: today,
    targets: carryTargets, // keep current target
    totals: { foodCals: 0, workoutCals: 0, allowance: baseCalories, remaining: baseCalories },
  };

  const { data: inserted, error: insErr } = await supabase
    .from('days')
    .insert(newRow)
    .select('id, date, targets, totals')
    .single();
  logSb('ensureTodayDay:insert today', insErr, { userId, today });

  if (insErr) throw insErr;
  return inserted as DayRow;
}
