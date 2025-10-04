import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../services/apiClient'
import FoodPreviewCard from './FoodPreviewCard'

type Preview = { items: any[]; totals: { calories: number; protein: number; carbs: number; fat: number } }
type Confidence = 'high' | 'medium' | 'low'

export default function FoodNLInput({
  onAdd,
  onQuickAdd,
  onSaveMeal,
  savedMeals,
  onUseSavedMeal,
  onPreviewTotals,
}: {
  onAdd: (data: Preview) => Promise<void>
  onQuickAdd: (text: string) => Promise<void>
  onSaveMeal: (data: Preview, name?: string) => Promise<void>
  savedMeals: Array<{ id: string; name: string; description?: string; calories: number; protein: number; carbs: number; fat: number }>
  onUseSavedMeal: (meal: { id: string }) => Promise<void> | void
  onPreviewTotals?: (totals: Preview['totals'] | null) => void
}) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)

  // send live totals upward so meters fill as user types
  useEffect(() => {
    onPreviewTotals?.(preview?.totals || null)
  }, [preview?.totals?.calories, preview?.totals?.protein, preview?.totals?.carbs, preview?.totals?.fat])

  async function estimate() {
    if (!text.trim()) return
    setLoading(true)
    try {
      const res = await api.post('/api/estimate', { text })
      if (res.success && res.data) {
        setPreview(res.data)
      } else {
        setPreview(null)
      }
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setPreview(null)
    onPreviewTotals?.(null)
  }

  return (
    <div className="p-3 rounded-xl border bg-white dark:bg-neutral-900">
      <div className="flex gap-2 mb-2">
        <input
          className="flex-1 px-3 py-2 rounded-lg border bg-white dark:bg-neutral-900"
          placeholder='What did you eat? e.g., "2 chicken wings and a small fries"'
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') estimate() }}
        />
        <button className="px-3 py-2 rounded-lg border" onClick={estimate} disabled={loading}>
          {loading ? 'Estimating…' : 'Estimate'}
        </button>
      </div>

      {preview && (
        <div className="mb-3">
          <FoodPreviewCard
            estimate={{ items: preview.items, totals: preview.totals }}
            onAdd={() => onAdd(preview)}
            onClear={clear}
            loading={loading}
          />
          <div className="mt-2 flex gap-2">
            <button className="px-3 py-2 rounded-lg border" onClick={() => onAdd(preview)}>Add</button>
            <button
              className="px-3 py-2 rounded-lg border"
              onClick={async () => {
                const name = prompt('Save as meal name?')
                await onSaveMeal(preview, name || undefined)
                clear()
                setText('')
              }}
            >
              Save meal for later
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <button className="px-3 py-2 rounded-lg border" onClick={() => onQuickAdd(text)} disabled={!text.trim()}>
          Quick add from text
        </button>

        {/* Saved meals dropdown */}
        <div className="ml-auto">
          <select
            className="px-3 py-2 rounded-lg border bg-white dark:bg-neutral-900"
            defaultValue=""
            onChange={async (e) => {
              const id = e.target.value
              if (!id) return
              await onUseSavedMeal({ id })
              e.currentTarget.value = ''
            }}
          >
            <option value="" disabled>Saved meals…</option>
            {savedMeals.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
