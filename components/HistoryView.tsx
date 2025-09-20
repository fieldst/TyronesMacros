// components/HistoryView.tsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from '../auth';

type DayView = {
  date: string;
  meals: { text: string; cal: number; p: number; c: number; f: number }[];
  workout_kcal: number;
};

export default function HistoryView() {
  const [userId, setUserId] = useState<string | null>(null);
  const [days, setDays] = useState<DayView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const id = await getCurrentUserId();
      setUserId(id);
      if (!id) { setLoading(false); return; }

      // meals last 14 days
      const from = new Date(); from.setDate(from.getDate() - 14);
      const fromIso = from.toISOString().slice(0,10);

      const { data: meals } = await supabase
        .from('meals')
        .select('date, meal_summary, calories, protein, carbs, fat')
        .eq('user_id', id)
        .gte('date', fromIso)
        .order('date', { ascending: false });

      // days with workouts
      const { data: dayRows } = await supabase
        .from('days')
        .select('date, workout_kcal')
        .eq('user_id', id)
        .gte('date', fromIso);

      const workoutMap = new Map<string, number>();
      (dayRows as any[] || []).forEach(d => workoutMap.set(d.date, d.workout_kcal || 0));

      const map = new Map<string, DayView>();
      (meals as any[] || []).forEach(m => {
        const d = m.date as string;
        if (!map.has(d)) map.set(d, { date: d, meals: [], workout_kcal: workoutMap.get(d) || 0 });
        map.get(d)!.meals.push({
          text: m.meal_summary,
          cal: m.calories, p: m.protein, c: m.carbs, f: m.fat
        });
      });
      // ensure workout-only days still show
      for (const [d, kcal] of workoutMap) {
        if (!map.has(d)) map.set(d, { date: d, meals: [], workout_kcal: kcal });
      }

      const list = Array.from(map.values()).sort((a,b) => (a.date < b.date ? 1 : -1));
      setDays(list);
      setLoading(false);
    })();
  }, []);

  if (!userId) return <div className="text-sm text-gray-600">Sign in to view history.</div>;
  if (loading) return <div>Loading…</div>;
  if (!days.length) return <div className="text-sm text-gray-600">No history for the last 14 days.</div>;

  return (
    <div className="space-y-4">
      {days.map(day => {
        const totals = day.meals.reduce((acc, m) => ({
          cal: acc.cal + m.cal, p: acc.p + m.p, c: acc.c + m.c, f: acc.f + m.f
        }), { cal: 0, p: 0, c: 0, f: 0 });
        const net = Math.max(0, totals.cal - (day.workout_kcal || 0));

        return (
          <div key={day.date} className="rounded border bg-white">
            <div className="p-3 border-b font-semibold">{day.date}</div>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-2">Meals</div>
                <ul className="text-sm space-y-1">
                  {day.meals.map((m, i) => (
                    <li key={i} className="flex justify-between border-b py-1">
                      <span className="pr-2">{m.text}</span>
                      <span className="text-gray-600">{m.cal} cal • P{m.p}/C{m.c}/F{m.f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-sm font-medium mb-2">Workout</div>
                <div className="text-sm text-gray-700">
                  Burn: {day.workout_kcal || 0} cal
                </div>
              </div>
            </div>
            <div className="px-3 pb-3 text-sm text-gray-700">
              Day totals: {totals.cal} cal (P{totals.p}/C{totals.c}/F{totals.f}) • Burn: {day.workout_kcal || 0} → Net: {net} cal
            </div>
          </div>
        );
      })}
    </div>
  );
}
