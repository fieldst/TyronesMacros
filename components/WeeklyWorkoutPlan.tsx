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

/* Compact block tile used in the collapsed view */
function BlockTile({ b }: { b: PlanBlock }) {
  return (
    <div className={`Tile Tile-${b.kind}`}>
      <div className="TileKind">{(b.kind || 'block').replace(/\b\w/g, c => c.toUpperCase())}</div>
      <div className="TileText clamp-2">{b.text || ''}</div>
      <div className="TileMeta">
        {b.minutes ? <span className="TilePill">{b.minutes} min</span> : null}
        {b.loadRx ? <span className="TilePill">{b.loadRx}</span> : null}
      </div>
    </div>
  );
}

/* Full block (shown only when expanded) */
function BlockView({ b }: { b: PlanBlock }) {
  return (
    <div className="Block">
      <div className="BlockKind">{(b.kind || 'block').replace(/\b\w/g, c => c.toUpperCase())}</div>
      <pre className="BlockText">{b.text || ''}</pre>
      <div className="MetaRow">
        {b.loadRx ? <span className="Pill">Load: {b.loadRx}</span> : null}
        {b.minutes ? <span className="Pill">{b.minutes} min</span> : null}
        {b.equipment?.length ? <span className="Pill">{b.equipment.join(', ')}</span> : null}
      </div>
      {b.scale ? <div className="Coach"><strong>Scale:</strong> {b.scale}</div> : null}
      {b.coach ? <div className="Coach"><strong>Coach:</strong> {b.coach}</div> : null}
    </div>
  );
}

/* Day card: collapsed (compact tiles) by default; expand to see full blocks */
function DayCard({ d, onHide }: { d: PlanDay; onHide: () => void }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="DayCard">
      <div className="DayHeader">
        <div>
          <div className="DayTitle">{d.title}</div>
          <div className="DaySummary">~{d.minutes} min • {d.summary}</div>
        </div>

        <div className="HeaderActions">
          <button className="Btn ghost" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide details' : 'Show details'}
          </button>
          <button className="Btn" onClick={onHide}>Hide</button>
        </div>
      </div>

      {!open ? (
        /* Compact grid */
        <div className="TilesGrid">
          {d.blocks.map((b, i) => <BlockTile key={i} b={b} />)}
        </div>
      ) : (
        /* Full detail */
        <div className="Blocks">
          {d.blocks.map((b, i) => <BlockView key={i} b={b} />)}
        </div>
      )}
    </div>
  );
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
:root{
  --purple-500:#8b5cf6;
  --purple-600:#7c3aed;
  --purple-700:#6d28d9;
  --purple-800:#5b21b6;
  --surface: rgba(255,255,255,0.9);
  --surface-dark: rgba(255,255,255,0.06);
  --border: rgba(0,0,0,0.12);
  --border-dark: rgba(255,255,255,0.16);
}

.PlanRoot{max-width:1100px;margin:0 auto;padding:16px}
.Panel{
  padding:16px;border:1px solid var(--border);border-radius:16px;margin-bottom:16px;
  background: linear-gradient(180deg, rgba(139,92,246,0.10), transparent);
}
@media (prefers-color-scheme: dark){
  .Panel{border-color:var(--border-dark);background: linear-gradient(180deg, rgba(124,58,237,0.12), rgba(124,58,237,0.06));}
}

/* === Compact tiles ======================================================== */
.TilesGrid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:10px;
}
@media (max-width: 720px){
  .TilesGrid{ grid-template-columns:1fr; }
}

