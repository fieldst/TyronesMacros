import type { Day, Meal } from '../types';

function downloadCSV(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportDaysToCSV(days: Day[]) {
  const header = 'date,calories,protein,carbs,fat,workoutKcal,workoutLogged,swapSuggestions';
  const rows = days.map(d =>
    [
      d.date,
      d.targets.calories,
      d.targets.protein,
      d.targets.carbs,
      d.targets.fat,
      d.workoutKcal || 0,
      JSON.stringify(d.workoutLogged || ''),
      JSON.stringify(d.swapSuggestions || ''),
    ].join(',')
  );
  downloadCSV([header, ...rows].join('\n'), 'days.csv');
}

export function exportMealsToCSV(meals: Meal[]) {
  const header = 'id,date,type,summary,calories,protein,carbs,fat';
  const rows = meals.map(m =>
    [
      m.id,
      m.date,
      m.mealType,
      JSON.stringify(m.mealSummary),
      m.macros.calories,
      m.macros.protein,
      m.macros.carbs,
      m.macros.fat,
    ].join(',')
  );
  downloadCSV([header, ...rows].join('\n'), 'meals.csv');
}
