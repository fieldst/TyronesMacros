import React, { useEffect, useMemo, useState } from 'react'
import { Dumbbell, Printer, Shuffle, Recycle, Copy, ArrowLeftRight, CalendarDays, Info, Eye } from 'lucide-react'
import { getCurrentUserId } from '../auth'
import { bulkAddWorkoutsToDay } from '../services/loggingService'
import { dateKeyChicago } from '../lib/dateLocal'
import { ensureTodayDay } from '../services/dayService'
import { eventBus } from '../lib/eventBus'
import { getActiveTarget } from '../services/targetsService'
import { workoutStyleSuggestion } from '../services/coachSuggest'
import { planWeek } from '../services/openaiService'

/* ──────────────────────────────────────────────────────────────────────────────
   TYPES
   ────────────────────────────────────────────────────────────────────────────── */
type Goal = 'cut' | 'lean' | 'bulk' | 'recomp'
type Style =
  | 'strength' | 'hybrid' | 'bodyweight' | 'cardio' | 'crossfit'
  | 'emom' | 'tabata' | 'interval' | 'conditioning' | 'finisher'
  | 'mobility' | 'skill' | 'circuit'

type BlockKind = 'warmup' | 'strength' | 'metcon' | 'skill' | 'finisher' | 'cooldown' | 'circuit'

type PlanBlock = {
  kind: BlockKind
  text: string
  zone?: number
  minutes?: number
  loadPct1RM?: number | null
  loadRx?: string | null
  equipment?: string[]
  scale?: string | null
  coach?: string | null
}

export type PlanDay = {
  id: string
  date?: string
  title: string
  summary: string
  focus?: string[]
  minutes?: number
  blocks: PlanBlock[]
  tags?: string[]
}

type Experience = 'beginner' | 'intermediate' | 'advanced'
type Intensity = 'low' | 'moderate' | 'high'

type PlanMeta = {
  goal: Goal
  style: Style
  experience: Experience
  intensity: Intensity
  daysPerWeek: number
  minutesPerDay: number
  focusAreas: string[]
  equipment: string[] // legacy free-text, kept for API compatibility
}

type ApiPlanResponse = { success: boolean; data?: { week?: any[] }; error?: string }

/** Structured, user-proof equipment */
type EquipmentProfile = { dumbbells: number[]; kettlebells: number[]; barbellMax?: number }

/* ──────────────────────────────────────────────────────────────────────────────
   CONSTANTS / LS KEYS
   ────────────────────────────────────────────────────────────────────────────── */
const LS_PLAN = 'tm:plannedWeek_v6'
const LS_META = 'tm:planMeta_v6'
const LS_EQUIP = 'tm:equipment_v1'

function uid() { return Math.random().toString(36).slice(2, 10) }

/* ──────────────────────────────────────────────────────────────────────────────
   UTILS
   ────────────────────────────────────────────────────────────────────────────── */
function saveLS<T>(key: string, v: T) { localStorage.setItem(key, JSON.stringify(v)) }
function loadLS<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : fallback } catch { return fallback }
}

type Move = { name: string; equip: 'barbell'|'dumbbell'|'kettlebell'|'cardio'|'bodyweight'; tags: string[] }

const MOVES: Move[] = [
  { name: 'Back Squat', equip: 'barbell', tags: ['legs','squat','strength'] },
  { name: 'Front Squat', equip: 'barbell', tags: ['legs','squat','strength'] },
  { name: 'Deadlift', equip: 'barbell', tags: ['posterior','hinge','strength'] },
  { name: 'Bench Press', equip: 'barbell', tags: ['chest','push','strength'] },
  { name: 'Push Press', equip: 'barbell', tags: ['shoulders','push','strength'] },
  { name: 'Power Clean', equip: 'barbell', tags: ['full','pull','power'] },
  { name: 'DB Bench Press', equip: 'dumbbell', tags: ['chest','push'] },
  { name: 'DB Row', equip: 'dumbbell', tags: ['back','pull'] },
  { name: 'DB Thruster', equip: 'dumbbell', tags: ['full','legs','push'] },
  { name: 'DB Walking Lunge', equip: 'dumbbell', tags: ['legs','lunge'] },
  { name: 'DB Push Press', equip: 'dumbbell', tags: ['shoulders','push'] },
  { name: 'KB Swing', equip: 'kettlebell', tags: ['posterior','hinge','ballistic'] },
  { name: 'KB Goblet Squat', equip: 'kettlebell', tags: ['legs','squat'] },
  { name: 'KB Clean', equip: 'kettlebell', tags: ['full','pull'] },
  { name: 'KB Farmer Carry', equip: 'kettlebell', tags: ['grip','carry'] },
  { name: 'KB Halo', equip: 'kettlebell', tags: ['shoulders','core'] },
  { name: 'Run @RPE 8', equip: 'cardio', tags: ['engine'] },
  { name: 'Row @RPE 8', equip: 'cardio', tags: ['engine'] },
  { name: 'Assault Bike @RPE 8', equip: 'cardio', tags: ['engine'] },
  { name: 'Burpee', equip: 'bodyweight', tags: ['full','engine'] },
  { name: 'Push-up', equip: 'bodyweight', tags: ['chest','push'] },
  { name: 'Sit-up', equip: 'bodyweight', tags: ['core'] },
  { name: 'Air Squat', equip: 'bodyweight', tags: ['legs','squat'] },
]

