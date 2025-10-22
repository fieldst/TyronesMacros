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
import { createClient } from '@supabase/supabase-js';
import { saveWorkoutPlan } from '../services/savedWorkoutsService';


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
function saveLS<T>(key: string, v: T) {
  try { if (typeof window !== 'undefined') localStorage.setItem(key, JSON.stringify(v)) } catch {}
}
function loadLS<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined') return fallback as T;
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch { return fallback }
}

type Move = { name: string; equip: 'barbell'|'dumbbell'|'kettlebell'|'cardio'|'bodyweight'; tags: string[] }

// --- Map AI Coach text -> style + days/week (best-effort parsing) ---
function mapCoachHeaderToStyle(header: string): string | null {
  const h = (header || '').toLowerCase();
  if (!h) return null;
  if (h.includes('hybrid')) return 'hybrid';
  if (h.includes('crossfit')) return 'crossfit';
  if (h.includes('strength')) return 'strength';
  if (h.includes('endurance')) return 'endurance';
  if (h.includes('bodyweight')) return 'bodyweight';
  return null;
}

function parseDaysFromCoachText(...chunks: (string | undefined)[]): number | null {
  const txt = chunks.filter(Boolean).join(' ').toLowerCase();
  if (!txt) return null;

  // Case like: "4 lifting days + 2 short cardio sessions" -> 6
  const nums = [...txt.matchAll(/(\d+)\s*(?:day|days)/g)].map(m => parseInt(m[1], 10));
  if (nums.length >= 2) {
    const sum = nums.reduce((a, b) => a + b, 0);
    return Math.min(7, Math.max(1, sum));
  }
  if (nums.length === 1) {
    return Math.min(7, Math.max(1, nums[0]));
  }

  // Fallback: look for "(\d+)\s*(?:x|sessions)" if days word not present
  const first = txt.match(/(\d+)\s*(?:x|sessions?)/);
  if (first) return Math.min(7, Math.max(1, parseInt(first[1], 10)));

  return null;
}

/** Export to avoid noUnusedLocals build errors while keeping the dataset available */
export const MOVES: Move[] = [
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
// Mobile-safe integer parsing: digits only, clamped to a range.
const parseIntSafe = (raw: string, min = 1, max = 999): number | undefined => {
  const digits = (raw || "").replace(/\D+/g, "");
  if (!digits) return undefined;
  const n = Math.max(min, Math.min(max, parseInt(digits, 10)));
  return Number.isFinite(n) ? n : undefined;
};

export function editDist(a: string, b: string) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

export const EQUIP_CANONICAL = [
  { key: 'bike',       words: ['assault bike','air bike','soft bike','spin bike','bike','cycle','cycling'] },
  { key: 'treadmill',  words: ['treadmill','tread'] },
  { key: 'rower',      words: ['rower','row machine','row','rowing','erg','concept2 rower'] },
  { key: 'elliptical', words: ['elliptical','cross trainer','elyptical','eliptical','elipse','ellipse','elypse','elypsed'] },
  { key: 'kb',         words: ['kettlebell','kettle bell','kb'] },
  { key: 'db',         words: ['dumbbell','dumbbells','db'] },
  { key: 'barbell',    words: ['barbell','bb'] },
];

export function bestEquipmentSuggestion(raw: string) {
  const s = (raw || '').toLowerCase().trim();
  let best: {label: string, score: number} | null = null;
  for (const c of EQUIP_CANONICAL) {
    for (const w of c.words) {
      const d = editDist(s, w.toLowerCase());
      if (!best || d < best.score) best = { label: w, score: d };
      if (s === w.toLowerCase()) return { label: w, score: 0 };
    }
  }
  return best;  // may be null
}

async function saveUserEquipment(
  supabase: any,
  userId: string,
  equipmentList: string[]
): Promise<void> {
  if (!supabase || !userId) return;

  const arr = Array.isArray(equipmentList) ? equipmentList : [];

  const norm = Array.from(
    new Set(
      arr
        .map(s => String(s || '').trim().toLowerCase())
        .map(s => {
          if ([
            'assault bike','air bike','soft bike','spin bike','echo bike','airdyne',
            'a salt bike','assalt bike','assult bike'
          ].includes(s)) {
            return 'assault bike';
          }
          return s;
        })
        .filter(Boolean)
    )
  );

  await supabase
    .from('user_equipment')
    .upsert(
      { user_id: userId, equipment: norm, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}


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
          kind: (inferBlockTitle(String(b.text||''), String(b.kind||'')) as any),
          text: String(b.text || ''),
          minutes: typeof b.minutes === 'number' ? b.minutes : undefined,
          loadPct1RM: typeof b.loadPct1RM === 'number' ? b.loadPct1RM : undefined,
          loadRx: typeof b.loadRx === 'string' ? b.loadRx : (suggestLoadRx(String(b.text||'')) || undefined),
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
          kind: inferBlockTitle(String(line||''), idx===0 ? 'workout' : 'workout'),
          text: line,
          loadRx: suggestLoadRx(String(line||'')) || undefined,
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
    // ensure style is always present/normalized
    const effectiveStyle = autoStyleForEquipment(normalizeStyle(meta.style), equip);

    const payload = {
      minutes: normalizeNumber(meta.minutesPerDay, 40),
      days:    normalizeNumber(meta.daysPerWeek, 3),
      goal:       normalizeGoal(meta.goal),
      style:      effectiveStyle,
      intensity:  normalizeIntensity(meta.intensity),
      experience: normalizeExperience(meta.experience),
      focus:      (meta.focusAreas || []).map(toStr).filter(Boolean) as string[],
      equipment:  toEquipmentArray(meta.equipment, equip),
    };

    // quick client-side sanity check
    if (!payload.minutes || !payload.days || !payload.goal || !payload.style) return null;

    const res = await fetch("/api/plan-week", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // ✅ important: treat 4xx/5xx as failure
    if (!res.ok) {
      console.error("plan-week failed:", res.status, await res.text());
      return null;
    }

    const data: ApiPlanResponse = await res.json();
    const weekRaw = data?.data?.week;
    if (!data.success || !Array.isArray(weekRaw)) return null;

    const mapped = mapServerWeekToPlanDays(weekRaw);
    return mapped.length ? mapped : null;
  } catch (e) {
    console.error("fetchPlanFromApi error:", e);
    return null;
  }
}


/* ── UI components ─────────────────────────────────────────────────────────── */
function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`Btn ${props.className||''}`}>{props.children}</button> }
function Card({children}:{children:React.ReactNode}){ return <div className="Card">{children}</div> }

