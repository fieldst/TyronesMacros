// components/SavedWorkouts.tsx
import React, { useEffect, useState } from "react";
import {
  listSavedWorkouts,
  saveWorkoutPlan,
  removeSavedWorkout,
  addSavedToToday,
  SavedWorkout,
} from "../services/savedWorkoutsService";
import { eventBus } from "../lib/eventBus";

type Props = {
  initialPlanToSave?: any; // optional plan passed in via navigation state
};

export default function SavedWorkouts(_props: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SavedWorkout[]>([]);
  const [saveName, setSaveName] = useState("");
  const [savePlan, setSavePlan] = useState({ items: [] }); // keep structure; no JSON typing needed
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listSavedWorkouts();
      setItems(rows);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load saved workouts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onSave = async () => {
    setError(null);
    setMessage(null);
    try {
      if (!saveName.trim()) throw new Error("Please enter a name.");
      const saved = await saveWorkoutPlan(saveName.trim(), savePlan);
      setMessage(`Saved "${saved.name}"`);
      setSaveName("");
      setSavePlan({ items: [] });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Could not save workout.");
    }
  };

  const onRemove = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      await removeSavedWorkout(id);
      setMessage("Removed.");
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Could not remove workout.");
    }
  };

  const onAddToToday = async (sw: SavedWorkout) => {
    setError(null);
    setMessage(null);
    try {
      const { inserted } = await addSavedToToday(sw);
      setMessage(`Added ${inserted} item(s) to Today.`);
      // Notify TodayView to recalc
      eventBus.emit("day:totals", {});
    } catch (e: any) {
      setError(e?.message ?? "Failed to add to Today.");
    }
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-3">Saved Workouts</h1>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        Save up to <b>10</b> workouts. You can add a saved workout to Today at any time.
      </p>

      {error && <div className="mb-3 text-red-600 dark:text-red-400">{error}</div>}
      {message && <div className="mb-3 text-green-700 dark:text-green-400">{message}</div>}

      {/* Save a workout */}
      <div className="rounded-2xl p-4 border border-gray-200 dark:border-gray-700 mb-6">
        <h2 className="text-lg font-medium mb-2">Save a workout</h2>
        <input
          className="w-full mb-2 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700"
          placeholder="Workout name (e.g., 'Leg Day – 30 min')"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <p className="text-sm opacity-80 mb-2">
          Add your own workout and press <span className="font-semibold">Save workout</span>.
          
        </p>

        {/* Keep a hidden textarea so we don’t refactor any save logic elsewhere */}
        <textarea
          className="hidden"
          value={JSON.stringify(savePlan ?? { items: [] })}
          readOnly
          aria-hidden="true"
        />

        <div className="flex gap-2">
          <button
            onClick={onSave}
            className="px-4 py-2 rounded-xl bg-purple-600 text-white hover:bg-purple-700"
          >
            Save workout
          </button>
          <button
            onClick={() => {
              setSaveName("");
              setSavePlan({ items: [] });
            }}
            className="px-4 py-2 rounded-xl bg-gray-200 dark:bg-gray-800"
          >
            Clear
          </button>
        </div>
      </div>

      <h2 className="text-lg font-medium mb-3">Your saved workouts</h2>
      {loading ? (
        <div>Loading…</div>
      ) : !items.length ? (
        <div className="text-gray-600 dark:text-gray-300">No saved workouts yet.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((sw) => (
            <li key={sw.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{sw.name}</div>
                <div className="text-xs text-gray-500">
                  {new Date(sw.created_at || "").toLocaleString()}
                </div>
              </div>

              <details className="mb-3">
                <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-400">
                  Show Workout
                </summary>

                <div className="mt-2 text-sm">
                  {(() => {
                    // Avoid TypeScript annotations in this IIFE for compatibility
                    const planObj = sw && sw.plan ? sw.plan : {};
                    const blocks = Array.isArray(planObj.blocks) ? planObj.blocks : [];
                    const simpleItems = Array.isArray(planObj.items) ? planObj.items : [];

                    if (blocks.length) {
                      return (
                        <div className="mt-2 space-y-3">
                          {blocks.map((b: any, idx: number) => (
                            <div
                              key={idx}
                              className="rounded-xl border border-gray-200 dark:border-white/10 p-3"
                            >
                              <div className="text-[11px] uppercase tracking-wide opacity-70 mb-1">
                                {b && b.kind ? b.kind : "Block"}
                              </div>

                              {/* Main line */}
                              <div className="text-sm font-medium">
                                {b && (b.text || b.name) ? (b.text || b.name) : `Block ${idx + 1}`}
                              </div>

                              {/* Meta line */}
                              <div className="text-xs opacity-80 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                {typeof b?.minutes === "number" && <span>{b.minutes} min</span>}
                                {b && b.loadRx && <span>Load: {b.loadRx}</span>}
                                {b && Array.isArray(b.equipment) && b.equipment.length > 0 && (
                                  <span>Eq: {b.equipment.join(", ")}</span>
                                )}
                                {b && b.coach && <span>Coach: {b.coach}</span>}
                                {b && b.scale && <span>Scale: {b.scale}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    if (simpleItems.length) {
                      return (
                        <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
                          {simpleItems.map((it: any, i: number) => (
                            <li key={i} className="leading-6">
                              <span className="font-medium">
                                {it && (it.activity || it.name) ? (it.activity || it.name) : `Item ${i + 1}`}
                              </span>
                              {typeof it?.minutes === "number" && <span> · {it.minutes} min</span>}
                              {typeof it?.calories_burned === "number" && (
                                <span> · {it.calories_burned} kcal</span>
                              )}
                              {it && it.sets && it.reps && <span> · {it.sets}×{it.reps}</span>}
                              {it && it.notes && <div className="opacity-80 text-xs">{it.notes}</div>}
                            </li>
                          ))}
                        </ul>
                      );
                    }

                    // Fallback – show the raw JSON only if we can't parse a known shape
                    return (
                      <pre className="mt-2 text-xs overflow-auto bg-gray-50 dark:bg-gray-900 p-2 rounded-xl">
                        {JSON.stringify(planObj, null, 2)}
                      </pre>
                    );
                  })()}
                </div>
              </details>

              <div className="flex gap-2">
                <button
                  onClick={() => onAddToToday(sw)}
                  className="px-4 py-2 rounded-xl bg-green-600 text-white hover:bg-green-700"
                >
                  Add to Today
                </button>
                <button
                  onClick={() => onRemove(sw.id)}
                  className="px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