function titleCase(s: string) { return (s || '').replace(/\b\w/g, c => c.toUpperCase()) }
function bullets(lines: string[]) { return lines.map(s => `• ${s}`).join('\n') }

/* ── Equipment chips + parser ───────────────────────────────────────────────── */
function uniqSorted(arr: number[]): number[] { return Array.from(new Set(arr)).sort((a,b)=>a-b) }
function loadEquipmentProfile(): EquipmentProfile {
  return loadLS<EquipmentProfile>(LS_EQUIP, { dumbbells: [], kettlebells: [], barbellMax: undefined })
}
function saveEquipmentProfile(ep: EquipmentProfile) {
  const clean: EquipmentProfile = {
    dumbbells: uniqSorted(ep.dumbbells.filter(n => n >= 5 && n <= 150)),
    kettlebells: uniqSorted(ep.kettlebells.filter(n => n >= 10 && n <= 106)),
    barbellMax: typeof ep.barbellMax === 'number' && ep.barbellMax > 0 ? ep.barbellMax : undefined,
  }
  saveLS(LS_EQUIP, clean)
}
function normalizeEquipmentText(s: string): EquipmentProfile {
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(lb|lbs|pounds|#)?/ig)].map(m => Math.round(parseFloat(m[1])))
  const lower = s.toLowerCase()
  const hasDB = /db|dumbbell/.test(lower), hasKB = /kb|kettlebell/.test(lower), hasBAR = /barbell|bar|plate|plates/.test(lower)

  let dumbbells: number[] = [], kettlebells: number[] = [], barbellMax: number | undefined
  for (const n of nums) {
    if (hasDB || (!hasKB && !hasBAR && n >= 5 && n <= 150)) dumbbells.push(n)
    if (hasKB || (!hasDB && !hasBAR && n >= 10 && n <= 106)) kettlebells.push(n)
    if (hasBAR && n >= 45) barbellMax = Math.max(barbellMax ?? 0, n)
  }
  if (!barbellMax && /plate|barbell|bar/.test(lower)) {
    const bigs = nums.filter(n => n >= 95); if (bigs.length) barbellMax = Math.max(...bigs)
  }
  return { dumbbells: uniqSorted(dumbbells), kettlebells: uniqSorted(kettlebells), barbellMax }
}

/* ── Outbound payload normalizers (fix API errors) ──────────────────────────── */
const ALLOWED_STYLES = new Set<Style>(['strength','hybrid','bodyweight','cardio','crossfit','emom','tabata','interval','conditioning','finisher','mobility','skill','circuit'])
const ALLOWED_GOALS = new Set<Goal>(['cut','lean','bulk','recomp'])
const ALLOWED_INTENSITIES = new Set<Intensity>(['low','moderate','high'])
const ALLOWED_EXPERIENCE = new Set<Experience>(['beginner','intermediate','advanced'])

function toStr(v: any): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    if (typeof v.value === 'string') return v.value
    if (typeof v.name === 'string')  return v.name
  }
  return null
}
function normalizeStyle(v: any): Style {
  const s = (toStr(v) || '').toLowerCase().trim() as Style
  return (ALLOWED_STYLES.has(s) ? s : 'hybrid')
}
function normalizeGoal(v: any): Goal {
  const s = (toStr(v) || '').toLowerCase().trim() as Goal
  return (ALLOWED_GOALS.has(s) ? s : 'recomp')
}
function normalizeIntensity(v: any): Intensity {
  const s = (toStr(v) || '').toLowerCase().trim() as Intensity
  return (ALLOWED_INTENSITIES.has(s) ? s : 'moderate')
}
function normalizeExperience(v: any): Experience {
  const s = (toStr(v) || '').toLowerCase().trim() as Experience
  return (ALLOWED_EXPERIENCE.has(s) ? s : 'intermediate')
}
function normalizeNumber(n: any, fallback: number): number {
  const v = Number(n); return Number.isFinite(v) ? v : fallback
}

