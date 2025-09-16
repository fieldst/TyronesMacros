import type { Day, Meal, MacroSet, Profile } from './types';

export const DEFAULT_TARGETS: MacroSet = {
  calories: 2200,
  protein: 170,
  carbs: 210,
  fat: 60,
};

export const DEFAULT_PROFILE: Profile = {
  weight_lbs: null,
  height_in: null,
  age: null,
  sex: '',
  activity: '',
};

export const INITIAL_DAYS: Day[] = [
  {
    date: '2025-09-09',
    targets: { ...DEFAULT_TARGETS },
    workoutLogged: '',
    workoutKcal: 0,
    swapSuggestions: '',
  },
  {
    date: '2025-09-10',
    targets: { ...DEFAULT_TARGETS },
    workoutLogged: '',
    workoutKcal: 0,
    swapSuggestions: '',
  },
];

export const INITIAL_MEALS: Meal[] = [
  {
    id: 'seed-1',
    date: '2025-09-09',
    mealType: 'Lunch',
    mealSummary: 'Salmon 250g, risotto 1 cup, veggies 1 cup',
    macros: { calories: 710, protein: 63, carbs: 57, fat: 21 },
  },
];

export const WORKOUT_CHIPS = [
  'Sprint 8',
  '1 mile jog',
  'Push-ups',
  'Pull-ups',
  'Squats',
  'Deadlifts',
];