/* Compact block tile used in the collapsed view */
function BlockTile({ b }: { b: PlanBlock }) {
  return (
    <div className={`Tile Tile-${b.kind || "workout"}`}>
      <div className="TileKind">{inferBlockTitle(b.text, String(b.kind||''))}</div>
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
      <div className="BlockKind">{inferBlockTitle(b.text, String(b.kind||''))}</div>
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



function inferBlockTitle(text: string, fallback: string): string {
  const t = (text||'').toLowerCase();
  if (/\bamrap\b|as many reps/i.test(t)) return 'AMRAP';
  if (/\bfor\s*time\b|\bfor time\b/i.test(t)) return 'For Time';
  if (/\btabata\b|\b20\s*sec\b.*\b10\s*sec\b/i.test(t)) return 'Tabata';
  if (/\bemom\b|every\s*minute\s*on\s*the\s*minute/i.test(t)) return 'EMOM';
  if (/(back|front)?\s*squat|deadlift|bench|press|clean|snatch|row\s*@|db|kb|barbell|sets?\s*x\s*reps?/i.test(t)) return 'Strength';
  return fallback || 'Workout';
}

async function loadUserEquipment(supabase: any, userId: string): Promise<string[]> {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('user_equipment')
    .select('equipment')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return [];
  return (data?.equipment ?? []) as string[];
}


// === Equipment persistence helper (server) ===


function suggestLoadRx(text: string): string | null {
  try {
    const ep = loadEquipmentProfile();
    const t = (text||'').toLowerCase();
    if (/barbell|back squat|front squat|deadlift|bench|press|clean|snatch/.test(t)) {
      const max = typeof ep.barbellMax === 'number' ? ep.barbellMax : 0;
      if (max > 0) {
        const pct = /3x|3 x|triple|heavy/.test(t) ? 0.82 : /5x|5 x/.test(t) ? 0.7 : 0.75;
        return `${Math.round(max * pct)} lb @ ~${Math.round(pct*100)}%`;
      }
    }
    if (/db|dumbbell/.test(t)) {
      const db = Array.isArray(ep.dumbbells) ? ep.dumbbells.slice().sort((a,b)=>a-b) : [];
      if (db.length) {
        const idx = Math.max(0, Math.min(db.length-1, Math.floor(db.length*0.66)));
        return `${db[idx]} lb DBs (pair)`;
      }
    }
    if (/kb|kettlebell|swing|goblet/.test(t)) {
      const kb = Array.isArray(ep.kettlebells) ? ep.kettlebells.slice().sort((a,b)=>a-b) : [];
      if (kb.length) {
        const idx = Math.max(0, Math.min(kb.length-1, Math.floor(kb.length*0.66)));
        return `${kb[idx]} lb KB`;
      }
    }
    if (/run|row|bike|assault/.test(t)) return 'RPE 7–8';
    return null;
  } catch { return null; }
}
/* ── Map TargetsView styleCoach text → our internal Style ─────────────────── */
function mapCoachTextToStyle(header: string, bullets: string[]): Style | null {
  const h = (header || '').toLowerCase();
  const all = (h + ' ' + (bullets || []).join(' ')).toLowerCase();

  if (/\bppl|push[-\s]?pull[-\s]?legs|upper\/lower|powerbuilding|strength/.test(all)) return 'strength';
  if (/\bfull[-\s]?body|3x|three times|three days/.test(all)) return 'conditioning';
  if (/\bcrossfit|functional|metcon|wod/.test(all)) return 'crossfit';
  if (/\bhiit|circuit|emom|interval|tabata/.test(all)) return 'circuit';
  if (/\bbodyweight|calisthenic/.test(all)) return 'bodyweight';
  if (/\bkettlebell|kb\b/.test(all)) return 'tabata';
  if (/\bhybrid|strength\s*\+\s*endurance|run|bike|row/.test(all)) return 'hybrid';

  return null;
}

/* ── Auto-style fallback based on equipment chips ─────────────────────────── */
function autoStyleForEquipment(current: Style, eq: EquipmentProfile): Style {
  const hasDB  = Array.isArray(eq.dumbbells) && eq.dumbbells.length > 0;
  const hasKB  = Array.isArray(eq.kettlebells) && eq.kettlebells.length > 0;
  const hasBAR = typeof eq.barbellMax === 'number' && eq.barbellMax > 0;

  if (!hasDB && !hasKB && !hasBAR) return 'bodyweight'; // nothing → Bodyweight
  if (!hasBAR && !hasDB && hasKB)  return 'tabata';     // KB-only → Kettlebell-centric
  if (!hasBAR && hasDB && !hasKB)  return 'circuit';    // DB-only → Circuit
  return current;
}

/* ── MAIN (API-only) ───────────────────────────────────────────────────────── */
export default function WeeklyWorkoutPlan() {
  const [meta, setMeta] = useState<PlanMeta>(() => loadLS<PlanMeta>(LS_META, {
    goal: 'recomp', style: 'hybrid', experience: 'intermediate', intensity: 'moderate',
    daysPerWeek: 3, minutesPerDay: 40, focusAreas: [], equipment: [],
  }))
  const [coachStyle, setCoachStyle] =
    useState<{ header: string; bullets: string[] } | null>(null)
  const [equipToast, setEquipToast] = React.useState<string | null>(null);
  const [equipToastAction, setEquipToastAction] = React.useState<null | {label:string; onClick:() => void}>(null);
  const [equipToastKind, setEquipToastKind] = React.useState<'info'|'error'>('info');
  const [week, setWeek] = useState<PlanDay[]>(() => loadLS<PlanDay[]>(LS_PLAN, []))
  const [loading, setLoading] = useState(false)
  const [equip, setEquip] = useState<EquipmentProfile>(() => loadEquipmentProfile())
  const [parseText, setParseText] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  // --- Supabase client + user id ------------------------------------------------
  const supabase = React.useMemo(() => {
    try {
      return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
      );
    } catch {
      return null;
    }
  }, []);

  const [userId, setUserId] = React.useState<string | null>(null);

  const [source, setSource] = useState<'AI API' | 'AI API (empty)'>('AI API')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => { saveLS(LS_META, meta) }, [meta])
  useEffect(() => { saveLS(LS_PLAN, week) }, [week])
  useEffect(() => { saveEquipmentProfile(equip) }, [equip])
  useEffect(() => {
    (async () => {
      try { setUserId(await getCurrentUserId()); } catch { setUserId(null); }
    })();
  }, []);

  // Get the logged-in user id once (on mount)
  React.useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUserId(session?.user?.id ?? null);
    })();
  }, [supabase]);

  // Load remote equipment once userId is known (merge with local)
  React.useEffect(() => {
    if (!supabase || !userId) return;
    (async () => {
      const remote = await loadUserEquipment(supabase, userId);
      if (remote.length) {
        setMeta(m => {
          const current = (m.equipment || []) as string[];
          if (!current.length) return { ...m, equipment: remote };
          const merged = Array.from(new Set([...current, ...remote]));
          return { ...m, equipment: merged };
        });
        try { localStorage.setItem('tm:plannedWeek_equipment_extra', JSON.stringify(remote)); } catch {}
      }
    })();
  }, [supabase, userId]);

  // Debounced remote save whenever local chips change
  React.useEffect(() => {
    if (!supabase || !userId) return;
    const t = setTimeout(() => { saveUserEquipment(supabase, userId, meta.equipment || []); }, 600);
    return () => clearTimeout(t);
  }, [supabase, userId, meta.equipment]);


 // Suggest style/goal from Active Target (pre-fill only; never overwrite user choice)