/** API expects an ARRAY for equipment, not an object */
function toEquipmentArray(metaEquip: string[], equip: EquipmentProfile): string[] {
  const fromChips: string[] = [
    ...equip.dumbbells.map(n => `${n} lb dumbbell`),
    ...equip.kettlebells.map(n => `${n} lb kettlebell`),
    ...(equip.barbellMax ? [`${equip.barbellMax} lb in plates`] : []),
  ]
  const legacy = Array.isArray(metaEquip) ? metaEquip : []
  return Array.from(new Set([...legacy, ...fromChips]))
}

/* ── Load text helpers (used for Preview) ───────────────────────────────────── */
function percentileIndex(n: number, p: number): number {
  if (n <= 0) return 0
  const idx = Math.round((n - 1) * Math.min(1, Math.max(0, p)))
  return Math.min(n - 1, Math.max(0, idx))
}
function chooseByIntensity<T>(arr: T[], intensity: Intensity): T | null {
  if (!arr.length) return null
  const p = intensity === 'low' ? 0.35 : intensity === 'moderate' ? 0.6 : 0.8
  return arr[percentileIndex(arr.length, p)]
}
function rxForDB(profile: EquipmentProfile, intensity: Intensity): string | null {
  const w = chooseByIntensity(profile.dumbbells, intensity); return w ? `${w} lb each` : null
}
function rxForKB(profile: EquipmentProfile, intensity: Intensity): string | null {
  const w = chooseByIntensity(profile.kettlebells, intensity); return w ? `${w} lb` : null
}
function rxForBar(movement: string, intensity: Intensity, cap?: number): string {
  const map: Record<string,[number,number]> = {
    'Back Squat':[155,105],'Front Squat':[135,95],'Deadlift':[185,135],
    'Push Press':[115,85],'Power Clean':[135,95],'Bench Press':[135,95],
  }
  const [hi,lo] = map[movement] ?? [135,95]
  let chosen = intensity==='high' ? hi : intensity==='low' ? lo : Math.round((hi+lo)/10)*5
  if (cap) chosen = Math.min(chosen, cap)
  return `${chosen} lb`
}

/* ── Target → suggestion ───────────────────────────────────────────────────── */
async function fetchCurrentTargetText(userId: string): Promise<string | null> {
  const today = dateKeyChicago(new Date())
  const t = await getActiveTarget(userId, today)
  const fromDb = (t?.label || (typeof t?.goal === 'string' ? t.goal : null)) ?? null
  return fromDb ?? null
}

/* ── Server → UI robust mapper ─────────────────────────────────────────────── */
function minutesFromParts(warm: any, main: any, fin: any, cool: any, fallback = 40) {
  const w = Array.isArray(warm) ? Math.min(10, Math.max(5, warm.length * 3)) : 6
  const m = Array.isArray(main) ? Math.min(30, Math.max(12, main.length * 8)) : 16
  const f = fin ? 4 : 0
  const c = Array.isArray(cool) ? Math.min(10, Math.max(4, cool.length * 3)) : 6
  const total = w + m + f + c
  return { w, m, f, c, total: total || fallback }
}

function mapServerWeekToPlanDays(serverWeek: any[]): PlanDay[] {
  const out: PlanDay[] = []
  for (let i = 0; i < serverWeek.length; i++) {
    const d = serverWeek[i] || {}

    // If it's already in our shape, normalize and keep
    if (Array.isArray(d.blocks)) {
      out.push({
        id: uid(),
        title: typeof d.title === 'string' ? d.title : `WOD ${String.fromCharCode(65 + (i % 26))}`,
        summary: typeof d.summary === 'string' ? d.summary : '',
        minutes: typeof d.minutes === 'number' ? d.minutes : undefined,
        focus: Array.isArray(d.focus) ? d.focus : [],
        blocks: d.blocks.map((b: any) => ({
          kind: (b.kind || 'metcon') as BlockKind,
          text: String(b.text || ''),
          minutes: typeof b.minutes === 'number' ? b.minutes : undefined,
          loadPct1RM: typeof b.loadPct1RM === 'number' ? b.loadPct1RM : undefined,
          loadRx: typeof b.loadRx === 'string' ? b.loadRx : undefined,
          equipment: Array.isArray(b.equipment) ? b.equipment : undefined,
          scale: typeof b.scale === 'string' ? b.scale : undefined,
          coach: typeof b.coach === 'string' ? b.coach : undefined,
        })),
        tags: Array.isArray(d.tags) ? d.tags : [],
      })
      continue
    }

    // Assume shape: { day, warmup: string[], main: string[], finisher?: string, cooldown?: string[] }
    const dayTitle = typeof d.day === 'string' ? d.day : `WOD ${String.fromCharCode(65 + (i % 26))}`
    const warmup = Array.isArray(d.warmup) ? d.warmup : []
    const main = Array.isArray(d.main) ? d.main : []
    const finisher = typeof d.finisher === 'string' && d.finisher.trim() ? d.finisher.trim() : null
    const cooldown = Array.isArray(d.cooldown) ? d.cooldown : []

    const mins = minutesFromParts(warmup, main, finisher, cooldown, 40)

    const blocks: PlanBlock[] = []

    if (warmup.length) {
      blocks.push({
        kind: 'warmup',
        text: bullets(warmup),
        minutes: mins.w,
        equipment: ['Bodyweight'],
        scale: 'Move through a comfortable range. No pain.',
        coach: 'Increase range gradually; breathe easy.',
      })
    }

    if (main.length) {
      main.forEach((line: string, idx: number) => {
        blocks.push({
          kind: idx === 0 ? 'metcon' : 'circuit',
          text: line,
          minutes: Math.max(10, Math.round(mins.m / Math.max(1, main.length))),
          scale: 'Keep mechanics crisp; reduce load/reps if form degrades.',
          coach: idx === 0 ? 'Pace so you can keep moving; avoid redlining early.' : 'Smooth transitions; control breathing.',
        })
      })
    }

    if (finisher) {
      blocks.push({
        kind: 'finisher',
        text: finisher,
        minutes: mins.f,
        scale: 'Keep quality high; stop short of failure.',
        coach: 'Short, sharp, and clean reps.',
      })
    }

    if (cooldown.length) {
      blocks.push({
        kind: 'cooldown',
        text: bullets(cooldown),
        minutes: mins.c,
        equipment: ['Bodyweight'],
        coach: 'Nasal breathing, long exhales; downshift gradually.',
      })
    }

    const total = blocks.reduce((a, b) => a + (b.minutes || 0), 0)
    out.push({
      id: uid(),
      title: dayTitle,
      summary: `~${total || mins.total} min • AI-generated`,
      minutes: total || mins.total,
      focus: [],
      blocks,
      tags: ['ai', 'api'],
    })
  }
  return out
}

