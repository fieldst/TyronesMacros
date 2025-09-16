export interface MacroSet {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Profile {
  weight_lbs: number | null;
  height_in: number | null;
  age: number | null;
  sex: 'Male' | 'Female' | '';
  activity: '' | 'Sedentary' | 'Lightly active' | 'Moderately active' | 'Very active';
}

export interface Day {
  date: string; // YYYY-MM-DD
  targets: MacroSet;
  workoutLogged: string;
  workoutKcal: number;
  swapSuggestions: string;
}

export type MealType = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';

export interface Meal {
  id: string;
  date: string; // YYYY-MM-DD
  mealType: MealType;
  mealSummary: string;
  macros: MacroSet;
}

export type MacroStatusType = 'on-target' | 'over' | 'under';

export interface MacroStatus {
  calories: MacroStatusType;
  protein: MacroStatusType;
  carbs: MacroStatusType;
  fat: MacroStatusType;
}

export type AppView = 'today' | 'history' | 'targets';

export type Goal = 'maintain' | 'cut_0_5' | 'recomp' | 'gain_0_25';
