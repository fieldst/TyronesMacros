// components/PlanWeekModal.tsx
import React, { useMemo, useState } from 'react';
import Modal from './Modal';
import { planWeek, PlanWeekOptions } from '../services/openaiService';

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const;

export default function PlanWeekModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (plan: any) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [style, setStyle] = useState<PlanWeekOptions['style']>('HIIT');
  const [goal, setGoal] = useState<PlanWeekOptions['goal']>('lean');
  const [minutes, setMinutes] = useState(30);
  const [experience, setExperience] = useState<PlanWeekOptions['experience']>('intermediate');
  const [equipmentInput, setEquipmentInput] = useState('assault bike, kettlebell, dumbbells');
  const [days, setDays] = useState<string[]>(['Mon','Wed','Fri']);

  const equipment = useMemo(
    () => equipmentInput.split(',').map(s => s.trim()).filter(Boolean),
    [equipmentInput]
  );

  function toggleDay(d: string) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

    async function handleGenerate() {
    setLoading(true); setError(null);
    try {
      const payload: PlanWeekOptions = {
        goal,
        style,
        availableDays: days as any,
        minutesPerSession: minutes,
        equipment,
        experience,
      };
      const res = await planWeek(payload);
      onSaved(res);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate');
    } finally {
      setLoading(false);
    }
  }

  return (
  <Modal isOpen={open} onClose={loading ? () => {} : onClose} title="Plan my week">

      {/* make the panel relatively positioned so the overlay can cover it */}
      <div className="relative p-4">
        {/* polite status for screen readers */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {loading ? 'Generating your weekly plan…' : ''}
        </div>

        {/* translucent overlay + spinner when loading */}
        {loading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 rounded-2xl">
            <span
              className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent"
              aria-hidden="true"
            />
          </div>
        )}

        {/* disable all inputs while loading */}
        <fieldset disabled={loading} aria-busy={loading} className={loading ? 'opacity-60' : ''}>
          {/* ...inputs... (leave your existing inputs untouched) */}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
            >
              Close
            </button>

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black disabled:opacity-60 inline-flex items-center gap-2"
            >
              {loading && (
                <span
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
              )}
              {loading ? 'Generating…' : 'Generate plan'}
            </button>
          </div>
          {error && (
  <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
    {error}
  </div>
)}

        </fieldset>
      </div>
    </Modal>
  );

}