/* ── API call (AI path ONLY) ───────────────────────────────────────────────── */
async function fetchPlanFromApi(meta: PlanMeta, equip: EquipmentProfile): Promise<PlanDay[] | null> {
  try {
    const payload = {
      minutes:  normalizeNumber(meta.minutesPerDay, 40),
      days:     normalizeNumber(meta.daysPerWeek, 3),
      goal:     normalizeGoal(meta.goal),
      style:    normalizeStyle(meta.style),
      intensity:  normalizeIntensity(meta.intensity),
      experience: normalizeExperience(meta.experience),
      focus:      (meta.focusAreas || []).map(toStr).filter(Boolean) as string[],
      equipment:  toEquipmentArray(meta.equipment, equip),
    }

    if (!payload.minutes || !payload.days || !payload.goal || !payload.style) return null

    const res = await fetch('/api/plan-week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data: ApiPlanResponse = await res.json()
    const weekRaw = data?.data?.week
    if (!data.success || !Array.isArray(weekRaw)) return null

    const mapped = mapServerWeekToPlanDays(weekRaw)
    return mapped.length ? mapped : null
  } catch {
    return null
  }
}

/* ── UI components ─────────────────────────────────────────────────────────── */
function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`Btn ${props.className||''}`}>{props.children}</button> }
function Card({children}:{children:React.ReactNode}){ return <div className="Card">{children}</div> }

function BlockView({b}:{b:PlanBlock}) {
  return (
    <div className="Block">
      <div className="BlockKind">{titleCase(b.kind)}</div>
      <pre className="BlockText">{b.text}</pre>
      <div className="MetaRow">
        {b.loadRx ? <span className="Pill">Load: {b.loadRx}</span> : null}
        {b.minutes ? <span className="Pill">{b.minutes} min</span> : null}
        {b.equipment?.length ? <span className="Pill">{b.equipment.join(', ')}</span> : null}
      </div>
      {b.scale ? <div className="Coach"><strong>Scale:</strong> {b.scale}</div> : null}
      {b.coach ? <div className="Coach"><strong>Coach:</strong> {b.coach}</div> : null}
    </div>
  )
}

