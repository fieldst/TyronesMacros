import { supabase } from './supabaseClient';
import type { MacroSet, Meal } from './types';

type DayPatch = Partial<{
  targets: MacroSet;
  workout_logged: string;
  workout_kcal: number;
  swap_suggestions: string;
}>;

export async function getDay(user_id: string, date: string) {
  const { data, error } = await supabase
    .from('days')
    .select('date, targets, workout_logged, workout_kcal, swap_suggestions')
    .eq('user_id', user_id)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data as
    | {
        date: string;
        targets: MacroSet;
        workout_logged: string | null;
        workout_kcal: number | null;
        swap_suggestions: string | null;
      }
    | null;
}

export async function upsertDay(user_id: string, date: string, patch: DayPatch) {
  const payload = { user_id, date, ...patch };
  const { error } = await supabase.from('days').upsert(payload, {
    onConflict: 'user_id,date',
  });
  if (error) throw error;
}

export async function listMeals(user_id: string, date: string): Promise<Meal[]> {
  const { data, error } = await supabase
    .from('meals')
    .select('id, date, meal_type, meal_summary, calories, protein, carbs, fat')
    .eq('user_id', user_id)
    .eq('date', date)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    date: r.date,
    mealType: r.meal_type,
    mealSummary: r.meal_summary,
    macros: {
      calories: r.calories ?? 0,
      protein: r.protein ?? 0,
      carbs: r.carbs ?? 0,
      fat: r.fat ?? 0,
    },
  }));
}

export async function addMeal(
  user_id: string,
  meal: Omit<Meal, 'id'>
): Promise<string> {
  const payload = {
    user_id,
    date: meal.date,
    meal_type: meal.mealType,
    meal_summary: meal.mealSummary,
    calories: meal.macros.calories,
    protein: meal.macros.protein,
    carbs: meal.macros.carbs,
    fat: meal.macros.fat,
  };
  const { data, error } = await supabase.from('meals').insert(payload).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function deleteMeal(user_id: string, id: string) {
  const { error } = await supabase.from('meals').delete().eq('id', id).eq('user_id', user_id);
  if (error) throw error;
}