.Tile{
  border:1px solid var(--border);
  border-radius:12px;
  padding:10px;
  background:rgba(139,92,246,0.06);      /* subtle purple tint */
}
@media (prefers-color-scheme: dark){
  .Tile{ border-color:var(--border-dark); background:rgba(139,92,246,0.12); }
}
.TileKind{
  font-weight:700;
  margin-bottom:4px;
  color:#0b121a;
}
@media (prefers-color-scheme: dark){ .TileKind{ color:#F6F8FA; } }

.TileText{ font-size:13px; color:#111827; }
@media (prefers-color-scheme: dark){ .TileText{ color:#E5E7EB; } }

/* 2-line clamp for compact view */
.clamp-2{
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
}

.TileMeta{ display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
.TilePill{
  padding:2px 8px; border-radius:999px; font-size:12px;
  background:rgba(139,92,246,0.18); color:#4c1d95;
  border:1px solid rgba(139,92,246,0.28);
}
@media (prefers-color-scheme: dark){
  .TilePill{ color:#e9d5ff; background:rgba(139,92,246,0.28); border-color:rgba(139,92,246,0.38); }
}

/* Header action button variant */
.Btn.ghost{
  background:transparent;
  color:var(--purple-600);
  border:1px solid rgba(139,92,246,0.45);
}
.Btn.ghost:hover{ background:rgba(139,92,246,0.10); }
.HeaderActions{ display:flex; gap:8px; align-items:center; }

.PanelHeader{
  font-weight:700;display:flex;align-items:center;margin-bottom:14px;
  background: linear-gradient(90deg, var(--purple-600), var(--purple-500));
  -webkit-background-clip:text;background-clip:text;color:transparent;
  letter-spacing:.2px;font-size:18px;
}
.Source{margin-left:8px;font-size:12px;opacity:0.8}

.Grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px}
.Col{display:flex;flex-direction:column}
.Label{
  font-size:12px;
  margin-bottom:4px;
  color:#0b121a;       /* darker label text in light mode */
  opacity:1;           /* remove dimming */
}

@media (prefers-color-scheme: dark){
  .Label{ color:#E6EDF3; }
}

.Field{
  width:100%;box-sizing:border-box;padding:0.6rem 0.8rem;border-radius:12px;
  background:var(--surface);
  border:1px solid var(--border);
  color:#0b121a;                   /* force dark text */
  transition: box-shadow .15s ease, border-color .15s ease, background .2s ease;
}
.Field::placeholder{ color:rgba(0,0,0,0.55); }  /* darker placeholder */
.Field:focus{outline:none;border-color:var(--purple-600);
  box-shadow:0 0 0 3px rgba(124,58,237,0.20);background:#fbf7ff}

@media (prefers-color-scheme: dark){
  .Field{background:var(--surface-dark);border-color:var(--border-dark);color:#E6EDF3}
  .Field::placeholder{color:rgba(230,237,243,0.55)}
  .Field:focus{border-color:var(--purple-500);box-shadow:0 0 0 4px rgba(139,92,246,0.28);background:rgba(124,58,237,0.10)}
  select.Field option{color:#E6EDF3;background:#0B0F14}
}

.Row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.Chips{display:flex;gap:8px;flex-wrap:wrap}
.Chip{
  background:rgba(139,92,246,0.12);padding:4px 10px;border-radius:999px;
  color:#4c1d95;border:1px solid rgba(139,92,246,0.25)
}
@media (prefers-color-scheme: dark){
  .Chip{color:#d6bcfa;background:rgba(139,92,246,0.20);border-color:rgba(139,92,246,0.35)}
}
.Chip button{margin-left:6px}

.Badge{font-size:12px;opacity:0.85;margin-top:4px}
.LegacyNote{font-size:12px;opacity:0.8}
.EquipGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:8px}
.EquipCol{border:1px dashed var(--border);border-radius:12px;padding:10px}
@media (prefers-color-scheme: dark){ .EquipCol{border-color:var(--border-dark)} }
.ChipRow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.Parser{margin:8px 0}

.Btn{
  padding:0.55rem 0.9rem;border-radius:12px;border:1px solid rgba(139,92,246,0.45);
  background: linear-gradient(180deg, rgba(139,92,246,0.95), rgba(124,58,237,0.95));
  color:white;font-weight:600;letter-spacing:.15px;
  transform: translateZ(0); transition: transform .06s ease, box-shadow .15s ease, opacity .15s ease;
  box-shadow: 0 6px 16px rgba(124,58,237,0.25);
}
.Btn:hover{transform:translateY(-1px);box-shadow:0 10px 22px rgba(124,58,237,0.32)}
.Btn:active{transform:translateY(0)}
.Btn:disabled{opacity:.6;cursor:not-allowed}

.Actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}

.Notice{
  margin-top:12px;padding:12px;border-radius:12px;
  border:1px solid rgba(255,165,0,0.35);background:rgba(255,165,0,0.08)
}

.Week{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.Empty{display:flex;align-items:center;opacity:0.85;padding:24px;border:1px dashed var(--border);border-radius:14px}

.Card{
  padding:14px;border-radius:14px;border:1px solid var(--border);
  background:linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.75));
  overflow:hidden; box-shadow: 0 2px 14px rgba(0,0,0,0.04);
}
@media (prefers-color-scheme: dark){
  .Card{border-color:var(--border-dark);background:linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.04))}
}
.CardActions{display:flex;justify-content:flex-end;margin-top:10px}

.Block{padding:10px 0;border-top:1px solid rgba(128,128,128,0.18)}
.Block:first-child{border-top:none}
.BlockKind{
  font-weight:700;margin-bottom:4px;
  background:linear-gradient(90deg, var(--purple-600), var(--purple-500));
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.BlockText{white-space:pre-wrap}
.MetaRow{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.Pill{padding:2px 8px;border-radius:999px;background:rgba(139,92,246,0.12);font-size:12px;color:#4c1d95;border:1px solid rgba(139,92,246,0.25)}
@media (prefers-color-scheme: dark){ .Pill{color:#d6bcfa;background:rgba(139,92,246,0.18);border-color:rgba(139,92,246,0.35)} }
.Coach{margin-top:6px;font-size:12px;opacity:0.9}

.DayCard{display:flex;flex-direction:column}
.DayHeader{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.DayTitle{ font-weight:800; letter-spacing:.2px; color:#0b121a; }
@media (prefers-color-scheme: dark){ .DayTitle{ color:#F6F8FA; } }
.DaySummary{
  font-size:12px;
  color:#1f2937;     /* darker summary text */
  opacity:1;         /* no fading */
}

@media (prefers-color-scheme: dark){ .DaySummary{ color:#CBD5E1; } }

.PreviewCard{margin-top:12px;border:1px solid var(--border);border-radius:12px;padding:12px;background:rgba(139,92,246,0.06)}
@media (prefers-color-scheme: dark){ .PreviewCard{border-color:var(--border-dark);background:rgba(139,92,246,0.12)} }
.PreviewHeader{font-weight:700;margin-bottom:6px}
.PreviewTable{width:100%;border-collapse:collapse}
.PreviewTable th,.PreviewTable td{border-bottom:1px solid rgba(128,128,128,0.2);text-align:left;padding:6px 8px;font-size:14px}
.PreviewTable tr:last-child td{border-bottom:none}
.PreviewHint{font-size:12px;opacity:0.85;margin-top:4px}

@media (max-width: 1000px){
  .Week{grid-template-columns:1fr}
  .EquipGrid{grid-template-columns:1fr}
}
/* === FIX: High-contrast labels & headings on dark purple background ======= */

/* Labels above the selects/inputs */
.Panel .Label{
  color:#F5F3FF;        /* very light lavender for dark bg */
  opacity:1;
  text-shadow: 0 1px 0 rgba(0,0,0,0.35);  /* subtle lift on dark */
}
@media (prefers-color-scheme: light){
  .Panel .Label{ color:#111827; text-shadow:none; }
}

/* Small section headings like “Focus Areas”, “Equipment (chips)” */
.PanelSubhead{
  color:#F5F3FF;
  opacity:0.98;
  text-shadow: 0 1px 0 rgba(0,0,0,0.35);
}
@media (prefers-color-scheme: light){
  .PanelSubhead{ color:#1f2937; text-shadow:none; }
}

/* Top header text: make it solid & readable in dark mode */
.PanelHeader{
  background:none;            /* remove gradient text for dark */
  color:#F8F7FF;              /* bright neutral-lavender */
  text-shadow: 0 1px 0 rgba(0,0,0,0.45);
}
@media (prefers-color-scheme: light){
  .PanelHeader{
    color:#4c1d95;            /* brand purple in light mode */
    text-shadow:none;
  }
}

/* Ensure the select text itself stays readable inside the dark panel */
select.Field{
  color:#0b121a;
}
@media (prefers-color-scheme: dark){
  select.Field{
    color:#FFFFFF;            /* white text inside selects on dark */
    background:var(--surface-dark);
  }
}

/* Slightly darken placeholders so they show up against the dark field */
.Field::placeholder{
  color:rgba(0,0,0,0.65);
}
@media (prefers-color-scheme: dark){
  .Field::placeholder{
    color:rgba(246,248,250,0.78);
  }
}
/* === Dark-mode readability pass (labels, headings, icons, badges) ========= */
@media (prefers-color-scheme: dark){
  /* 1) Form labels above controls */
  .Panel .Label,
  .EquipCol .Label {
    color:#EDE9FE !important;          /* bright lavender */
    opacity:1 !important;
    text-shadow:0 1px 0 rgba(0,0,0,.45);
  }
  .Panel .Label svg,
  .EquipCol .Label svg {
    stroke:#EDE9FE !important;          /* lucide-react inherits currentColor; force it */
  }

  /* 2) Section headings (Focus Areas, Equipment (chips)) + their icons */
  .PanelSubhead,
  .PanelSubhead svg {
    color:#EDE9FE !important;
    stroke:#EDE9FE !important;
    opacity:1 !important;
    text-shadow:0 1px 0 rgba(0,0,0,.45);
  }

  /* 3) Top header row (title icon + "• AI API" source text) */
  .PanelHeader,
  .PanelHeader svg,
  .PanelHeader .Source {
    color:#F8F7FF !important;
    stroke:#F8F7FF !important;
    text-shadow:0 1px 0 rgba(0,0,0,.45);
  }

  /* 4) The little "Ready" badges under equipment groups */
  .Badge { color:#EDE9FE !important; opacity:0.95; }

  /* 5) "Paste equipment…" summary line */
  details.Parser > summary {
    color:#EDE9FE !important;
    text-shadow:0 1px 0 rgba(0,0,0,.45);
  }

  /* 6) Make sure the actual select/input text stays bright too */
  select.Field,
  input.Field,
  textarea.Field {
    color:#FFFFFF !important;
    background:var(--surface-dark);
  }
  .Field::placeholder { color:rgba(246,248,250,0.85) !important; }
}
/* ==== Absolute white text in dark mode (strong overrides) ================== */
@media (prefers-color-scheme: dark){
  /* Top title + source tag + their icons */
  .PlanRoot .PanelHeader,
  .PlanRoot .PanelHeader .Source,
  .PlanRoot .PanelHeader *,
  .PlanRoot .PanelHeader svg {
    color:#ffffff !important;
    stroke:#ffffff !important;
    text-shadow:none !important;
  }

  /* Form labels above controls (Goal, Experience, Intensity, Style, Days/Week, Minutes/Day) */
  .PlanRoot .Panel .Label,
  .PlanRoot .Panel .Label *,
  .PlanRoot .EquipCol .Label,
  .PlanRoot .EquipCol .Label * {
    color:#ffffff !important;
    stroke:#ffffff !important;
    opacity:1 !important;
    text-shadow:none !important;
  }

  /* Section headings (Focus Areas, Equipment (chips)) and their icons */
  .PlanRoot .PanelSubhead,
  .PlanRoot .PanelSubhead *,
  .PlanRoot .PanelSubhead svg {
    color:#ffffff !important;
    stroke:#ffffff !important;
    opacity:1 !important;
    text-shadow:none !important;
  }

  /* Summary lines (e.g., “Paste equipment text …”) */
  .PlanRoot details.Parser > summary,
  .PlanRoot details.Parser > summary * {
    color:#ffffff !important;
    stroke:#ffffff !important;
  }

  /* Readability for helper badges like “Ready” */
  .PlanRoot .Badge { color:#ffffff !important; opacity:1 !important; }

  /* Make sure the text inside selects/inputs/textarea is white too */
  .PlanRoot select.Field,
  .PlanRoot input.Field,
  .PlanRoot textarea.Field {
    color:#ffffff !important;
    background:var(--surface-dark);
  }
  .PlanRoot .Field::placeholder { color:rgba(255,255,255,0.9) !important; }

  /* Lucide icons anywhere inside the panel should be white */
  .PlanRoot .Panel svg { stroke:#ffffff !important; }
}
/* === DARK MODE: force ALL words/icons to white inside the planner ========== */
@media (prefers-color-scheme: dark){

  /* 0) Base: every common text element inside the planner becomes white */
  .PlanRoot,
  .PlanRoot h1, .PlanRoot h2, .PlanRoot h3, .PlanRoot h4, .PlanRoot h5, .PlanRoot h6,
  .PlanRoot p, .PlanRoot span, .PlanRoot small, .PlanRoot strong, .PlanRoot em,
  .PlanRoot label, .PlanRoot legend, .PlanRoot summary,
  .PlanRoot div, .PlanRoot dt, .PlanRoot dd, .PlanRoot th, .PlanRoot td,
  .PlanRoot .Label, .PlanRoot .PanelSubhead, .PlanRoot .DayTitle, .PlanRoot .DaySummary,
  .PlanRoot .Badge, .PlanRoot .Notice, .PlanRoot .Source {
    color:#ffffff !important;
  }

  /* 1) Kill any gradient text that made things transparent */
  .PlanRoot .PanelHeader,
  .PlanRoot .BlockKind {
    background:none !important;
    -webkit-background-clip:initial !important;
    background-clip:initial !important;
    -webkit-text-fill-color:#ffffff !important;
    color:#ffffff !important;
  }

  /* 2) Inputs, selects, textareas: white text + visible placeholder */
  .PlanRoot input.Field,
  .PlanRoot select.Field,
  .PlanRoot textarea.Field {
    color:#ffffff !important;
    background:var(--surface-dark) !important;
    border-color:var(--border-dark) !important;
  }
  .PlanRoot .Field::placeholder { color:rgba(255,255,255,0.88) !important; }
  .PlanRoot select.Field option {
    color:#ffffff !important;
    background:#0B0F14 !important;
  }

  /* 3) Icons (lucide-react uses stroke) */
  .PlanRoot svg { stroke:#ffffff !important; }

  /* 4) Chips/Pills keep their backgrounds but their text is white */
  .PlanRoot .Chip,
  .PlanRoot .Pill,
  .PlanRoot .TilePill {
    color:#ffffff !important;
  }

  /* 5) Table text in preview/export area */
  .PlanRoot .PreviewTable th,
  .PlanRoot .PreviewTable td { color:#ffffff !important; }
}
/* === FORCE WHITE TEXT WHEN THE APP IS IN DARK MODE (html.dark) ============ */
/* Your app toggles dark with <html class="dark">, not via prefers-color-scheme.
   These rules override colors so all words/icons render white in dark mode. */

html.dark .PlanRoot,
html.dark .PlanRoot h1, html.dark .PlanRoot h2, html.dark .PlanRoot h3,
html.dark .PlanRoot h4, html.dark .PlanRoot h5, html.dark .PlanRoot h6,
html.dark .PlanRoot p,  html.dark .PlanRoot span, html.dark .PlanRoot small,
html.dark .PlanRoot strong, html.dark .PlanRoot em,
html.dark .PlanRoot label, html.dark .PlanRoot legend, html.dark .PlanRoot summary,
html.dark .PlanRoot dt, html.dark .PlanRoot dd,
html.dark .PlanRoot th, html.dark .PlanRoot td,
html.dark .PlanRoot .Label,
html.dark .PlanRoot .PanelSubhead,
html.dark .PlanRoot .DayTitle,
html.dark .PlanRoot .DaySummary,
html.dark .PlanRoot .Badge,
html.dark .PlanRoot .Notice,
html.dark .PlanRoot .Source {
  color:#ffffff !important;
}

/* Kill gradient text (which made color transparent) */
html.dark .PlanRoot .PanelHeader,
html.dark .PlanRoot .BlockKind {
  background:none !important;
  -webkit-background-clip:initial !important;
  background-clip:initial !important;
  -webkit-text-fill-color:#ffffff !important;
  color:#ffffff !important;
}

/* Inputs/selects/textarea text + placeholder */
html.dark .PlanRoot input.Field,
html.dark .PlanRoot select.Field,
html.dark .PlanRoot textarea.Field {
  color:#ffffff !important;
  background:var(--surface-dark) !important;
  border-color:var(--border-dark) !important;
}
html.dark .PlanRoot .Field::placeholder { color:rgba(255,255,255,0.88) !important; }
html.dark select.Field option { color:#ffffff !important; background:#0B0F14 !important; }

/* Icons (lucide uses stroke) */
html.dark .PlanRoot svg { stroke:#ffffff !important; }

/* Chips / pills / tile pills keep backgrounds but text is white */
html.dark .PlanRoot .Chip,
html.dark .PlanRoot .Pill,
html.dark .PlanRoot .TilePill { color:#ffffff !important; }
/* === Dark mode EXCEPTION: detailed cards use dark text ===================== */
/* Your expanded "Show details" content lives inside .Card containers which
   have a light/paper background. Use dark text there for readability. */

html.dark .PlanRoot .Card,
html.dark .PlanRoot .Card * {
  color:#0b121a !important;           /* near-black */
}

/* Headings inside the card (kill gradient/transparent & force dark) */
html.dark .PlanRoot .Card .BlockKind,
html.dark .PlanRoot .Card .DayTitle,
html.dark .PlanRoot .Card .PanelHeader {
  background:none !important;
  -webkit-background-clip:initial !important;
  background-clip:initial !important;
  -webkit-text-fill-color:#0b121a !important;
  color:#0b121a !important;
}

/* Icons inside the card */
html.dark .PlanRoot .Card svg {
  stroke:#0b121a !important;
}

/* Pills/chips inside the card (keep your purple accents, dark text) */
html.dark .PlanRoot .Card .Pill,
html.dark .PlanRoot .Card .Chip,
html.dark .PlanRoot .Card .TilePill {
  color:#4c1d95 !important;                         /* brand purple text */
  background:rgba(139,92,246,0.12) !important;
  border-color:rgba(139,92,246,0.25) !important;
}

/* Optional: light gray dividers already in your .Block — keep them subtle */
html.dark .PlanRoot .Card .Block {
  border-top:1px solid rgba(17,24,39,0.12) !important;
}


`}</style>
    </div>
  )
}
