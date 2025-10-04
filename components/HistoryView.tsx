// components/HistoryView.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getCurrentUserId } from '../auth'
import { dateKeyChicago } from '../lib/dateLocal'

type Row = {
  date: string
  totals: { food_cals: number; workout_cals: number; allowance: number; remaining: number }
}

export default function HistoryView() {
  const [rows, setRows] = useState<Row[]>([])
  const todayKey = dateKeyChicago(new Date())

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const uid = await getCurrentUserId()
      const { data, error } = await supabase
        .from('days')
        .select('date, totals')
        .eq('user_id', uid)
        .order('date', { ascending: false })
      if (!error && mounted) {
        const filt = (data || []).filter(r => r.date !== todayKey)
        setRows(filt as Row[])
      }
    })()
    return () => { mounted = false }
  }, [todayKey])

  return (
    <div className="p-4 max-w-screen-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">History</h1>
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-sm text-neutral-500">No history yet.</div>}
        {rows.map((r) => (
          <div key={r.date} className="p-3 rounded-xl border bg-white dark:bg-neutral-900">
            <div className="font-medium">{r.date}</div>
            <div className="text-sm text-neutral-600">
              Calories: {r.totals?.food_cals ?? 0} / Allowance {r.totals?.allowance ?? 0} — Remaining {r.totals?.remaining ?? 0}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
