// components/HistoryView.tsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from '../auth';

type Totals = {
  foodCals?: number;     // Eating (kcal)
  workoutCals?: number;  // Burn (kcal)
  allowance?: number;    // Goal calories + workout
  remaining?: number;    // allowance - foodCals
  protein?: number;      // EATEN grams (from food_entries)
  carbs?: number;        // EATEN grams
  fat?: number;          // EATEN grams
};

type Targets = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  label?: string;
  rationale?: string;
};

type HistoryEntry = {
  id: string;
  date: string;              // 'YYYY-MM-DD' (stored as text in your DB)
  targets: Targets | null;
  totals: Totals | null;
};

function formatDate(dateStr: string) {
  // dateStr is 'YYYY-MM-DD' (text)
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function Metric({ title, value, unit }: { title: string; value: number | null | undefined; unit: string }) {
  const n = typeof value === 'number' ? Math.round(value) : null;
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-xs text-neutral-700 dark:text-neutral-400">{title}</div>
      <div className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">
        {n !== null ? n : '—'} <span className="text-sm font-medium">{unit}</span>
      </div>
    </div>
  );
}

export default function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const id = await getCurrentUserId();
        if (!id) {
          if (alive) setLoading(false);
          return;
        }

        // Pull days with both targets and totals
        const { data, error } = await supabase
          .from('days')
          .select('id, date, targets, totals')
          .eq('user_id', id)                    // keep if not relying purely on RLS
          .order('date', { ascending: false }); // text 'YYYY-MM-DD' sorts fine

        if (error) {
          console.error('History fetch error:', error);
          if (alive) setLoading(false);
          return;
        }

        const mapped: HistoryEntry[] = (data ?? []).map((d: any) => ({
          id: String(d.id),
          date: String(d.date),
          targets: d.targets ?? null,
          totals: d.totals ?? null,
        }));

        if (alive) {
          setEntries(mapped);
          setLoading(false);
        }
      } catch (err) {
        console.error('History load failed:', err);
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
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

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="max-h-[70vh] overflow-y-auto">
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {entries.map((e) => {
                const t = e.targets || ({} as Targets);
                const z = e.totals  || ({} as Totals);

                return (
                  <li key={e.id} className="p-4">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                        {formatDate(e.date)}
                      </div>
                      {t?.label && (
                        <span className="ml-2 px-2 py-1 text-xs rounded-lg bg-purple-600 text-white">
                          {t.label}
                        </span>
                      )}
                    </div>

                    {/* Goals */}
                    <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mt-2 mb-1">
                      Goals
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Metric title="Calories" value={t?.calories ?? 0} unit="kcal" />
                      <Metric title="Protein"  value={t?.protein  ?? 0} unit="g" />
                      <Metric title="Carbs"    value={t?.carbs    ?? 0} unit="g" />
                      <Metric title="Fat"      value={t?.fat      ?? 0} unit="g" />
                    </div>

                    {/* Actuals */}
                    <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mt-4 mb-1">
                      Actuals
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Metric title="Eating"    value={z?.foodCals    ?? 0} unit="kcal" />
                      <Metric title="Burn"      value={z?.workoutCals ?? 0} unit="kcal" />
                      <Metric title="Allowance" value={z?.allowance   ?? (t?.calories ?? 0)} unit="kcal" />
                      <Metric title="Remaining" value={z?.remaining   ?? null} unit="kcal" />
                    </div>

                    {/* Macros eaten (grams) */}
                    <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mt-4 mb-1">
                      Macros Eaten
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Metric title="Protein (eating)" value={z?.protein ?? null} unit="g" />
                      <Metric title="Carbs (eating)"   value={z?.carbs   ?? null} unit="g" />
                      <Metric title="Fat (eating)"     value={z?.fat     ?? null} unit="g" />
                    </div>

                    {/* Workout summary at bottom */}
                    <div className="text-xs text-neutral-700 dark:text-neutral-300 mt-3">
                      Workout: +{Math.round(z?.workoutCals ?? 0)} kcal
                    </div>

                    {/* Optional rationale */}
                    {t?.rationale && (
                      <div className="mt-2 text-xs text-neutral-800 dark:text-neutral-300 whitespace-pre-wrap">
                        {t.rationale}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}
