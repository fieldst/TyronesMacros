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
    <Modal isOpen={open} onClose={onClose} title="Plan your week">
      <div className="space-y-4 text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900">
        {error && <div className="text-red-600 dark:text-red-400 text-sm">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-sm">
            Style
            <select
              className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 border-neutral-200 dark:border-neutral-800"
              value={style}
              onChange={e=>setStyle(e.target.value as any)}
            >
              <option>HIIT</option>
              <option>cardio</option>
              <option>strength+cardio</option>
              <option>CrossFit</option>
            </select>
          </label>
          <label className="flex flex-col text-sm">
            Goal
            <select
              className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 border-neutral-200 dark:border-neutral-800"
              value={goal}
              onChange={e=>setGoal(e.target.value as any)}
            >
              <option>cut</option>
              <option>lean</option>
              <option>maintain</option>
              <option>bulk</option>
            </select>
          </label>
          <label className="flex flex-col text-sm">
            Minutes per session
            <input
              type="number"
              min={15}
              max={120}
              className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 border-neutral-200 dark:border-neutral-800"
              value={minutes}
              onChange={e=>setMinutes(parseInt(e.target.value || '30'))}
            />
          </label>
          <label className="flex flex-col text-sm">
            Experience
            <select
              className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 border-neutral-200 dark:border-neutral-800"
              value={experience}
              onChange={e=>setExperience(e.target.value as any)}
            >
              <option>beginner</option>
              <option>intermediate</option>
              <option>advanced</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col text-sm">
            Equipment (comma-separated)
            <input
              className="mt-1 rounded-xl border p-2 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 border-neutral-200 dark:border-neutral-800"
              value={equipmentInput}
              onChange={e=>setEquipmentInput(e.target.value)}
              placeholder="assault bike, kettlebell, dumbbells, barbell"
            />
          </label>
          <div className="col-span-2">
            <div className="text-sm mb-1">Available days</div>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(d => {
                const active = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={[
                      'px-3 py-1 rounded-full border',
                      'border-neutral-200 dark:border-neutral-800',
                      active
                        ? 'bg-black text-white dark:bg-white dark:text-black'
                        : 'bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100'
                    ].join(' ')}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black disabled:opacity-60"
            disabled={loading}
            onClick={handleGenerate}
          >
            {loading ? 'Generating…' : 'Generate plan'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
