// App.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';

import {
  onAuthChange,
  getCurrentUser,
  signOut,
  updateDisplayName,
  signInOrSignUpWithEmailName,
  type AuthUser,
} from './auth';
import { getDay, upsertDay, listMeals, addMeal, deleteMeal as deleteMealDb } from './data';

import type { Day, Meal, MacroSet, AppView, MacroStatusType, Profile, Goal } from './types';
import { DEFAULT_TARGETS, INITIAL_DAYS, INITIAL_MEALS, WORKOUT_CHIPS, DEFAULT_PROFILE } from './constants';
import { useMacroCalculations } from './hooks/useMacroCalculations';
import { getSwapSuggestion, estimateMacrosForMeal, getWorkoutCalories, getTargetOptions, TargetOption } from './services/geminiService';
import { exportDaysToCSV, exportMealsToCSV } from './services/csvExportService';

import MacroCounter from './components/MacroCounter';
import Modal from './components/Modal';
import ResponsiveAuthPanel from './components/ResponsiveAuthPanel';

// ---------- Shared persistent state helper ----------
const usePersistentState = <T,>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const [state, setState] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);

  return [state, setState];
};

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const App: React.FC = () => {
  // Persisted local stores
  const [profile, setProfile] = usePersistentState<Profile>('tm_profile', DEFAULT_PROFILE);
  const [days, setDays] = usePersistentState<Day[]>('tm_days', INITIAL_DAYS);
  const [meals, setMeals] = usePersistentState<Meal[]>('tm_meals', INITIAL_MEALS);
  const [targets, setTargets] = usePersistentState<MacroSet>('tm_targets', DEFAULT_TARGETS);

  // Auth & cloud sync state
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const userId = authUser?.id || null;
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('today');
  const [isMealModalOpen, setMealModalOpen] = useState(false);
  const [isWorkoutModalOpen, setWorkoutModalOpen] = useState(false);
  const [isProfileSavedModalOpen, setProfileSavedModalOpen] = useState(false);
  const [isSetWeightModalOpen, setSetWeightModalOpen] = useState(false);
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = useState(false);

  const [isWorkoutDeletedModalOpen, setWorkoutDeletedModalOpen] = useState(false);
  const [isMealDeletedModalOpen, setMealDeletedModalOpen] = useState(false);
  const [isConfirmWorkoutDeleteOpen, setConfirmWorkoutDeleteOpen] = useState(false);
  const [isConfirmMealDeleteOpen, setConfirmMealDeleteOpen] = useState(false);
  const [mealPendingDelete, setMealPendingDelete] = useState<Meal | null>(null);

  const todayDate = getTodayDateString();

  // ---------- Supabase auth bootstrap ----------
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      setAuthUser(await getCurrentUser());
      unsub = onAuthChange(async () => setAuthUser(await getCurrentUser()));
    })();
    return () => unsub();
  }, []);

  // One-time data migration for existing users
  useEffect(() => {
    const needsMigration = days.some(d => (d as any).workoutKcal === undefined);
    if (needsMigration) {
      setDays(currentDays =>
        currentDays.map(d => ({
          ...d,
          workoutKcal: (d as any).workoutKcal || 0,
        }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure today exists in local list
  useEffect(() => {
    const todayEntry = days.find(d => d.date === todayDate);
    if (!todayEntry) {
      setDays(prevDays => [
        ...prevDays,
        {
          date: todayDate,
          targets: { ...targets },
          workoutLogged: '',
          workoutKcal: 0,
          swapSuggestions: '',
        },
      ]);
    }
  }, [days, todayDate, targets, setDays]);

  // Keep targets aligned
  useEffect(() => {
    const todayEntry = days.find(d => d.date === todayDate);
    if (
      todayEntry &&
      (todayEntry.targets.calories !== targets.calories ||
        todayEntry.targets.protein !== targets.protein ||
        todayEntry.targets.carbs !== targets.carbs ||
        todayEntry.targets.fat !== targets.fat)
    ) {
      setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, targets: targets } : d)));
    }
  }, [targets, days, todayDate, setDays]);

  // Cloud: hydrate today's data
  useEffect(() => {
    (async () => {
      if (!userId) return;
      setIsLoadingCloud(true);
      try {
        const cloudDay = await getDay(userId, todayDate);
        if (!cloudDay) {
          await upsertDay(userId, todayDate, { targets });
        } else {
          setDays(prev => {
            const others = prev.filter(d => d.date !== todayDate);
            return [
              ...others,
              {
                date: todayDate,
                targets: cloudDay.targets,
                workoutLogged: (cloudDay as any).workout_logged || '',
                workoutKcal: (cloudDay as any).workout_kcal || 0,
                swapSuggestions: (cloudDay as any).swap_suggestions || '',
              },
            ];
          });
          setTargets(cloudDay.targets);
        }

        const cloudMeals = await listMeals(userId, todayDate);
        setMeals(prev => {
          const others = prev.filter(m => m.date !== todayDate);
          return [...others, ...cloudMeals];
        });
      } finally {
        setIsLoadingCloud(false);
      }
    })();
  }, [userId, todayDate, setDays, setMeals, setTargets, targets]);

  const today = useMemo(() => days.find(d => d.date === todayDate), [days, todayDate]);
  const mealsToday = useMemo(() => meals.filter(m => m.date === todayDate), [meals, todayDate]);
  const { remaining, statuses } = useMacroCalculations(today, mealsToday);

  // ---------- Handlers ----------
  const handleAddMeal = async (meal: Omit<Meal, 'id'>) => {
    if (userId) {
      setIsLoadingCloud(true);
      try {
        await addMeal(userId, meal);
        const fresh = await listMeals(userId, meal.date);
        setMeals(prev => {
          const others = prev.filter(m => m.date !== meal.date);
          return [...others, ...fresh];
        });
      } finally {
        setIsLoadingCloud(false);
      }
    } else {
      setMeals(prev => [...prev, { ...meal, id: new Date().toISOString() }]);
    }
    setMealModalOpen(false);
  };

  const handleRequestDeleteMeal = useCallback((meal: Meal) => {
    setMealPendingDelete(meal);
    setConfirmMealDeleteOpen(true);
  }, []);

  const performDeleteMeal = useCallback(async () => {
    if (!mealPendingDelete) {
      setConfirmMealDeleteOpen(false);
      return;
    }
    if (userId) {
      setIsLoadingCloud(true);
      try {
        await deleteMealDb(userId, mealPendingDelete.id as string);
        const fresh = await listMeals(userId, todayDate);
        setMeals(prev => {
          const others = prev.filter(m => m.date !== todayDate);
          return [...others, ...fresh];
        });
      } finally {
        setIsLoadingCloud(false);
      }
    } else {
      setMeals(prev => prev.filter(m => m.id !== mealPendingDelete.id));
    }
    setMealPendingDelete(null);
    setConfirmMealDeleteOpen(false);
    setMealDeletedModalOpen(true);
  }, [mealPendingDelete, userId, todayDate, setMeals]);

  const handleUpdateWorkout = async (workoutText: string, workoutKcal: number) => {
    if (userId) {
      setIsLoadingCloud(true);
      try {
        await upsertDay(userId, todayDate, { workout_logged: workoutText, workout_kcal: workoutKcal });
        setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, workoutLogged: workoutText, workoutKcal } : d)));
      } finally {
        setIsLoadingCloud(false);
      }
    } else {
      setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, workoutLogged: workoutText, workoutKcal } : d)));
    }
    setWorkoutModalOpen(false);
  };

  const performDeleteWorkout = useCallback(async () => {
    if (!today) {
      setConfirmWorkoutDeleteOpen(false);
      return;
    }
    if (userId) {
      setIsLoadingCloud(true);
      try {
        await upsertDay(userId, todayDate, { workout_logged: '', workout_kcal: 0 });
        setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, workoutLogged: '', workoutKcal: 0 } : d)));
      } finally {
        setIsLoadingCloud(false);
      }
    } else {
      setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, workoutLogged: '', workoutKcal: 0 } : d)));
    }
    setConfirmWorkoutDeleteOpen(false);
    setWorkoutDeletedModalOpen(true);
  }, [today, todayDate, userId, setDays]);

  const handleUpdateTargets = async (newTargets: MacroSet) => {
    setTargets(newTargets);
    setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, targets: newTargets } : d)));
    if (userId) {
      setIsLoadingCloud(true);
      try {
        await upsertDay(userId, todayDate, { targets: newTargets });
      } finally {
        setIsLoadingCloud(false);
      }
    }
  };

  const handleUpdateProfile = (newProfile: Profile) => {
    setProfile(newProfile);
    setProfileSavedModalOpen(true);
  };

  const handleGenerateSuggestion = async () => {
    if (!today) return;
    setIsGeneratingSuggestion(true);
    try {
      const suggestion = await getSwapSuggestion(remaining);
      setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, swapSuggestions: suggestion } : d)));
      if (userId) {
        await upsertDay(userId, todayDate, { swap_suggestions: suggestion as any });
      }
    } finally {
      setIsGeneratingSuggestion(false);
    }
  };

  // ---------- Render ----------
  const renderView = () => {
    switch (activeView) {
      case 'history':
        return <HistoryView days={days} meals={meals} />;
      case 'targets':
        return (
          <TargetsAndProfileView
            currentProfile={profile}
            onUpdateProfile={handleUpdateProfile}
            currentTargets={targets}
            onUpdateTargets={handleUpdateTargets}
            allDays={days}
            allMeals={meals}
          />
        );
      case 'today':
      default:
        return (
          <TodayView
            today={today}
            mealsToday={mealsToday}
            remaining={remaining}
            statuses={statuses}
            onAddMealClick={() => setMealModalOpen(true)}
            onWorkoutClick={() => setWorkoutModalOpen(true)}
            onGenerateSuggestion={handleGenerateSuggestion}
            isGeneratingSuggestion={isGeneratingSuggestion}
            onDeleteWorkout={() => setConfirmWorkoutDeleteOpen(true)}
            onRequestDeleteMeal={handleRequestDeleteMeal}
            onEditTargets={() => setActiveView('targets')}
            savedTargets={targets}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-primary text-white shadow-md sticky top-0 z-20">
  <div className="container mx-auto max-w-2xl p-4 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3">
    <h1 className="text-2xl font-bold">TyronesMacros</h1>
    <ResponsiveAuthPanel />
  </div>
</header>


      {/* Loading overlay */}
      {isLoadingCloud && (
        <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
            <p>Syncing…</p>
          </div>
        </div>
      )}

      <main className="flex-grow container mx-auto max-w-2xl p-4">{renderView()}</main>

      {/* Navigation */}
      <nav className="sticky bottom-0 bg-white dark:bg-gray-800 shadow-[0_-2px_5px_rgba(0,0,0,0.1)] z-20">
        <div className="container mx-auto max-w-2xl flex justify-around">
          <NavButton label="Today" icon="home" active={activeView === 'today'} onClick={() => setActiveView('today')} />
          <NavButton label="History" icon="calendar" active={activeView === 'history'} onClick={() => setActiveView('history')} />
          <NavButton label="Targets" icon="cog" active={activeView === 'targets'} onClick={() => setActiveView('targets')} />
        </div>
      </nav>

      {/* Modals */}
      {/* AddMealModal, WorkoutModal, Confirm/Delete Modals, Success Modals remain unchanged */}
    </div>
  );
};

// Keep the rest of TodayView, HistoryView, TargetsAndProfileView, Modals, etc. unchanged
// ...

export default App;
