// components/HistoryView.tsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from '../auth';

type HistoryEntry = {
  id: string;
  date: string;
  note?: string;
  targets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    label?: string;
    rationale?: string;
  };
  workout_kcal?: number;
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function HistoryView() {
  const [userId, setUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const id = await getCurrentUserId();
      setUserId(id);

      if (id) {
        const { data, error } = await supabase
          .from('days')
          .select('id, date, targets, workout_kcal')
          .eq('user_id', id)
          .order('date', { ascending: false })
          .limit(60); // show more; container will scroll

        if (!error && data) {
          setEntries(data as any);
        }
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="text-center text-neutral-600 dark:text-neutral-300 py-10">
        Loading history…
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className="text-center text-neutral-600 dark:text-neutral-300 py-10">
        No history yet.
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">History</h1>

        {/* Scroll container */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="max-h-[70vh] overflow-y-auto">
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {entries.map((e) => (
                <li key={e.id} className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                      {formatDate(e.date)}
                    </div>
                    {e.targets?.label && (
                      <span className="ml-2 px-2 py-1 text-xs rounded-lg bg-purple-600 text-white">
                        {e.targets.label}
                      </span>
                    )}
                  </div>

                  {e.targets ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                      <Metric title="Calories" value={e.targets.calories} unit="kcal" />
                      <Metric title="Protein" value={e.targets.protein} unit="g" />
                      <Metric title="Carbs" value={e.targets.carbs} unit="g" />
                      <Metric title="Fat" value={e.targets.fat} unit="g" />
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-800 dark:text-neutral-200 mt-2">
                      No targets logged
                    </div>
                  )}

                  {typeof e.workout_kcal === 'number' && (
                    <div className="text-xs text-neutral-700 dark:text-neutral-300 mt-2">
                      Workout: +{e.workout_kcal} kcal
                    </div>
                  )}

                  {e.targets?.rationale && (
                    <div className="mt-2 text-xs text-neutral-800 dark:text-neutral-300 whitespace-pre-wrap">
                      {e.targets.rationale}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}

function Metric({ title, value, unit }: { title: string; value: number; unit: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-xs text-neutral-700 dark:text-neutral-400">{title}</div>
      <div className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">
        {Math.round(value)} <span className="text-sm font-medium">{unit}</span>
      </div>
    </div>
  );
}