function DayCard({d, onHide}:{d:PlanDay; onHide:()=>void}) {
  return (
    <div className="DayCard">
      <div className="DayHeader">
        <div>
          <div className="DayTitle">{d.title}</div>
          <div className="DaySummary">Time cap: ~{d.minutes} min</div>
          <div className="DaySummary">{d.summary}</div>
        </div>
        <Btn onClick={onHide} title="Hide this WOD">Hide</Btn>
      </div>
      <div className="Blocks">{d.blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>
    </div>
  )
}

function WeeklyPlanSkeleton() {
  return (
    <>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="Card">
          <div className="DayHeader">
            <div>
              <div className="DayTitle">
                <span className="inline-block h-5 w-28 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
              </div>
              <div className="DaySummary mt-2">
                <span className="inline-block h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
              </div>
            </div>
          </div>
          <div className="Blocks">
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="Block">
                <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
                <div className="h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse mt-2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

/* ── MAIN (API-only) ───────────────────────────────────────────────────────── */
export default function WeeklyWorkoutPlan() {
  const [meta, setMeta] = useState<PlanMeta>(() => loadLS<PlanMeta>(LS_META, {
    goal: 'recomp', style: 'hybrid', experience: 'intermediate', intensity: 'moderate',
    daysPerWeek: 3, minutesPerDay: 40, focusAreas: [], equipment: [],
  }))
  const [week, setWeek] = useState<PlanDay[]>(() => loadLS<PlanDay[]>(LS_PLAN, []))
  const [loading, setLoading] = useState(false)
  const [equip, setEquip] = useState<EquipmentProfile>(() => loadEquipmentProfile())
  const [parseText, setParseText] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [source, setSource] = useState<'AI API' | 'AI API (empty)'>('AI API')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => { saveLS(LS_META, meta) }, [meta])
  useEffect(() => { saveLS(LS_PLAN, week) }, [week])
  useEffect(() => { saveEquipmentProfile(equip) }, [equip])

  // Suggest style/goal from Active Target
  useEffect(() => {
    (async () => {
      const uid = await getCurrentUserId().catch(() => null)
      if (!uid) return
      const t = await fetchCurrentTargetText(uid)
      const maybeStyle = workoutStyleSuggestion(t || '')
      const sGoal = (t || '').toLowerCase()
      const targGoal: Goal | null =
        /(cut|deficit|shred)/.test(sGoal) ? 'cut' :
        /(bulk|gain|surplus)/.test(sGoal) ? 'bulk' :
        /(lean|recomp|maint)/.test(sGoal) ? 'recomp' : null
      setMeta(m => ({ ...m, style: (maybeStyle as Style) || m.style, goal: targGoal ?? m.goal }))
    })()
  }, [])

  // Preview rows use structured equipment + intensity
  const previewRows = useMemo(() => {
    const sample: Move[] = [
      { name: 'DB Thruster', equip: 'dumbbell', tags: [] },
      { name: 'KB Goblet Squat', equip: 'kettlebell', tags: [] },
      { name: 'Back Squat', equip: 'barbell', tags: [] },
    ]
    return sample.map(m => ({
      move: m.name,
      equip: m.equip,
      rx:
        m.equip === 'dumbbell' ? (rxForDB(equip, meta.intensity) || '—') :
        m.equip === 'kettlebell' ? (rxForKB(equip, meta.intensity) || '—') :
        rxForBar(m.name, meta.intensity, equip.barbellMax)
    }))
  }, [meta, equip])

  // Equipment chip handlers
  function addDB(n: number) { if (n>=5 && n<=150) setEquip(e => ({ ...e, dumbbells: uniqSorted([...e.dumbbells, Math.round(n)]) })) }
  function removeDB(n: number) { setEquip(e => ({ ...e, dumbbells: e.dumbbells.filter(x => x !== n) })) }
  function addKB(n: number) { if (n>=10 && n<=106) setEquip(e => ({ ...e, kettlebells: uniqSorted([...e.kettlebells, Math.round(n)]) })) }
  function removeKB(n: number) { setEquip(e => ({ ...e, kettlebells: e.kettlebells.filter(x => x !== n) })) }
  function setBarMax(n: number | '') {
    if (n === '') { setEquip(e => ({ ...e, barbellMax: undefined })); return }
    const v = Math.max(45, Math.min(600, Math.round(Number(n)||0))); setEquip(e => ({ ...e, barbellMax: v }))
  }
  function parseAndImport() {
    const norm = normalizeEquipmentText(parseText)
    setEquip({
      dumbbells: uniqSorted([...(equip.dumbbells||[]), ...(norm.dumbbells||[])]),
      kettlebells: uniqSorted([...(equip.kettlebells||[]), ...(norm.kettlebells||[])]),
      barbellMax: norm.barbellMax ?? equip.barbellMax
    })
  }

  // API-ONLY generation
  async function onGenerate() {
    setLoading(true)
    setNotice(null)
    try {
      const apiWeek = await fetchPlanFromApi(meta, equip)
      if (apiWeek && apiWeek.length > 0) {
        setWeek(apiWeek)
        setSource('AI API')
      } else {
        setWeek([])
        setSource('AI API (empty)')
        setNotice(
          'The AI API returned no workouts to render. Double-check: Goal, Style, Days/Week, Minutes/Day, and Equipment. ' +
          'If all fields look good, adjust the server formatter to always include at least one item in `main`.'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  const [focusInput, setFocusInput] = React.useState('')

  function addFocus() {
    const v = focusInput.trim().toLowerCase()
    if (!v) return
    setMeta(m => ({
      ...m,
      focusAreas: Array.from(new Set([...(m.focusAreas || []), v])).slice(0, 6),
    }))
    setFocusInput('')
  }

  function removeFocus(tag: string) {
    setMeta(m => ({
      ...m,
      focusAreas: (m.focusAreas || []).filter(t => t !== tag),
    }))
  }

  function onClear() { setWeek([]); setNotice(null) }

  async function addDayToToday(d: PlanDay) {
    const userId = await getCurrentUserId().catch(() => null)
    if (!userId) { alert('Please sign in to save workouts.'); return }

    const day = await ensureTodayDay(userId)
    const dateKey = day.date

    const items = (d.blocks || []).map((b, i) => ({
      activity: `${d.title} — ${b.kind.charAt(0).toUpperCase() + b.kind.slice(1)}`,
      minutes: b.minutes ?? null,
      calories_burned: Math.max(0, Math.round((b.minutes || 10) * 7)),
      intensity: (typeof meta?.intensity === 'string' ? meta.intensity : null),
      source: 'plan',
      order_index: i,
      description: b.text,
    }))

    if (!items.length) { alert('No blocks to add for this day.'); return }

    await bulkAddWorkoutsToDay({
      userId,
      dayUUID: day.id,
      dateKey,
      items,
    })

    eventBus.emit('day:totals', { date: dateKey })
    alert('Added to Today.')
  }

  return (
    <div className="PlanRoot">
      <div className="Panel">
        <div className="PanelHeader">
          <Dumbbell className="mr-2" /> Weekly Workout Planner <span className="Source">• {source}</span>
        </div>

        {/* Controls section (dim while loading) */}
        <div className={loading ? 'pointer-events-none opacity-70 transition' : 'transition'}>
          {/* Meta controls */}
          <div className="Grid">
            <div className="Col">
              <label className="Label">Goal</label>
              <select className="Field" value={meta.goal} onChange={e => setMeta(m => ({...m, goal: e.target.value as Goal}))}>
                <option value="cut">cut</option><option value="lean">lean</option><option value="recomp">recomp</option><option value="bulk">bulk</option>
              </select>
            </div>
            <div className="Col">
              <label className="Label">Experience</label>
              <select className="Field" value={meta.experience} onChange={e => setMeta(m => ({...m, experience: e.target.value as Experience}))}>
                <option value="beginner">beginner</option><option value="intermediate">intermediate</option><option value="advanced">advanced</option>
              </select>
            </div>
            <div className="Col">
              <label className="Label">Intensity</label>
              <select className="Field" value={meta.intensity} onChange={e => setMeta(m => ({...m, intensity: e.target.value as Intensity}))}>
                <option value="low">low</option><option value="moderate">moderate</option><option value="high">high</option>
              </select>
            </div>
            <div className="Col">
              <label className="Label">Style</label>
              <select className="Field" value={meta.style} onChange={e => setMeta(m => ({...m, style: e.target.value as Style}))}>
                {Array.from(ALLOWED_STYLES).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="Col">
              <label className="Label">Days / Week</label>
              <input className="Field" type="number" min={1} max={6} value={meta.daysPerWeek}
                onChange={e => setMeta(m => ({...m, daysPerWeek: Math.max(1, Math.min(6, parseInt(e.target.value||'3',10)))}))} />
            </div>
            <div className="Col">
              <label className="Label">Minutes / Day</label>
              <input className="Field" type="number" min={30} max={75} value={meta.minutesPerDay}
                onChange={e => setMeta(m => ({...m, minutesPerDay: Math.max(20, Math.min(120, parseInt(e.target.value||'40',10)))}))} />
            </div>
          </div>

          {/* Focus Areas */}
          <div className="PanelSubhead"><CalendarDays className="mr-1" /> Focus Areas</div>
          <div className="Row">
            <input
              className="Field"
              placeholder="e.g., glutes, hams"
              value={focusInput}
              onChange={e => setFocusInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addFocus()
                }
              }}
            />
            <Btn onClick={addFocus}>Add</Btn>
            <div className="Chips">
              {(meta.focusAreas || []).map(t => (
                <span key={t} className="Chip">
                  {t} <button onClick={() => removeFocus(t)} title="Remove">×</button>
                </span>
              ))}
            </div>
          </div>

          {/* Equipment chips (user-proof) */}
          <div className="PanelSubhead"><Dumbbell className="mr-1" /> Equipment (chips)</div>
          <div className="EquipGrid">
            {/* Dumbbells */}
            <div className="EquipCol">
              <div className="Label">Dumbbells (lb)</div>
              <div className="ChipRow">
                {equip.dumbbells.map(n =>
                  <span key={`db-${n}`} className="Chip">{n} <button onClick={() => removeDB(n)}>×</button></span>
                )}
              </div>
              <div className="Row">
                <input
                  type="number" min={5} max={150} step={5} placeholder="Add e.g. 50" className="Field"
                  onKeyDown={e => {
                    if (e.key==='Enter'){
                      const v = parseInt((e.target as HTMLInputElement).value,10)
                      if(Number.isFinite(v)) addDB(v)
                      ;(e.target as HTMLInputElement).value=''
                    }
                  }}
                />
                {[10,20,30,40,50,60].map(v => <Btn key={v} onClick={()=>addDB(v)}>{v}</Btn>)}
              </div>
              <div className="Badge">{equip.dumbbells.length ? '✓ Ready' : '• Add at least one'}</div>
            </div>

            {/* Kettlebells */}
            <div className="EquipCol">
              <div className="Label">Kettlebells (lb)</div>
              <div className="ChipRow">
                {equip.kettlebells.map(n =>
                  <span key={`kb-${n}`} className="Chip">{n} <button onClick={() => removeKB(n)}>×</button></span>
                )}
              </div>
              <div className="Row">
                <input
                  type="number" min={10} max={106} step={1} placeholder="Add e.g. 35" className="Field"
                  onKeyDown={e => {
                    if (e.key==='Enter'){
                      const v = parseInt((e.target as HTMLInputElement).value,10)
                      if(Number.isFinite(v)) addKB(v)
                      ;(e.target as HTMLInputElement).value=''
                    }
                  }}
                />
                {[26,35,53].map(v => <Btn key={v} onClick={()=>addKB(v)}>{v}</Btn>)}
              </div>
              <div className="Badge">{equip.kettlebells.length ? '✓ Ready' : '• Add at least one'}</div>
            </div>

            {/* Barbell */}
            <div className="EquipCol">
              <div className="Label">Barbell Max (lb cap)</div>
              <div className="Row">
                <input
                  type="number" min={45} max={600} step={5} className="Field"
                  value={equip.barbellMax ?? ''}
                  onChange={e => setBarMax(e.target.value === '' ? '' : Number(e.target.value))}
                />
                {[315,405].map(v => <Btn key={v} onClick={() => setBarMax(v)}>{v}</Btn>)}
              </div>
              <div className="Badge">{typeof equip.barbellMax==='number' ? `✓ Capped at ${equip.barbellMax} lb` : '• Optional (uses classic pairs)'}</div>
            </div>
          </div>

          {/* Parser → chips */}
          <details className="Parser">
            <summary>Paste equipment text (optional) — auto-parse</summary>
            <textarea
              className="Field" rows={3}
              placeholder="e.g., 10 lb, 20 lb, 30 lb DBs; 35 lb KB; 315 lb in plates"
              value={parseText}
              onChange={e => setParseText(e.target.value)}
            />
            <div className="Row">
              <Btn onClick={parseAndImport}><ArrowLeftRight className="mr-1" /> Parse → Add chips</Btn>
              <div className="LegacyNote">Legacy free-text kept (for API): {(meta.equipment||[]).join(', ') || '—'}</div>
            </div>
          </details>
        </div>

        {/* Actions (kept OUTSIDE so the button shows spinner) */}
        <div className="Actions">
          <Btn
            onClick={onGenerate}
            disabled={loading}
            aria-busy={loading}
            className="inline-flex items-center gap-2"
          >
            {loading ? (
              <>
                <span
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
                Generating…
              </>
            ) : (
              <>
                <Shuffle className="mr-1" />
                Generate Plan
              </>
            )}
          </Btn>

          {/* Screen-reader status (invisible to sighted users) */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {loading ? 'Generating your weekly plan…' : ''}
          </div>

          <Btn onClick={onClear}><Recycle className="mr-1" /> Clear</Btn>
          <Btn onClick={() => window.print()}><Printer className="mr-1" /> Print / Export</Btn>
          <Btn onClick={() => setPreviewOpen(p => !p)} title="Preview loads"><Eye className="mr-1" /> Test Loads</Btn>
        </div>

        {/* Inline notice for API-empty */}
        {notice && (
          <div className="Notice">
            <strong>Heads up:</strong> {notice}
          </div>
        )}

        {/* Loads preview */}
        {previewOpen && (
          <div className="PreviewCard">
            <div className="PreviewHeader">Test Loads — based on your Equipment + Intensity</div>
            <table className="PreviewTable">
              <thead><tr><th>Movement</th><th>Implements</th><th>Suggested RX</th></tr></thead>
              <tbody>
                {previewRows.map((r,i) =>
                  <tr key={i}><td>{r.move}</td><td>{titleCase(r.equip)}</td><td>{r.rx}</td></tr>
                )}
              </tbody>
            </table>
            <div className="PreviewHint">Tip: edit chips above and click “Test Loads” again.</div>
          </div>
        )}
      </div>

      {/* Week view */}
      <div className="Week">
        {loading ? (
          <WeeklyPlanSkeleton />
        ) : (!week || week.length === 0) ? (
          <div className="Empty">
            <Info className="mr-2" />
            {notice ? 'No workouts to show — see the message above.' : 'Click Generate Plan to fetch workouts from the AI API.'}
          </div>
        ) : (
          week.map((d, idx) => (
            <Card key={d.id}>
              <DayCard d={d} onHide={() => setWeek(w => w.filter((_,i) => i!==idx))} />
              <div className="CardActions">
                <Btn onClick={() => addDayToToday(d)}><Copy className="mr-1" /> Add to Today</Btn>
              </div>
            </Card>
          ))
        )}
      </div>

      <style>{`
/* ---- Inputs: light defaults ---- */
.Field { color: #0b121a; background: rgba(255,255,255,0.95); border-color: rgba(0,0,0,0.25); }
.Field::placeholder { color: rgba(0,0,0,0.45); }

/* ---- Inputs: dark theme overrides ---- */
@media (prefers-color-scheme: dark) {
  .Field, select.Field, textarea.Field, input.Field {
    color: #E6EDF3;
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.22);
  }
  .Field::placeholder { color: rgba(230,237,243,0.55); }
  select.Field option { color: #E6EDF3; background: #0B0F14; }
  input[type="number"].Field { color: #E6EDF3; }
  .Field:focus { outline: none; border-color: rgba(99,179,237,0.7); box-shadow: 0 0 0 3px rgba(99,179,237,0.18); }
  .Field:disabled { color: rgba(230,237,243,0.45); background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.15); }
}

.Field { pointer-events: auto; position: relative; z-index: 1; }
.Panel{padding:16px;border:1px solid rgba(128,128,128,0.25);border-radius:14px;margin-bottom:16px}
.PanelHeader{font-weight:600;display:flex;align-items:center;margin-bottom:10px}
.Source{margin-left:8px;font-size:12px;opacity:0.75}
.Grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:10px}
.Col{display:flex;flex-direction:column}
.Label{font-size:12px;opacity:0.8;margin-bottom:4px}
.Row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.Chips{display:flex;gap:8px;flex-wrap:wrap}
.Chip{background:rgba(128,128,128,0.15);padding:4px 8px;border-radius:999px}
.Badge{font-size:12px;opacity:0.8;margin-top:4px}
.LegacyNote{font-size:12px;opacity:0.8}
.EquipGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:8px}
.EquipCol{border:1px dashed rgba(128,128,128,0.25);border-radius:10px;padding:10px}
.ChipRow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.Parser{margin:8px 0}
.Field{width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;border-radius:10px;border:1px solid rgba(128,128,128,0.35)}
.Btn{padding:0.5rem 0.75rem;border-radius:10px;border:1px solid rgba(128,128,128,0.35);background:transparent;display:inline-flex;align-items:center;gap:6px}
.Actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.Notice{margin-top:10px;padding:10px;border-radius:10px;border:1px solid rgba(255,165,0,0.35);background:rgba(255,165,0,0.08)}
.Week{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.Empty{display:flex;align-items:center;opacity:0.8;padding:24px;border:1px dashed rgba(128,128,128,0.3);border-radius:12px}
.Card{padding:12px;border-radius:12px;border:1px solid rgba(128,128,128,0.25);background-color:var(--tw-prose-bg,transparent);overflow:hidden}
.CardActions{display:flex;justify-content:flex-end;margin-top:8px}
.Block{padding:10px 0;border-top:1px solid rgba(128,128,128,0.2)}
.Block:first-child{border-top:none}
.BlockKind{font-weight:600;margin-bottom:4px}
.BlockText{white-space:pre-wrap}
.MetaRow{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.Pill{padding:2px 8px;border-radius:999px;background:rgba(128,128,128,0.15);font-size:12px}
.Coach{margin-top:6px;font-size:12px;opacity:0.9}
.DayCard{display:flex;flex-direction:column}
.DayHeader{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.DayTitle{font-weight:700}
.DaySummary{opacity:0.8;font-size:12px}
.PreviewCard{margin-top:10px;border:1px solid rgba(128,128,128,0.25);border-radius:12px;padding:10px;background:rgba(128,128,128,0.05)}
.PreviewHeader{font-weight:600;margin-bottom:6px}
.PreviewTable{width:100%;border-collapse:collapse}
.PreviewTable th,.PreviewTable td{border-bottom:1px solid rgba(128,128,128,0.2);text-align:left;padding:6px 8px;font-size:14px}
.PreviewTable tr:last-child td{border-bottom:none}
.PreviewHint{font-size:12px;opacity:0.8;margin-top:4px}
@media (max-width: 1000px){ .Week{grid-template-columns:1fr} .EquipGrid{grid-template-columns:1fr} }
`}</style>
    </div>
  )
}
