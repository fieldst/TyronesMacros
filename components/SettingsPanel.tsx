import React, { useEffect, useState } from 'react';

export default function SettingsPanel() {
  const [strictMeals, setStrictMeals] = useState(true);
  const [strictWorkouts, setStrictWorkouts] = useState(true);
  const [coachOnMealAdd, setCoachOnMealAdd] = useState(true);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('strictness') || '{}');
      setStrictMeals(saved.strictMeals ?? true);
      setStrictWorkouts(saved.strictWorkouts ?? true);
      setCoachOnMealAdd(saved.coachOnMealAdd ?? true);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem('strictness', JSON.stringify({ strictMeals, strictWorkouts, coachOnMealAdd }));
  }, [strictMeals, strictWorkouts, coachOnMealAdd]);

  return (
    <div className="flex items-center gap-4 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={strictMeals} onChange={e => setStrictMeals(e.target.checked)} />
        Strict JSON for Meal Macros
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={strictWorkouts} onChange={e => setStrictWorkouts(e.target.checked)} />
        Strict JSON for Workout Calories
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={coachOnMealAdd} onChange={e => setCoachOnMealAdd(e.target.checked)} />
        Show Coaching After Meal Add
      </label>
    </div>
  );
}