useEffect(() => {
  (async () => {
    // If user already has saved meta, don't change their choices
    try { if (localStorage.getItem(LS_META)) return; } catch {}

    const uid = await getCurrentUserId().catch(() => null);
    if (!uid) return;

    const t = await fetchCurrentTargetText(uid);
    const maybeStyle = workoutStyleSuggestion(t || '');
    const sGoal = (t || '').toLowerCase();
    const targGoal: Goal | null =
      /(cut|deficit|shred)/.test(sGoal) ? 'cut' :
      /(bulk|gain|surplus)/.test(sGoal) ? 'bulk' :
      /(lean|recomp|maint)/.test(sGoal) ? 'recomp' : null;

    setMeta(m => ({
      ...m,
      // only fill if empty/unset
      style: (!m.style || m.style === 'choose' || m.style === '') && maybeStyle
        ? (maybeStyle as Style)
        : m.style,
      goal: m.goal ?? (targGoal ?? 'recomp'),
    }));
  })();
}, []);


 // Default Style + Days/Week from AI Coach when fields are empty (never overwrite user choice)
useEffect(() => {
  // Read the same object your TargetsView stores
  let coach: any = null;
  try {
    const raw = localStorage.getItem('aiCoachTargetsSuggestion');
    if (raw) {
      const parsed = JSON.parse(raw);
      coach = parsed?.styleCoach || parsed?.workoutStyle || parsed;
    }
  } catch {}

  if (!coach) return;

  const header  = (coach?.header  || '').toString();
  const bullets = Array.isArray(coach?.bullets) ? coach.bullets.map(String) : [];

  // Prefer your existing mapper if present
  let mappedStyle: string | null = null;
  try { /* @ts-ignore */ mappedStyle = mapCoachTextToStyle ? mapCoachTextToStyle(header, bullets) : null; } catch {}
  if (!mappedStyle) mappedStyle = mapCoachHeaderToStyle(header);

  // Parse "4 lifting days + 2 short cardio sessions" → 6 (cap 1..7)
  const joined = [header, bullets.join(' ')].join(' ').toLowerCase();
  const nums = [...joined.matchAll(/(\d+)\s*(?:day|days|x|sessions?)/g)].map(m => parseInt(m[1], 10));
  const aiDays = nums.length ? Math.min(7, Math.max(1, nums.length > 1 ? nums.reduce((a,b)=>a+b,0) : nums[0])) : null;

  // Only fill blanks; if user already picked values, leave them alone
  setMeta(m => ({
    ...m,
    style: (!m.style || m.style === 'choose' || m.style === '') && mappedStyle
      ? (mappedStyle as any)
      : m.style,
    daysPerWeek: (!m.daysPerWeek || Number(m.daysPerWeek) <= 0) && typeof aiDays === 'number'
      ? aiDays
      : m.daysPerWeek,
  }));
}, []); // one-time; your existing saveLS(meta) preserves edits
 


  // Pull style from TargetsView cache (pre-fill only; never overwrite user choice)
