// components/WorkoutFormModal.tsx
import React, { useState } from 'react';
import { Plus, Clock, Zap, Flame } from 'lucide-react';

type WorkoutData = {
  activity: string;
  minutes?: number;
  intensity?: 'low' | 'moderate' | 'high';
  calories_burned: number;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (workout: WorkoutData) => Promise<void>;
  loading?: boolean;
};

export default function WorkoutFormModal({ isOpen, onClose, onSave, loading = false }: Props) {
  const [activity, setActivity] = useState('');
  const [minutes, setMinutes] = useState<number | ''>('');
  const [intensity, setIntensity] = useState<'low' | 'moderate' | 'high'>('moderate');
  const [calories, setCalories] = useState<number | ''>('');
  const [estimating, setEstimating] = useState(false);

  async function handleEstimateCalories() {
    if (!activity.trim()) return;

    setEstimating(true);
    try {
      // Simple estimation based on activity and duration
      const baseCalories = {
        'running': 10,
        'walking': 5,
        'cycling': 8,
        'swimming': 12,
        'weight': 6,
        'yoga': 3,
        'hiit': 12
      };

      const activityLower = activity.toLowerCase();
      let rate = 8; // default

      for (const [key, value] of Object.entries(baseCalories)) {
        if (activityLower.includes(key)) {
          rate = value;
          break;
        }
      }

      const intensityMultiplier = {
        'low': 0.8,
        'moderate': 1.0,
        'high': 1.3
      };

      const estimatedCalories = Math.round(
        (minutes || 30) * rate * intensityMultiplier[intensity]
      );

      setCalories(estimatedCalories);
    } catch (error) {
      console.error('Error estimating calories:', error);
    } finally {
      setEstimating(false);
    }
  }

  async function handleSave() {
    if (!activity.trim() || !calories) return;

    const workoutData: WorkoutData = {
      activity: activity.trim(),
      minutes: minutes ? Number(minutes) : undefined,
      intensity,
      calories_burned: Number(calories)
    };

    try {
      await onSave(workoutData);
      handleReset();
      onClose();
    } catch (error) {
      console.error('Error saving workout:', error);
    }
  }

  function handleReset() {
    setActivity('');
    setMinutes('');
    setIntensity('moderate');
    setCalories('');
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="text-lg font-semibold">Add Workout</h2>
        </div>

        <div className="p-5 space-y-4">
          {/* Activity */}
          <div>
            <label className="block text-sm font-medium mb-2">Activity</label>
            <input
              type="text"
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              placeholder="e.g., Running, Weight training, Yoga"
              className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Duration and Intensity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2">
                <Clock size={14} className="inline mr-1" />
                Minutes
              </label>
              <input
                type="number"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : '')}
                placeholder="30"
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                <Zap size={14} className="inline mr-1" />
                Intensity
              </label>
              <select
                value={intensity}
                onChange={(e) => setIntensity(e.target.value as 'low' | 'moderate' | 'high')}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          {/* Calories */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">
                <Flame size={14} className="inline mr-1" />
                Calories Burned
              </label>
              <button
                onClick={handleEstimateCalories}
                disabled={!activity.trim() || estimating}
                className="text-xs text-blue-600 hover:text-blue-700 disabled:text-neutral-400 underline"
              >
                {estimating ? 'Estimating...' : 'Estimate'}
              </button>
            </div>
            <input
              type="number"
              value={calories}
              onChange={(e) => setCalories(e.target.value ? Number(e.target.value) : '')}
              placeholder="300"
              className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={!activity.trim() || !calories || loading}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:bg-neutral-400 transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              {loading ? 'Saving...' : 'Add Workout'}
            </button>
            <button
              onClick={() => {
                handleReset();
                onClose();
              }}
              className="px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}