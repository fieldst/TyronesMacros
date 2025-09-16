import { supabase } from './supabaseClient';

export type MacroSet = { calories: number; protein: number; carbs: number; fat: number };

export async function getProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertProfile(userId: string, profile: any) {
  const { error } = await supabase.from('profiles').upsert({ id: userId, ...profile });
  if (error) throw error;
}

export async function getDay(userId: string, date: string) {
  const { data, error } = await supabase.from('days').select('*')
    .eq('user_id', userId).eq('date', date).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertDay(userId: string, day: {
  date: string;
  targets: MacroSet;
  workout_logged?: string;
  workout_kcal?: number;
  swap_suggestions?: string;
}) {
  const payload = {
    user_id: userId,
    date: day.date,
    targets: day.targets,
    workout_logged: day.workout_logged ?? '',
    workout_kcal: day.workout_kcal ?? 0,
    swap_suggestions: day.swap_suggestions ?? '',
  };
  const { error } = await supabase.from('days').upsert(payload);
  if (error) throw error;
}

export async function listMeals(userId: string, date: string) {
  const { data, error } = await supabase.from('meals').select('*')
    .eq('user_id', userId).eq('date', date).order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addMeal(userId: string, meal: {
  date: string; meal_type: string; meal_summary: string;
  macros: MacroSet;
}) {
  const { error } = await supabase.from('meals').insert({ user_id: userId, ...meal });
  if (error) throw error;
}

export async function deleteMeal(userId: string, id: string) {
  const { error } = await supabase.from('meals').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
}
