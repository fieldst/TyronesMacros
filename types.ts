// types.ts
export type Target = {
  id: string;
  user_id: string;
  source: 'ai' | 'manual';
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  rationale?: string | null;
  inputs?: any;
  is_active: boolean;
  created_at: string;
};

// types.ts  — minimal shared types used across the app

export type MacroSet = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type Profile = {
  sex?: 'male' | 'female';
  age?: number;
  height_in?: number;
  weight_lbs?: number;
  activity_level?: 'sedentary' | 'light' | 'moderate' | 'very';
};

export type Goal = 'cut' | 'lean' | 'maintain' | 'bulk' | 'recomp' | 'combat' | 'lifestyle';

export type Meal = {
  id: string;
  name?: string;
  meal_summary?: string;
  calories: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
};

export type Day = {
  id: string;
  date: string; // YYYY-MM-DD
  targets?: MacroSet & { label?: string | null; rationale?: string | null } | null;
  // NB: some parts of the app use camelCase, some snake_case in Supabase.
  // Use the camelCase “UI shape” here:
  totals?: { foodCals: number; workoutCals: number; allowance: number; remaining: number } | null;
};

export type DailyTargets = MacroSet & {
  label?: string | null;
  rationale?: string | null;
};

export type MacroStatus = {
  used: number;
  goal: number;
  remaining: number;
  unit: 'kcal' | 'g';
};

export type MacroStatusType = 'under' | 'on' | 'over';
