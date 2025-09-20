// components/TargetsView.tsx
import React, { useEffect, useState } from 'react'
import { getCurrentUserId } from '../auth'
import { todayDateString, getDailyTargets, upsertDailyTargets } from '../db'
import type { DailyTargets } from '../types'
import { suggestTargets } from '../utils/suggestTargets'
import { eventBus } from '../lib/eventBus'

export default function TargetsView() {
  const [userId, setUserId] = useState<string | null>(null)
  const [dateStr] = useState<string>(todayDateString())

  // Target fields (blank by default)
  const [calories, setCalories] = useState<string>('')  // blank default
  const [protein, setProtein]   = useState<string>('')  // blank default
  const [carbs, setCarbs]       = useState<string>('')  // blank default
  const [fat, setFat]           = useState<string>('')  // blank default

  // Profile inputs (all optional, blank by default)
  const [sex, setSex] = useState<'' | 'male' | 'female'>('')
  const [age, setAge] = useState<string>('') // years
  const [heightIn, setHeightIn] = useState<string>('') // total inches
  const [weightLbs, setWeightLbs] = useState<string>('') // lbs
  const [activity, setActivity] = useState<'' | 'sedentary' | 'light' | 'moderate' | 'very'>('')
  const [goal, setGoal] = useState<'' | 'cut' | 'recomp' | 'bulk'>('') // burn fat / recomp / bulk

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const id = await getCurrentUserId()
      if (!mounted) return
      setUserId(id)
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const t = await getDailyTargets(userId, dateStr)
        // hydrate if row exists; otherwise remain blank
        if (t) {
          setCalories(t.calories?.toString() ?? '')
          setProtein(t.protein?.toString() ?? '')
          setCarbs(t.carbs?.toString() ?? '')
          setFat(t.fat?.toString() ?? '')
        } else {
          setCalories(''); setProtein(''); setCarbs(''); setFat('')
        }
      } catch (e: any) {
        setError(e?.message ?? 'Failed loading targets')
      } finally {
        setLoading(false)
      }
    })()
  }, [userId, dateStr])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return
    setSaving(true); setError(null); setMessage(null)
    try {
      const payload: DailyTargets = {
        calories: calories ? Number(calories) : 0,
        protein:  protein ? Number(protein) : null,
        carbs:    carbs ? Number(carbs) : null,
        fat:      fat ? Number(fat) : null,
      }
      await upsertDailyTargets(userId, dateStr, payload)
      setMessage('Targets saved to Current Goal Targets for today.')
      // notify TodayView immediately
      eventBus.emit('targets:update', payload)
    } catch (e: any) {
      setError(e?.message ?? 'Could not save targets')
    } finally {
      setSaving(false)
    }
  }

  async function handleSuggest() {
    if (!userId) return
    setSaving(true); setError(null); setMessage(null)
    try {
      const s = await suggestTargets({
        sex: sex || undefined,
        age: age ? Number(age) : undefined,
        heightIn: heightIn ? Number(heightIn) : undefined,
        weightLbs: weightLbs ? Number(weightLbs) : undefined,
        activity: activity || undefined,
        goal: goal || undefined,
      })

      // 1) put into form
      setCalories(s.calories?.toString() ?? '')
      setProtein(s.protein?.toString() ?? '')
      setCarbs(s.carbs?.toString() ?? '')
      setFat(s.fat?.toString() ?? '')

      // 2) write into today's Current Goal Targets
      const payload: DailyTargets = {
        calories: s.calories ?? 0,
        protein:  s.protein ?? null,
        carbs:    s.carbs ?? null,
        fat:      s.fat ?? null,
      }
      await upsertDailyTargets(userId, dateStr, payload)
      setMessage('Suggested targets applied to Current Goal Targets for today.')

      // notify TodayView immediately
      eventBus.emit('targets:update', payload)
    } catch (e: any) {
      setError(e?.message ?? 'Could not suggest targets')
    } finally {
      setSaving(false)
    }
  }

  if (!userId) return <div className="p-4">Please sign in to set targets.</div>
  if (loading) return <div className="p-4">Loading…</div>

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-xl font-semibold">Current Goal Targets</h2>

      {/* Profile inputs (optional, blank by default) */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Select label="Sex" value={sex} onChange={v => setSex(v as any)} options={[
          { value: '', label: '—' },
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
        ]} />
        <Input label="Age (years)" value={age} onChange={setAge} placeholder="e.g., 34" />
        <Input label="Height (inches)" value={heightIn} onChange={setHeightIn} placeholder="e.g., 70" />
        <Input label="Weight (lbs)" value={weightLbs} onChange={setWeightLbs} placeholder="e.g., 190" />
        <Select label="Activity" value={activity} onChange={v => setActivity(v as any)} options={[
          { value: '', label: '—' },
          { value: 'sedentary', label: 'Sedentary' },
          { value: 'light', label: 'Light' },
          { value: 'moderate', label: 'Moderate' },
          { value: 'very', label: 'Very active' },
        ]} />
        <Select label="Goal" value={goal} onChange={v => setGoal(v as any)} options={[
          { value: '', label: '—' },
          { value: 'cut', label: 'Burn fat (cut)' },
          { value: 'recomp', label: 'Gain muscle while burning fat (recomp)' },
          { value: 'bulk', label: 'Gain muscle (bulk)' },
        ]} />
      </div>

      {/* Targets form */}
      <form onSubmit={handleSave} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 max-w-4xl">
        <Input label="Calories" value={calories} onChange={setCalories} placeholder="e.g., 2400" />
        <Input label="Protein (g)" value={protein} onChange={setProtein} placeholder="e.g., 180" />
        <Input label="Carbs (g)" value={carbs} onChange={setCarbs} placeholder="e.g., 220" />
        <Input label="Fat (g)" value={fat} onChange={setFat} placeholder="e.g., 70" />

        <div className="col-span-full flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={handleSuggest}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-gray-900 text-white"
          >
            {saving ? 'Working…' : 'AI Suggest Targets'}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-gray-200"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {message && <p className="col-span-full text-green-700 text-sm">{message}</p>}
        {error && <p className="col-span-full text-red-600 text-sm">{error}</p>}
      </form>

      <p className="text-xs text-gray-500">
        Leave profile fields blank if you want quick defaults. AI uses Mifflin–St&nbsp;Jeor → activity multiplier → goal adjustment,
        and allocates macros (higher protein for cut/recomp).
      </p>
    </div>
  )
}

function Input({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-sm mb-1 text-gray-700">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="numeric"
        className="w-full p-2 border rounded-xl"
      />
    </label>
  )
}

function Select({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: {value: string; label: string}[]
}) {
  return (
    <label className="block">
      <span className="block text-sm mb-1 text-gray-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-2 border rounded-xl bg-white"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
