// App.tsx
import React, { useEffect, useMemo, useState } from 'react'

import Modal from './components/Modal'
import TodayView from './components/TodayView'
import HistoryView from './components/HistoryView'
import TargetsView from './components/TargetsView'
import RateBanner from './components/RateBanner'
import ModelSelector from './components/ModelSelector'
import AuthModal from './components/AuthModal'
import WeeklyWorkoutPlan from "./components/WeeklyWorkoutPlan"
import './lib/legacyGlue'

import { getDisplayName, onAuthChange, signOut } from './auth'
import { getDailyTargets, todayDateString } from './db'
import { eventBus } from './lib/eventBus'
import ThemeToggle from './components/ThemeToggle'

type Tab = 'today' | 'history' | 'targets' | 'plan';
type MacroSet = { calories: number; protein: number; carbs: number; fat: number }

export default function App() {
  const [tab, setTab] = useState<Tab>('today')

  // Auth UI
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [displayName, setDisplayName] = useState<string | null>(null)

  // Current Goal Targets for TODAY
  const [currentGoalTargets, setCurrentGoalTargets] = useState<MacroSet>({
    calories: 0, protein: 0, carbs: 0, fat: 0
  })

  // Optional coaching modal
  const [coachingModalOpen, setCoachingModalOpen] = useState(false)
  const [coachingText, setCoachingText] = useState<string>('')

  const dateStr = todayDateString()

  useEffect(() => {
    let mounted = true

    // 1) initial auth name + subscribe to changes
    getDisplayName().then((n) => mounted && setDisplayName(n))
    const offAuth = onAuthChange(async () => {
      const n = await getDisplayName()
      if (mounted) setDisplayName(n)

      try {
        const t = await getDailyTargetsForToday()
        if (mounted && t) setCurrentGoalTargets(t)
        if (mounted && !t) {
          setCurrentGoalTargets({ calories: 0, protein: 0, carbs: 0, fat: 0 })
        }
      } catch {
        if (mounted) setCurrentGoalTargets({ calories: 0, protein: 0, carbs: 0, fat: 0 })
      }
    })

    // 2) react instantly to Targets tab saves/suggestions
    const offBus = eventBus.on<MacroSet>('targets:update', (payload) => {
      setCurrentGoalTargets({
        calories: payload.calories ?? 0,
        protein:  payload.protein  ?? 0,
        carbs:    payload.carbs    ?? 0,
        fat:      payload.fat      ?? 0,
      })
    })

    ;(async () => {
      try {
        const t = await getDailyTargetsForToday()
        if (mounted && t) setCurrentGoalTargets(t)
      } catch { /* ignore */ }
    })()

    return () => { mounted = false; offAuth(); offBus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr])

  async function getDailyTargetsForToday(): Promise<MacroSet | null> {
    try {
      const { getCurrentUserId } = await import('./auth')
      const userId = await getCurrentUserId()
      if (!userId) return null
      const t = await getDailyTargets(userId, dateStr)
      if (!t) return null
      return {
        calories: t.calories ?? 0,
        protein:  t.protein  ?? 0,
        carbs:    t.carbs    ?? 0,
        fat:      t.fat      ?? 0,
      }
    } catch {
      return null
    }
  }

  function openSignIn() { setAuthMode('sign-in'); setAuthOpen(true) }
  function openSignUp() { setAuthMode('sign-up'); setAuthOpen(true) }

  return (
    <div className="min-h-[100svh] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 pb-[calc(env(safe-area-inset-bottom)+80px)]">

      <header className="sticky top-0 z-40 border-b border-zinc-200/60 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto w-full max-w-[800px] px-4 h-14 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight mr-auto">Tyrone's Macros</h1>

          <div className="flex flex-wrap gap-2 order-1 sm:order-2 w-full sm:w-auto items-center justify-end">
            <ThemeToggle />
            <ModelSelector />
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
        </div>
      </main>

      <Modal
        isOpen={coachingModalOpen}
        onClose={() => setCoachingModalOpen(false)}
        title="AI Suggestions"
      >
        {coachingText ? `• ${coachingText}` : 'No suggestions.'}
      </Modal>

      <Modal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        title={authMode === 'sign-in' ? 'Sign in' : 'Create your account'}
      >
        <AuthModal mode={authMode} onSuccess={() => setAuthOpen(false)} />
      </Modal>

      <RateBanner />

      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-200/60 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto w-full max-w-[800px] grid grid-cols-4">
          <button onClick={() => setTab('today')} className={`h-[64px] flex flex-col items-center justify-center text-xs ${tab === 'today' ? 'font-semibold' : 'opacity-70 hover:opacity-100'}`}>
            <span>Today</span>
          </button>
          <button onClick={() => setTab('history')} className={`h-[64px] flex flex-col items-center justify-center text-xs ${tab === 'history' ? 'font-semibold' : 'opacity-70 hover:opacity-100'}`}>
            <span>History</span>
          </button>
          <button onClick={() => setTab('targets')} className={`h-[64px] flex flex-col items-center justify-center text-xs ${tab === 'targets' ? 'font-semibold' : 'opacity-70 hover:opacity-100'}`}>
            <span>Targets</span>
          </button>
          <button onClick={() => setTab('plan')} className={`h-[64px] flex flex-col items-center justify-center text-xs ${tab === 'plan' ? 'font-semibold' : 'opacity-70 hover:opacity-100'}`}>
            <span>Weekly Plan</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
