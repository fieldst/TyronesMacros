// components/TargetsView.tsx
import React, { useEffect, useState } from 'react'
import { getCurrentUserId } from '../auth'
import { todayDateString, getDailyTargets, upsertDailyTargets } from '../db'
import type { DailyTargets } from '../types'
import { suggestTargets, type SuggestTargetsResult } from '../utils/suggestTargets'
import { eventBus } from '../lib/eventBus'
import { supabase } from '../supabaseClient'

export default function TargetsView() {
  const [userId, setUserId] = useState<string | null>(null)
  const [dateStr] = useState<string>(todayDateString())

  // Target fields
  const [calories, setCalories] = useState<string>('')
  const [protein, setProtein]   = useState<string>('')
  const [carbs, setCarbs]       = useState<string>('')
  const [fat, setFat]           = useState<string>('')

  // Optional profile
  const [sex, setSex] = useState<'' | 'male' | 'female'>('')
  const [age, setAge] = useState<string>('') // years
  const [heightIn, setHeightIn] = useState<string>('') // inches
  const [weightLbs, setWeightLbs] = useState<string>('') // lbs
  const [activity, setActivity] = useState<'' | 'sedentary' | 'light' | 'moderate' | 'very'>('')
  const [goalText, setGoalText] = useState<string>('') // free-text

  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // AI Coach output
  const [coachText, setCoachText] = useState<string | null>(null)
  const [coachLabel, setCoachLabel] = useState<string | null>(null)

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
        const t: any = await getDailyTargets(userId, dateStr)
        if (t) {
          setCalories(t.calories?.toString() ?? '')
          setProtein(t.protein?.toString() ?? '')
          setCarbs(t.carbs?.toString() ?? '')
          setFat(t.fat?.toString() ?? '')
        } else {
          setCalories(''); setProtein(''); setCarbs(''); setFat('')
        }
        setCoachText(null); setCoachLabel(null)
      } catch (e: any) {
        setError(e?.message ?? 'Failed loading targets')
      } finally {
        setLoading(false)
      }
    })()
  }, [userId, dateStr])

  async function handleSuggest() {
    if (!userId) return
    setWorking(true); setError(null); setMessage(null)
    try {
      const s: SuggestTargetsResult = await suggestTargets({
        sex: sex || undefined,
        age: age ? Number(age) : undefined,
        heightIn: heightIn ? Number(heightIn) : undefined,
        weightLbs: weightLbs ? Number(weightLbs) : undefined,
        activity: activity || undefined,
        goal: undefined,
        goalText: goalText?.trim() || undefined,
      })

      setCalories((s.calories ?? '').toString())
      setProtein((s.protein ?? '').toString())
      setCarbs((s.carbs ?? '').toString())
      setFat((s.fat ?? '').toString())

      setCoachLabel((s.label || 'LEAN').toUpperCase())
      setCoachText(s.rationale || 'AI Coach could not generate an explanation.')
      setMessage('Review the suggestion, then tap “Use this target”.')
    } catch (e: any) {
      setError(e?.message ?? 'Could not suggest targets')
    } finally {
      setWorking(false)
    }
  }

  function toDailyTargets(): DailyTargets {
    return {
      calories: calories ? Number(calories) : 0,
      protein:  protein ? Number(protein) : null,
      carbs:    carbs ? Number(carbs) : null,
      fat:      fat ? Number(fat) : null,
    }
  }

  async function saveLabelAndRationaleJSON(macros: DailyTargets, label?: string | null, rationale?: string | null) {
    if (!userId) return
    const { data: existing } = await supabase
      .from('days')
      .select('id')
      .eq('user_id', userId)
      .eq('date', dateStr)

    const targetsJSON = { ...macros, ...(label ? { label } : {}), ...(rationale ? { rationale } : {}) }

    if (existing && existing.length > 0) {
      await supabase
        .from('days')
        .update({ targets: targetsJSON, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('date', dateStr)
    } else {
      await supabase
        .from('days')
        .insert({ user_id: userId, date: dateStr, targets: targetsJSON })
    }
  }

  async function handleUseTarget() {
    if (!userId) return
    setWorking(true); setError(null); setMessage(null)
    try {
      const macros = toDailyTargets()
      await upsertDailyTargets(userId, dateStr, macros) // ONLY macros -> daily_targets
      await saveLabelAndRationaleJSON(macros, coachLabel || 'LEAN', coachText || undefined) // label+rationale -> days.targets

      // Tell TodayView (includes label & rationale)
      eventBus.emit('targets:update', { ...macros, label: coachLabel || 'LEAN', rationale: coachText || undefined })
      setMessage('Targets applied to Current Goal Targets for today.')
    } catch (e: any) {
      setError(e?.message ?? 'Could not apply targets')
    } finally {
      setWorking(false)
    }
  }

  if (!userId) return <div className="p-4">Please sign in to set targets.</div>
  if (loading) return <div className="p-4">Loading…</div>

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-xl font-semibold">Current Goal Targets</h2>

      {/* Profile inputs */}
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
        <div className="sm:col-span-3 lg:col-span-3">
          <span className="block text-sm mb-1 text-gray-700 dark:text-gray-200">Tell us your goal (free text)</span>
          <textarea
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            placeholder="e.g., Drop ~10 lbs in 8–10 weeks while keeping strength. I lift 4x/week and walk 8k steps/day."
            rows={3}
            className="w-full p-2 border rounded-xl bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700"
          />
        </div>
      </div>

      {/* Target fields */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 max-w-4xl">
        <Input label="Calories" value={calories} onChange={setCalories} placeholder="e.g., 2400" />
        <Input label="Protein (g)" value={protein} onChange={setProtein} placeholder="e.g., 180" />
        <Input label="Carbs (g)" value={carbs} onChange={setCarbs} placeholder="e.g., 220" />
        <Input label="Fat (g)" value={fat} onChange={setFat} placeholder="e.g., 70" />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={handleSuggest}
          disabled={working}
          className="px-4 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
        >
          {working ? 'Working…' : 'AI Suggest Targets'}
        </button>
        <button
          type="button"
          onClick={handleUseTarget}
          disabled={working || (!calories && !protein && !carbs && !fat)}
          className="px-4 py-2 rounded-xl bg-emerald-600 text-white"
        >
          {working ? 'Applying…' : 'Use this target'}
        </button>
      </div>

      {/* AI Coach card */}
      {(coachText || coachLabel) && (
        <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-3">
          <div className="flex items-center gap-2 mb-1">
            {coachLabel && <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-purple-600 text-white">{coachLabel}</span>}
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">AI Coach</span>
          </div>
          {coachText && <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{coachText}</p>}
        </div>
      )}

      {message && <p className="text-green-700 dark:text-green-400 text-sm">{message}</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}
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
      <span className="block text-sm mb-1 text-gray-700 dark:text-gray-200">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="numeric"
        className="w-full p-2 border rounded-xl bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700"
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
      <span className="block text-sm mb-1 text-gray-700 dark:text-gray-200">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-2 border rounded-xl bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
