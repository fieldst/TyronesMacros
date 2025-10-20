// App.tsx
import React, { useEffect, useState } from 'react'

import TodayView from './components/TodayView'
import HistoryView from './components/HistoryView'
import TargetsView from './components/TargetsView'
import RateBanner from './components/RateBanner'
import WeeklyWorkoutPlan from './components/WeeklyWorkoutPlan'
import ThemeToggle from './components/ThemeToggle'
import SavedWorkouts from './components/SavedWorkouts'

import { getDisplayName, onAuthChange, signOut } from './auth'
import { getDailyTargets, todayDateString } from './db'
import { eventBus } from './lib/eventBus'
import AuthModal from './components/AuthModal'
import './lib/legacyGlue'
import Modal from './components/Modal'


type Tab = 'today' | 'history' | 'targets' | 'plan'
type MacroSet = { calories: number; protein: number; carbs: number; fat: number }

export default function App() {
  const [tab, setTab] = useState<Tab>('today')

// Auth UI
const [authOpen, setAuthOpen] = useState(false)
const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')

const openSignIn = () => {
  setAuthMode('sign-in'); setAuthOpen(true);
  try { eventBus.emit('auth:open', { mode: 'sign-in' }); } catch {}
}
const openSignUp = () => {
  setAuthMode('sign-up'); setAuthOpen(true);
  try { eventBus.emit('auth:open', { mode: 'sign-up' }); } catch {}
}



  // Auth UI
  const [displayName, setDisplayName] = useState<string | null>(null)

  // Current Goal Targets for TODAY
  const [currentGoalTargets, setCurrentGoalTargets] = useState<MacroSet>({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  })

  const dateStr = todayDateString()

  useEffect(() => {
  // Open the auth modal when other pages fire a global event
  const off = eventBus.on<{ mode?: 'sign-in' | 'sign-up' }>('auth:open', (payload) => {
    const mode = payload?.mode === 'sign-up' ? 'sign-up' : 'sign-in';
    setAuthMode(mode);
    setAuthOpen(true);
  });
  return () => off();
}, []);

  
  useEffect(() => {
    let mounted = true

    // initial auth name + subscribe to changes
    getDisplayName().then((n) => {
      if (mounted) setDisplayName(n)
    })
    const offAuth = onAuthChange(async (event?: any, session?: any) => {
  const n = await getDisplayName()
  if (mounted) {
    setDisplayName(n)
    if (n) setAuthOpen(false)   // ⬅ close modal on successful sign-in/up
  }
  try {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
      eventBus.emit('auth:changed', { event, userId: session?.user?.id ?? null })
    }
  } catch {}
})


    // react to Targets tab saves/suggestions
    const offBus = eventBus.on<MacroSet>('targets:update', (payload) => {
      setCurrentGoalTargets({
        calories: payload.calories ?? 0,
        protein: payload.protein ?? 0,
        carbs: payload.carbs ?? 0,
        fat: payload.fat ?? 0,
      })
    })

    ;(async () => {
      try {
        const t = await getDailyTargetsForToday()
        if (mounted && t) {
          setCurrentGoalTargets(t)
        }
        if (mounted && !t) {
          setCurrentGoalTargets({ calories: 0, protein: 0, carbs: 0, fat: 0 })
        }
      } catch {
        if (mounted) setCurrentGoalTargets({ calories: 0, protein: 0, carbs: 0, fat: 0 })
      }
    })()

    return () => {
      mounted = false
      offAuth()
      offBus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr])

  // Keep bottom nav glued to the bottom when soft keyboards open
  useEffect(() => {
    const vv = (window as any).visualViewport
    if (!vv) return

    const update = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--kb-offset', `${overlap}px`)
    }

    update()
    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [])

  async function getDailyTargetsForToday(): Promise<MacroSet | null> {
    try {
      const targets = await getDailyTargets()
      if (!targets) return null
      const t = targets[dateStr]
      if (!t) return null
      return {
        calories: Number(t.calories) || 0,
        protein: Number(t.protein) || 0,
        carbs: Number(t.carbs) || 0,
        fat: Number(t.fat) || 0,
      }
    } catch {
      return null
    }
  }

  return (
    <div className="min-h-[100lvh] flex flex-col bg-white text-black dark:bg-zinc-950 dark:text-zinc-50
 flex flex-col bg-white text-black dark:bg-zinc-950 dark:text-zinc-50">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto w-full max-w-[800px] px-4 h-14 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight mr-auto">
            Tyrone&apos;s Macros
          </h1>

          <div className="flex flex-wrap gap-2 items-center">
            <ThemeToggle />
            {displayName ? (
              <button
                onClick={() => signOut()}
                className="px-3 py-1 rounded-xl bg-gray-200 dark:bg-gray-700 dark:text-gray-100"
              >
                Sign out
              </button>
            ) : (
              <div className="flex gap-2">
  <button onClick={openSignIn} className="px-3 py-1 rounded-xl bg-gray-200 dark:bg-gray-700 dark:text-gray-100">
    Sign in
  </button>
  <button onClick={openSignUp} className="px-3 py-1 rounded-xl bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900">
    Sign up
  </button>
</div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[800px] px-4 pt-4 pb-[72px]">
          {tab === 'today' && (
            <TodayView
              profile={{}}
              targets={currentGoalTargets}
              onOpenPlanner={() => setTab('plan')}
            />
          )}
          {tab === 'history' && <HistoryView />}
          {tab === 'targets' && <TargetsView />}
          {tab === 'plan' && <WeeklyWorkoutPlan />}
          {tab === 'saved' && <SavedWorkouts />}
        </div>

        <RateBanner />
      </main>

      {/* Spacer to prevent overlap and layout shift */}
      <div style={{ height: 64 }} aria-hidden />

      {/* Fixed bottom navigation */}
      
  <nav
        className="fixed bottom-0 inset-x-0 z-40 border-t bg-white/95 dark:bg-zinc-950/95 backdrop-blur will-change-transform"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
        }}
        role="tablist"
        aria-label="Primary"
      >

        <div className="mx-auto w-full max-w-[800px] grid grid-cols-5">
          <button
            onClick={() => setTab('today')}
            role="tab"
            aria-selected={tab === 'today'}
            aria-current={tab === 'today' ? 'page' : undefined}
            className={`h-14 px-4 flex flex-col items-center justify-center text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand))] rounded-sm ${
              tab === 'today' ? 'font-semibold text-[rgb(var(--brand))]' : 'opacity-70 hover:opacity-100'
            }`}
          >
            <span>Today</span>
          </button>

          <button
            onClick={() => setTab('history')}
            role="tab"
            aria-selected={tab === 'history'}
            aria-current={tab === 'history' ? 'page' : undefined}
            className={`h-14 px-4 flex flex-col items-center justify-center text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand))] rounded-sm ${
              tab === 'history' ? 'font-semibold text-[rgb(var(--brand))]' : 'opacity-70 hover:opacity-100'
            }`}
          >
            <span>History</span>
          </button>

          <button
            onClick={() => setTab('targets')}
            role="tab"
            aria-selected={tab === 'targets'}
            aria-current={tab === 'targets' ? 'page' : undefined}
            className={`h-14 px-4 flex flex-col items-center justify-center text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand))] rounded-sm ${
              tab === 'targets' ? 'font-semibold text-[rgb(var(--brand))]' : 'opacity-70 hover:opacity-100'
            }`}
          >
            <span>Targets</span>
          </button>

          <button
            onClick={() => setTab('plan')}
            role="tab"
            aria-selected={tab === 'plan'}
            aria-current={tab === 'plan' ? 'page' : undefined}
            className={`h-14 px-4 flex flex-col items-center justify-center text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand))] rounded-sm ${
              tab === 'plan' ? 'font-semibold text-[rgb(var(--brand))]' : 'opacity-70 hover:opacity-100'
            }`}
          >
            <span>Weekly Plan</span>
          </button>

          <button
            onClick={() => setTab('saved')}
            role="tab"
            aria-selected={tab === 'saved'}
            aria-current={tab === 'saved' ? 'page' : undefined}
            className={`h-14 px-4 flex flex-col items-center justify-center text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand))] rounded-sm ${tab === 'saved' ? 'font-semibold text-[rgb(var(--brand))]' : 'opacity-70 hover:opacity-100'}`}
          >
            <span>Saved</span>
          </button>

        </div>

      </nav>,
  document.body

            {/* Auth modal */}
    {/* Auth modal (tolerant to different prop APIs used in the zip) */}
     
{/* Auth modal */}
<Modal
  isOpen={authOpen}
  onClose={() => setAuthOpen(false)}
  title={authMode === 'sign-in' ? 'Sign in' : 'Create account'}
  size="sm"
>
  <AuthModal
    mode={authMode}
    onSuccess={() => setAuthOpen(false)}
  />
</Modal>

</div>


  )
}
