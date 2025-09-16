import { useMemo } from 'react';
import type { Day, Meal, MacroSet, MacroStatus, MacroStatusType } from '../types';

function clamp(n: number) {
  return Math.max(0, Math.round(n));
}

function statusOf(remaining: number): MacroStatusType {
  if (remaining === 0) return 'on-target';
  return remaining > 0 ? 'under' : 'over';
}

export function useMacroCalculations(today: Day | undefined, mealsToday: Meal[]) {
  return useMemo(() => {
    const eaten = mealsToday.reduce<MacroSet>(
      (acc, m) => ({
        calories: acc.calories + (m.macros.calories || 0),
        protein: acc.protein + (m.macros.protein || 0),
        carbs: acc.carbs + (m.macros.carbs || 0),
        fat: acc.fat + (m.macros.fat || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    const targets = today?.targets ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };

    // Subtract workout calories (if any) from remaining calories
    const remaining: MacroSet = {
      calories: Math.round((targets.calories || 0) - eaten.calories - (today?.workoutKcal || 0) * -1), // if workouts add calories back, flip sign as needed
      protein: Math.round((targets.protein || 0) - eaten.protein),
      carbs: Math.round((targets.carbs || 0) - eaten.carbs),
      fat: Math.round((targets.fat || 0) - eaten.fat),
    };

    const statuses: MacroStatus = {
      calories: statusOf(remaining.calories),
      protein: statusOf(remaining.protein),
      carbs: statusOf(remaining.carbs),
      fat: statusOf(remaining.fat),
    };

    return { eaten, remaining, statuses };
  }, [today, mealsToday]);
}
