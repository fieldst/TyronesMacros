// pages/TargetsView.tsx
import React, { useState } from 'react';

export default function TargetsView() {
  const [targets, setTargets] = useState({
    calories: 2200,
    protein: 170,
    carbs: 210,
    fat: 60
  });

  return (
    <div className="min-h-[100svh] w-full bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-4xl px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">Daily Targets</h1>

        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Calories</label>
              <input
                type="number"
                value={targets.calories}
                onChange={(e) => setTargets(prev => ({ ...prev, calories: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Protein (g)</label>
              <input
                type="number"
                value={targets.protein}
                onChange={(e) => setTargets(prev => ({ ...prev, protein: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Carbs (g)</label>
              <input
                type="number"
                value={targets.carbs}
                onChange={(e) => setTargets(prev => ({ ...prev, carbs: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Fat (g)</label>
              <input
                type="number"
                value={targets.fat}
                onChange={(e) => setTargets(prev => ({ ...prev, fat: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={() => console.log('Save targets:', targets)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
            >
              Save Targets
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}