useEffect(() => {
  try {
    // If user has saved meta already, don't change their choices
    if (localStorage.getItem(LS_META)) return;

    const raw = localStorage.getItem('aiCoachTargetsSuggestion');
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const sc = parsed?.styleCoach || parsed?.workoutStyle;
    if (sc && (sc.header || (sc.bullets || []).length)) {
      const mapped = mapCoachTextToStyle(sc.header || '', sc.bullets || []);
      if (mapped) {
        setMeta(m => ({
          ...m,
          // only fill if style is empty/unset
          style: (!m.style || m.style === 'choose' || m.style === '')
            ? mapped
            : m.style,
        }));
      }
    }
  } catch { /* ignore */ }
}, []);



  useEffect(() => {
    try {
      const raw = localStorage.getItem('aiCoachTargetsSuggestion')
      if (!raw) return
      const parsed = JSON.parse(raw)
      const sc = parsed?.styleCoach || parsed?.workoutStyle
      if (sc && (sc.header || (sc.bullets || []).length)) {
        setCoachStyle({
          header: sc.header || '',
          bullets: Array.isArray(sc.bullets) ? sc.bullets.slice(0, 3) : []
        })
      }
    } catch { /* ignore */ }
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

  // Scoped (component) fuzzy matchers for free-text equipment input
  function editDistLocal(a: string, b: string) { return editDist(a,b); }
  const EQUIP_CANONICAL_LOCAL = EQUIP_CANONICAL;
  function bestEquipmentSuggestionLocal(raw: string) { return bestEquipmentSuggestion(raw); }

  // API-ONLY generation
  async function onGenerate() {
    try {
      setLoading(true);
      setNotice(null);

      const apiWeek = await fetchPlanFromApi(meta, equip);

      if (!apiWeek || apiWeek.length === 0) {
        setWeek([]);
        setNotice(
          "The AI API returned no workouts to render. Double-check: Goal, Style, Days/Week, Minutes/Day, and Equipment. If all fields look good, adjust the server formatter to always include at least one item in `main`."
        );
        return;
      }

      setWeek(apiWeek);
    } catch (err) {
      console.error("onGenerate error:", err);
      setNotice("Could not generate plan. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function addEquipmentFromInput() {
    const raw = (tempEquipment || '').trim();
    if (!raw) return;

    const tokens = raw.split(',').map(s => s.trim()).filter(Boolean);

    setMeta(m => {
      const prev = (m.equipment || []) as string[];
      const lowerPrev = new Set(prev.map(x => x.toLowerCase()));

      const toAdd: string[] = [];
      let firstUnk: string | null = null;
      let firstSuggestion: string | null = null;

      for (const t of tokens) {
        const tl = t.toLowerCase();
        if (lowerPrev.has(tl)) continue;

        const best = bestEquipmentSuggestionLocal(tl);
        if (best && best.score <= 2) {
          firstSuggestion = firstSuggestion || best.label; // show once
        } else {
          firstUnk = firstUnk || t;
        }
        toAdd.push(tl);
        lowerPrev.add(tl);
      }

      if (firstSuggestion) {
        setEquipToastKind('info');
        setEquipToast(`Did you mean “${firstSuggestion}”?`);
        setEquipToastAction({
          label: `Add ${firstSuggestion}`,
          onClick: () => {
            setMeta(mm => ({
              ...mm,
              equipment: Array.from(new Set([...(mm.equipment || []), firstSuggestion!.toLowerCase()])),
            }));
            setEquipToast(null); setEquipToastAction(null);
          }
        });
      } else if (firstUnk) {
        setEquipToastKind('error');
        setEquipToast(`Not recognized: “${firstUnk}”. We’ll still generate a plan, but suggestions may not use it.`);
        setEquipToastAction(null);
        setTimeout(() => { setEquipToast(null); setEquipToastAction(null); }, 4000);
      }

      return { ...m, equipment: Array.from(lowerPrev) };
    });

    setTempEquipment('');
    setTimeout(() => { setEquipToast(null); setEquipToastAction(null); }, 6000);
  }

  const [tempEquipment, setTempEquipment] = React.useState<string>('');
  const [focusInput, setFocusInput] = React.useState('')
  const MAX_FOCUS = 10;

  function addFocus() {
    const v = focusInput.trim().toLowerCase()
    if (!v) return
    setMeta(m => ({
      ...m,
      focusAreas: Array.from(new Set([...(m.focusAreas || []), v])).slice(0, 10),
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
      activity:
        (b?.text && String(b.text).trim()) ||
        (b?.name && String(b.name).trim()) ||
        (b?.kind ? b.kind.charAt(0).toUpperCase() + b.kind.slice(1) : "Workout"),
      minutes: typeof b?.minutes === "number" ? b.minutes : null,
      calories_burned: Math.max(0, Math.round(((typeof b?.minutes === "number" ? b.minutes : 10) * 7))),
      intensity: (typeof meta?.intensity === "string" ? meta.intensity : null),
      source: "plan",
      order_index: i,
      description: b?.text || null,
    }));

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

  // 🚫 Require login: block this page when logged out
  if (!userId) {
    return (
      <div className="min-h-[100svh] w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
            <div className="text-lg font-semibold mb-1">Please sign in</div>
            <div className="text-sm text-neutral-500 dark:text-neutral-400">
              Weekly Plan is available for logged-in users. It’s totally free.
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => eventBus.emit('auth:open', { mode: 'sign-in' })}
                className="rounded-xl px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black"
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => eventBus.emit('auth:open', { mode: 'sign-up' })}
                className="rounded-xl px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-800"
              >
                Create a free account
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="PlanRoot">

      {/* Equipment recognition toast (non-blocking) */}
      {equipToast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
          <div
            className={`rounded-xl px-4 py-2 shadow-lg flex items-center gap-3
        ${equipToastKind === 'error' ? 'bg-red-600 text-white' : 'bg-black/85 text-white'}`}
          >
            <span className="text-sm">{equipToast}</span>
            {equipToastAction && (
              <button
                className="text-sm underline decoration-purple-300 underline-offset-4"
                onClick={equipToastAction.onClick}
              >
                {equipToastAction.label}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="Panel">
        <div className="PanelHeader">
          <Dumbbell className="mr-2" /> Weekly Workout Planner <span className="Source">• {source}</span>
        </div>
        {/* AI Coach suggestion pill row (from Targets page cache) */}
        {coachStyle && (
          <div className="Row" style={{ marginTop: 6, marginBottom: 6 }}>
            <span className="Pill">AI Coach: {coachStyle.header}</span>
            {Array.isArray(coachStyle.bullets) && coachStyle.bullets.slice(0, 2).map((b, i) => (
              <span key={i} className="Pill">{b}</span>
            ))}
          </div>
        )}


        {/* Controls section (dim while loading) */}
        <div className={loading ? 'pointer-events-none opacity-70 transition' : 'transition'}>
          {/* Meta controls */}
          <div className="Grid">
            <div className="Col">
              <label className="Label">Goal</label>
              <select className="Field select-dark bg-neutral-900 text-neutral-100 border border-neutral-700 focus:ring-2 focus:ring-purple-500" value={meta.goal} onChange={e => setMeta(m => ({...m, goal: e.target.value as Goal}))}>
                <option value="cut">cut</option><option value="lean">lean</option><option value="recomp">recomp</option><option value="bulk">bulk</option>
              </select>
            </div>
            <div className="Col">
              <label className="Label">Experience</label>
              <select className="Field select-dark bg-neutral-900 text-neutral-100 border border-neutral-700 focus:ring-2 focus:ring-purple-500" value={meta.experience} onChange={e => setMeta(m => ({...m, experience: e.target.value as Experience}))}>
                <option value="beginner">beginner</option><option value="intermediate">intermediate</option><option value="advanced">advanced</option>
              </select>
            </div>
            <div className="Col">
              <label className="Label">Intensity</label>
              <select className="Field select-dark bg-neutral-900 text-neutral-100 border border-neutral-700 focus:ring-2 focus:ring-purple-500" value={meta.intensity} onChange={e => setMeta(m => ({...m, intensity: e.target.value as Intensity}))}>
                <option value="low">low</option><option value="moderate">moderate</option><option value="high">high</option>
              </select>
            </div>
            <div className="Col">
              <label className="Label">Style</label>
              <select className="Field select-dark bg-neutral-900 text-neutral-100 border border-neutral-700 focus:ring-2 focus:ring-purple-500" value={meta.style} onChange={e => setMeta(m => ({...m, style: e.target.value as Style}))}>
                {Array.from(ALLOWED_STYLES).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="Col">
              <label className="Label">Days / Week</label>

              <select
                className="Field select-dark bg-neutral-900 text-neutral-100 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                value={meta.daysPerWeek}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, daysPerWeek: Number(e.target.value) }))
                }
              >
                {[2,3,4,5,6,7,8,9,10].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </div>

            <div className="Col">
              <label className="Label">Minutes / Day</label>

              <select
                className="Field select-dark bg-neutral-900 text-neutral-100 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                value={meta.minutesPerDay}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, minutesPerDay: Number(e.target.value) }))
                }
              >
                {[20,30,40,45,60,75,90].map((mins) => (
                  <option key={mins} value={mins}>{mins} min</option>
                ))}
              </select>
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
                {equip.dumbbells.map((n) => (
                  <span key={`db-${n}`} className="Chip" data-selected="true">
                    {n}<span className="ChipUnit"> LB</span> <button onClick={() => removeDB(n)}>×</button>
                  </span>
                ))}
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
                {equip.kettlebells.map((n) => (
                  <span key={`kb-${n}`} className="Chip" data-selected="true">
                    {n}<span className="ChipUnit"> LB</span> <button onClick={() => removeKB(n)}>×</button>
                  </span>
                ))}
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

          {/* Equipment free-text add */}
          <div className="Col col-span-2">
            <label className="Label">Add any extra equipment that you may have</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {(meta.equipment || []).map((eq: string, idx: number) => (
                <span
                  key={eq + idx}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                >
                  {eq}
                  <button
                    type="button"
                    aria-label={`Remove ${eq}`}
                    className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                    onClick={() =>
                      setMeta(m => ({
                        ...m,
                        equipment: (m.equipment || []).filter((x: string, i: number) => i !== idx),
                      }))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              {(!meta.equipment || meta.equipment.length === 0) && (
                <span className="text-xs text-neutral-500">No equipment added yet.</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="text"
                placeholder="e.g., soft bike, treadmill, rower, elliptical"
                className="Field flex-1 bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700"
                value={tempEquipment || ''}
                onChange={(e) => setTempEquipment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { addEquipmentFromInput(); }
                }}
              />
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-700"
                onClick={addEquipmentFromInput}
              >
                Add
              </button>
            </div>

            <div className="mt-1 text-xs text-neutral-500">
              Tip: add several at once with commas — e.g. <em>soft bike, treadmill, rower</em>
            </div>
          </div>
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
                <Btn onClick={async ()=>{ try { await saveWorkoutPlan(`Plan – ${d.title ?? d.id}`, d); } catch(e){} }}><Copy className="mr-1" /> Save</Btn>
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

/* Selected equipment chips: make them stand out from the purple add buttons */
/* Selected equipment chips: subtle, tidy, and distinct from purple add-buttons */
.Chip[data-selected="true"]{
  background:#e8fff5;
  border-color:#86efac;
  box-shadow: inset 0 0 0 1px rgba(16,185,129,.22);
  color:#065f46 !important;
  -webkit-text-fill-color:#065f46 !important;
}
.Chip[data-selected="true"] *{
  color:#065f46 !important;
  -webkit-text-fill-color:#065f46 !important;
  opacity:1 !important;
}

/* Unit text for selected chips */
.Chip[data-selected="true"] .ChipUnit{
  margin-left: 4px;
  font-size: .85em;
  letter-spacing: .02em;
  opacity: .8;
  text-transform: uppercase; /* ensures LB stays upper */
}

/* Dark mode tweak (keeps contrast consistent) */
@media (prefers-color-scheme: dark){
  .Chip[data-selected="true"] .ChipUnit{
    opacity: .9;
  }
}


@media (prefers-color-scheme: dark){
  .Chip[data-selected="true"]{
    background:rgba(16,185,129,.18);
    border-color:#047857;
    box-shadow: inset 0 0 0 1px rgba(16,185,129,.28);
    color:#d1fae5 !important;
    -webkit-text-fill-color:#d1fae5 !important;
  }
  .Chip[data-selected="true"] *{
    color:#d1fae5 !important;
    -webkit-text-fill-color:#d1fae5 !important;
  }
}


/* tiny check mark at the start (no SVGs, no layout shift) */
.Chip[data-selected="true"]::before{
  content:"✓";
  font-weight:700;
  margin-right:6px;
  line-height:1;
  opacity:.9;
}

/* Dark mode version */
@media (prefers-color-scheme: dark){
  .Chip[data-selected="true"]{
    background:rgba(16,185,129,.18);
    color:#d1fae5;                   /* emerald-100 text */
    border-color:#047857;            /* emerald-700 */
    box-shadow: inset 0 0 0 1px rgba(16,185,129,.28);
  }
  .Chip[data-selected="true"]::before{
    opacity:.95;
  }
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
select,
select.Field {
  background-color: #0b0b0d !important;
  color: #e6e7eb !important;
  -webkit-text-fill-color: #e6e7eb !important;
  border-color: #3a3b42 !important;
}
option { color: #0b0b0d; background: #e6e7eb; } /* option list when open */

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

/* === Dark mode: keep card text HIGH CONTRAST (white) ====================== */
/* === Dark mode: do NOT hard-force card text; inherit from page = safe for light or dark cards */
html.dark .PlanRoot {
  color: #e6e7eb; /* page text in dark mode */
}

/* Let cards inherit the page color so they work whether the card surface is light or dark */
html.dark .PlanRoot .Card,
html.dark .PlanRoot .Card * {
  color: inherit !important;
  -webkit-text-fill-color: inherit !important; /* iOS */
}

/* Headings in cards: remove gradient clipping; still inherit color */
html.dark .PlanRoot .Card .BlockKind,
html.dark .PlanRoot .Card .DayTitle,
html.dark .PlanRoot .Card .PanelHeader {
  background: none !important;
  -webkit-background-clip: initial !important;
  background-clip: initial !important;
  -webkit-text-fill-color: inherit !important;
  color: inherit !important;
}

/* Icons should follow the text color */
html.dark .PlanRoot .Card svg {
  stroke: currentColor !important;
}

/* Pills/chips keep contrast on dark pages but won’t break light cards */
html.dark .PlanRoot .Card .Pill,
html.dark .PlanRoot .Card .Chip,
html.dark .PlanRoot .Card .TilePill {
  color: inherit !important; /* text follows page color */
  border-color: rgba(139,92,246,0.35) !important;
  background: rgba(139,92,246,0.18) !important; /* subtle purple tint */
}

/* Dividers – subtle in dark mode */
html.dark .PlanRoot .Card .Block {
  border-top: 1px solid rgba(255,255,255,0.14) !important;
}


/* Headings inside the card (kill gradient transparency, keep white) */
html.dark .PlanRoot .Card .BlockKind,
html.dark .PlanRoot .Card .DayTitle,
html.dark .PlanRoot .Card .PanelHeader {
  background:none !important;
  -webkit-background-clip:initial !important;
  background-clip:initial !important;
  -webkit-text-fill-color:#ffffff !important;
  color:#ffffff !important;
}

/* Icons inside the card */
html.dark .PlanRoot .Card svg {
  stroke:#ffffff !important;
}

/* Pills/chips inside the card: keep purple backgrounds, white text */
html.dark .PlanRoot .Card .Pill,
html.dark .PlanRoot .Card .Chip,
html.dark .PlanRoot .Card .TilePill {
  color:#ffffff !important;
  background:rgba(139,92,246,0.22) !important;
  border-color:rgba(139,92,246,0.35) !important;
}

/* Subtle divider is fine to keep */
html.dark .PlanRoot .Card .Block {
  border-top:1px solid rgba(255,255,255,0.14) !important;
}

 @supports (-webkit-touch-callout: none) {
    .Field,
    input.Field,
    select.Field,
    textarea.Field,
    select,
    input,
    textarea {
      background-color: #0b0b0d !important;   /* dark neutral */
      color: #e6e7eb !important;              /* near-white text */
      -webkit-text-fill-color: #e6e7eb !important; /* iOS text color */
      border-color: #3a3b42 !important;
    }
    ::placeholder {
      color: #9aa0a6 !important;              /* readable placeholder */
      opacity: 1 !important;
    }
  }

/* === Weekly Plan: readable cards on iPhone (Dark Mode) ===================== */
/* Make the card surface light and the text black ONLY in dark mode. */
html.dark .PlanRoot .Card {
  background: #f4f6fa !important;        /* light surface so black text pops */
  box-shadow: 0 2px 10px rgba(0,0,0,0.25) !important;
}

/* Force black text inside the card (titles, labels, content) */
html.dark .PlanRoot .Card,
html.dark .PlanRoot .Card * {
  color: #0b121a !important;              /* near-black text */
  -webkit-text-fill-color: #0b121a !important;  /* iOS Safari */
}

/* Headings that previously used gradient/transparent fill */
html.dark .PlanRoot .Card .BlockKind,
html.dark .PlanRoot .Card .DayTitle,
html.dark .PlanRoot .Card .PanelHeader {
  background: none !important;
  -webkit-background-clip: initial !important;
  background-clip: initial !important;
  -webkit-text-fill-color: #0b121a !important;
  color: #0b121a !important;
}

/* Icons follow text color */
html.dark .PlanRoot .Card svg {
  stroke: #0b121a !important;
}

/* Pills/chips inside the card: subtle purple tint with dark text */
html.dark .PlanRoot .Card .Pill,
html.dark .PlanRoot .Card .Chip,
html.dark .PlanRoot .Card .TilePill {
  color: #0b121a !important;                             /* dark text */
  background: rgba(139,92,246,0.15) !important;          /* light purple */
  border-color: rgba(139,92,246,0.30) !important;
}

/* Dividers inside card */
html.dark .PlanRoot .Card .Block {
  border-top: 1px solid rgba(17,24,39,0.12) !important;  /* subtle */
}

  /* Ensure “pills” have high-contrast text on dark backgrounds */
.Pill, .Badge, .btn-pill, .Chip:not([data-selected="true"]) {
  color: #ffffff !important;
}


  /* Make the workout cards and labels readable on mobile */
  @media (max-width: 640px) {
    .Panel, .WorkoutCard, .WorkoutDay, .Exercise {
      color: #e6e7eb !important;
    }
    .Label, .muted, .subtle {
      color: #c3c7cf !important;
    }
  }         
/* === LIGHT MODE FIXES: force readable dark text on light backgrounds ====== */
html:not(.dark) .PlanRoot,
html:not(.dark) .PlanRoot * {
  -webkit-text-fill-color: inherit; /* iOS: let text use the color we set below */
}

/* Selects: stop forcing dark theme in light mode */
html:not(.dark) select,
html:not(.dark) select.Field {
  background-color: #ffffff !important;
  color: #0b121a !important;
  -webkit-text-fill-color: #0b121a !important; /* iOS Safari */
  border-color: #d1d5db !important;            /* neutral-300 */
}
html:not(.dark) option {
  color: #0b121a;
  background: #ffffff;
}

/* Inputs / textareas */
html:not(.dark) input.Field,
html:not(.dark) textarea.Field {
  background: #ffffff !important;
  color: #0b121a !important;
  border-color: #d1d5db !important;
}
html:not(.dark) .Field::placeholder {
  color: rgba(0,0,0,0.55) !important;
}

/* Header text: remove gradient clipping in light for contrast */
html:not(.dark) .PanelHeader {
  background: none !important;
  -webkit-background-clip: initial !important;
  background-clip: initial !important;
  -webkit-text-fill-color: #4c1d95 !important;
  color: #4c1d95 !important; /* brand purple */
}

/* Ensure all the typical text bits render dark in light mode */
html:not(.dark) .Label,
html:not(.dark) .DayTitle,
html:not(.dark) .DaySummary,
html:not(.dark) .TileKind,
html:not(.dark) .TileText,
html:not(.dark) .Chip,
html:not(.dark) .Pill,
html:not(.dark) .TilePill {
  color: #0b121a !important; /* near-black */
}


`}</style>
    </div>
  )
}
