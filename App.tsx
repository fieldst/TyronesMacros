import React, { useState, useEffect, useMemo, useCallback } from 'react';

import {
  onAuthChange,
  getUserId,
  getUserProfile,
  signOut,
  signInWithPassword,
  signUpWithPassword,
  updateFullName,
} from './auth';
import { getDay, upsertDay, listMeals, addMeal, deleteMeal as deleteMealDb } from './data';

import type { Day, Meal, MacroSet, AppView, MacroStatusType, Profile, Goal } from './types';
import { DEFAULT_TARGETS, INITIAL_DAYS, INITIAL_MEALS, WORKOUT_CHIPS, DEFAULT_PROFILE } from './constants';
import { useMacroCalculations } from './hooks/useMacroCalculations';
import { getSwapSuggestion, estimateMacrosForMeal, getWorkoutCalories, getTargetOptions, TargetOption } from './services/geminiService';
import { exportDaysToCSV, exportMealsToCSV } from './services/csvExportService';

import MacroCounter from './components/MacroCounter';
import Modal from './components/Modal';

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
  // Persist targets globally so they’re remembered across sessions/days
  const [targets, setTargets] = usePersistentState<MacroSet>('tm_targets', DEFAULT_TARGETS);

  // Auth & cloud sync state
  const [userId, setUserId] = useState<string | null>(null);
  const [headerProfile, setHeaderProfile] = useState<{ email: string | null; full_name: string | null }>({ email: null, full_name: null });

  const [isLoadingCloud, setIsLoadingCloud] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('today');

  const [isMealModalOpen, setMealModalOpen] = useState(false);
  const [isWorkoutModalOpen, setWorkoutModalOpen] = useState(false);
  const [isProfileSavedModalOpen, setProfileSavedModalOpen] = useState(false);
  const [isSetWeightModalOpen, setSetWeightModalOpen] = useState(false);
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = useState(false);

  // Success/info modals
  const [isWorkoutDeletedModalOpen, setWorkoutDeletedModalOpen] = useState(false);
  const [isMealDeletedModalOpen, setMealDeletedModalOpen] = useState(false);

  // Confirm modals (avoid window.confirm so it works in sandboxes/iframes)
  const [isConfirmWorkoutDeleteOpen, setConfirmWorkoutDeleteOpen] = useState(false);
  const [isConfirmMealDeleteOpen, setConfirmMealDeleteOpen] = useState(false);
  const [mealPendingDelete, setMealPendingDelete] = useState<Meal | null>(null);

  const todayDate = getTodayDateString();

  // ---------- Supabase auth bootstrap ----------
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      setUserId(await getUserId());
      setHeaderProfile(await getUserProfile());
      unsub = onAuthChange(async (uid) => {
        setUserId(uid);
        setHeaderProfile(await getUserProfile());
      });
    })();
    return () => unsub();
  }, []);

  // One-time data migration for existing users (ensure workoutKcal exists)
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
  }, []); // run once

  // Ensure today exists in local list; if not, create it using the *persisted* targets
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

  // Keep local working targets aligned with today's targets if they drift
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

  // Cloud: when user logs in, hydrate today's day + meals from Supabase
  useEffect(() => {
    (async () => {
      if (!userId) return;
      setIsLoadingCloud(true);
      try {
        // Load or bootstrap day
        const cloudDay = await getDay(userId, todayDate);
        if (!cloudDay) {
          // create cloud row with our current targets
          await upsertDay(userId, todayDate, { targets });
          // ensure local has an entry (already ensured above)
        } else {
          // hydrate local for today
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
          setTargets(cloudDay.targets); // keep saved targets in sync with cloud
        }

        // Load meals
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

  // ---------- Meals: add / delete ----------
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
      // local fallback
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
      // local fallback
      setMeals(prev => prev.filter(m => m.id !== mealPendingDelete.id));
    }
    setMealPendingDelete(null);
    setConfirmMealDeleteOpen(false);
    setMealDeletedModalOpen(true);
  }, [mealPendingDelete, userId, todayDate, setMeals]);

  // ---------- Workout: update / delete ----------
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
      // local fallback
      setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, workoutLogged: workoutText, workoutKcal } : d)));
    }
    setWorkoutModalOpen(false);
  };

  const handleDeleteWorkout = useCallback(() => {
    setConfirmWorkoutDeleteOpen(true);
  }, []);

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
      // local fallback
      setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, workoutLogged: '', workoutKcal: 0 } : d)));
    }
    setConfirmWorkoutDeleteOpen(false);
    setWorkoutDeletedModalOpen(true);
  }, [today, todayDate, userId, setDays]);

  // ---------- Targets / Profile / Suggestions ----------
  const handleUpdateTargets = async (newTargets: MacroSet) => {
    setTargets(newTargets); // persists locally
    setDays(prev => prev.map(d => (d.date === todayDate ? { ...d, targets: newTargets } : d))); // keep today aligned
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
            onDeleteWorkout={handleDeleteWorkout}
            onRequestDeleteMeal={handleRequestDeleteMeal}
            onEditTargets={() => setActiveView('targets')}
            savedTargets={targets}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 flex flex-col font-sans">
      {/* Header with auth UI (name/email + edit + sign out, or sign in) */}
      <header className="bg-primary text-white shadow-md sticky top-0 z-20">
        <div className="container mx-auto max-w-2xl p-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">TyronesMacros</h1>
          <AuthPanelMinimal
            headerProfile={headerProfile}
            onProfileReload={async () => setHeaderProfile(await getUserProfile())}
          />
        </div>
      </header>

      {/* optional cloud loading overlay */}
      {isLoadingCloud && (
        <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
            <p>Syncing…</p>
          </div>
        </div>
      )}

      <main className="flex-grow container mx-auto max-w-2xl p-4">{renderView()}</main>

      <nav className="sticky bottom-0 bg-white dark:bg-gray-800 shadow-[0_-2px_5px_rgba(0,0,0,0.1)] z-20">
        <div className="container mx-auto max-w-2xl flex justify-around">
          <NavButton label="Today" icon="home" active={activeView === 'today'} onClick={() => setActiveView('today')} />
          <NavButton label="History" icon="calendar" active={activeView === 'history'} onClick={() => setActiveView('history')} />
          <NavButton label="Targets" icon="cog" active={activeView === 'targets'} onClick={() => setActiveView('targets')} />
        </div>
      </nav>

      {/* Modals used across views */}
      <AddMealModal isOpen={isMealModalOpen} onClose={() => setMealModalOpen(false)} onSubmit={handleAddMeal} date={todayDate} />
      <WorkoutModal
        isOpen={isWorkoutModalOpen}
        onClose={() => setWorkoutModalOpen(false)}
        onSubmit={handleUpdateWorkout}
        currentWorkout={today?.workoutLogged || ''}
        currentKcal={today?.workoutKcal || 0}
        profile={profile}
        onMissingProfile={() => setSetWeightModalOpen(true)}
      />

      {/* Confirm Workout Delete */}
      <Modal isOpen={isConfirmWorkoutDeleteOpen} onClose={() => setConfirmWorkoutDeleteOpen(false)} title="Delete today's workout?">
        <div className="text-center space-y-4">
          <p className="text-lg">This will remove today’s workout and reset its calories.</p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => setConfirmWorkoutDeleteOpen(false)}
              className="bg-gray-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-600 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={performDeleteWorkout}
              className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700 transition"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Meal Delete */}
      <Modal
        isOpen={isConfirmMealDeleteOpen}
        onClose={() => {
          setConfirmMealDeleteOpen(false);
          setMealPendingDelete(null);
        }}
        title="Delete this meal?"
      >
        <div className="text-center space-y-4">
          <p className="text-lg">
            {mealPendingDelete
              ? `Remove "${mealPendingDelete.mealType}: ${mealPendingDelete.mealSummary}" from today?`
              : 'Remove this meal from today?'}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => {
                setConfirmMealDeleteOpen(false);
                setMealPendingDelete(null);
              }}
              className="bg-gray-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-600 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={performDeleteMeal}
              className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700 transition"
            >
              Delete Meal
            </button>
          </div>
        </div>
      </Modal>

      {/* Success / Info Modals */}
      <Modal isOpen={isProfileSavedModalOpen} onClose={() => setProfileSavedModalOpen(false)} title="Success">
        <div className="text-center">
          <p className="text-lg">Your profile has been saved successfully.</p>
          <button
            onClick={() => setProfileSavedModalOpen(false)}
            className="mt-4 bg-primary text-white font-bold py-2 px-6 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300"
          >
            OK
          </button>
        </div>
      </Modal>

      <Modal isOpen={isSetWeightModalOpen} onClose={() => setSetWeightModalOpen(false)} title="Profile Incomplete">
        <div className="text-center">
          <p className="text-lg">Please set your weight in the Profile section on the Targets tab first.</p>
          <button
            onClick={() => {
              setSetWeightModalOpen(false);
              setActiveView('targets');
            }}
            className="mt-4 bg-primary text-white font-bold py-2 px-6 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300"
          >
            Go to Profile
          </button>
        </div>
      </Modal>

      <Modal isOpen={isWorkoutDeletedModalOpen} onClose={() => setWorkoutDeletedModalOpen(false)} title="Success">
        <div className="text-center">
          <p className="text-lg">Workout deleted successfully.</p>
          <button
            onClick={() => setWorkoutDeletedModalOpen(false)}
            className="mt-4 bg-primary text-white font-bold py-2 px-6 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300"
          >
            OK
          </button>
        </div>
      </Modal>

      <Modal isOpen={isMealDeletedModalOpen} onClose={() => setMealDeletedModalOpen(false)} title="Success">
        <div className="text-center">
          <p className="text-lg">Meal deleted successfully.</p>
          <button
            onClick={() => setMealDeletedModalOpen(false)}
            className="mt-4 bg-primary text-white font-bold py-2 px-6 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300"
          >
            OK
          </button>
        </div>
      </Modal>
    </div>
  );
};

const StatusIcon: React.FC<{ status: MacroStatusType }> = ({ status }) => {
  if (status === 'on-target') return <span title="On Target">✅</span>;
  if (status === 'over') return <span title="Over">⬆️</span>;
  return <span title="Under">⬇️</span>;
};

// ---------- Today view (shows Today’s Target + quick Edit) ----------
const TodayView: React.FC<{
  today: Day | undefined;
  mealsToday: Meal[];
  remaining: MacroSet;
  statuses: { calories: MacroStatusType; protein: MacroStatusType; carbs: MacroStatusType; fat: MacroStatusType };
  onAddMealClick: () => void;
  onWorkoutClick: () => void;
  onGenerateSuggestion: () => void;
  isGeneratingSuggestion: boolean;
  onDeleteWorkout: () => void;
  onRequestDeleteMeal: (meal: Meal) => void;
  onEditTargets: () => void;
  savedTargets: MacroSet;
}> = ({
  today,
  mealsToday,
  remaining,
  statuses,
  onAddMealClick,
  onWorkoutClick,
  onGenerateSuggestion,
  isGeneratingSuggestion,
  onDeleteWorkout,
  onRequestDeleteMeal,
  onEditTargets,
  savedTargets,
}) => {
  return (
    <div className="space-y-6">
      {/* Top counters */}
      <div className="grid grid-cols-2 gap-4">
        <MacroCounter label="Calories" remaining={remaining.calories} unit="kcal" status={statuses.calories} />
        <MacroCounter label="Protein" remaining={remaining.protein} unit="g" status={statuses.protein} />
        <MacroCounter label="Carbs" remaining={remaining.carbs} unit="g" status={statuses.carbs} />
        <MacroCounter label="Fat" remaining={remaining.fat} unit="g" status={statuses.fat} />
      </div>

      {/* Today’s Target card */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold text-lg text-primary dark:text-purple-400">Today’s Target</h3>
          <button type="button" onClick={onEditTargets} className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
            Edit Targets
          </button>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          C: <strong>{savedTargets.calories}</strong> kcal &nbsp;|&nbsp; P: <strong>{savedTargets.protein}</strong> g &nbsp;|&nbsp; C:{' '}
          <strong>{savedTargets.carbs}</strong> g &nbsp;|&nbsp; F: <strong>{savedTargets.fat}</strong> g
        </p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={onAddMealClick}
          className="w-full bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300"
        >
          Add Meal
        </button>
        <button
          onClick={onWorkoutClick}
          className="w-full bg-gray-600 text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-gray-700 transition duration-300"
        >
          Add/Edit Workout
        </button>
        <button
          onClick={onGenerateSuggestion}
          disabled={isGeneratingSuggestion}
          className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-blue-700 transition duration-300 disabled:bg-blue-400"
        >
          {isGeneratingSuggestion ? 'Thinking...' : 'Swap Suggestion'}
        </button>
      </div>

      {/* Workout block */}
      {today && today.workoutLogged?.trim() !== '' && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-lg text-primary dark:text-purple-400">Today's Workout</h3>
            <button
              type="button"
              onClick={onDeleteWorkout}
              className="bg-red-600 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-red-700 transition duration-300 text-sm"
              aria-label="Delete today's workout"
            >
              Delete Workout
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{today.workoutLogged}</p>
          <p className="text-right text-lg font-semibold text-gray-700 dark:text-gray-200 mt-2">{Math.round(today.workoutKcal)} kcal</p>
        </div>
      )}

      {/* Meals list with delete buttons */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
        <h3 className="font-bold text-lg mb-2 text-primary dark:text-purple-400">Today's Meals</h3>
        {mealsToday.length > 0 ? (
          <ul className="space-y-3">
            {mealsToday.map((meal) => (
              <li key={meal.id} className="border-b border-gray-200 dark:border-gray-700 pb-2">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <p className="font-semibold">
                      {meal.mealType}: <span className="font-normal">{meal.mealSummary}</span>
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      C: {meal.macros.calories} | P: {meal.macros.protein}g | C: {meal.macros.carbs}g | F: {meal.macros.fat}g
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRequestDeleteMeal(meal)}
                    className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                    aria-label={`Delete ${meal.mealType}`}
                    title="Delete meal"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>No meals logged yet.</p>
        )}
      </div>

      {/* Swap suggestions */}
      {today?.swapSuggestions && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <h3 className="font-bold text-lg mb-2 text-primary dark:text-purple-400">Swap Suggestion</h3>
          <p className="text-gray-600 dark:text-gray-300">{today.swapSuggestions}</p>
        </div>
      )}
    </div>
  );
};

const HistoryView: React.FC<{ days: Day[]; meals: Meal[] }> = ({ days, meals }) => {
  const sortedDays = [...days].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-center mb-4">Daily History</h2>
      {sortedDays.map((day) => (
        <HistoryItem key={day.date} day={day} meals={meals.filter((m) => m.date === day.date)} />
      ))}
    </div>
  );
};

const HistoryItem: React.FC<{ day: Day; meals: Meal[] }> = ({ day, meals }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { statuses } = useMacroCalculations(day, meals);
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
      <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
        <div>
          <p className="font-bold text-lg">
            {new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <div className="flex gap-2 text-xs">
            <span>
              C: <StatusIcon status={statuses.calories} />
            </span>
            <span>
              P: <StatusIcon status={statuses.protein} />
            </span>
            <span>
              C: <StatusIcon status={statuses.carbs} />
            </span>
            <span>
              F: <StatusIcon status={statuses.fat} />
            </span>
          </div>
        </div>
        <svg
          className={`w-6 h-6 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </div>
      {isOpen && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
          <div>
            <h4 className="font-semibold">Meals Logged</h4>
            {meals.length > 0 ? (
              meals.map((m) => (
                <p key={m.id} className="text-sm">
                  {m.mealType}: {m.mealSummary}
                </p>
              ))
            ) : (
              <p className="text-sm">No meals.</p>
            )}
          </div>
          <div>
            <h4 className="font-semibold">Workout</h4>
            <p className="text-sm whitespace-pre-wrap">
              {day.workoutLogged || 'No workout logged.'} ({Math.round(day.workoutKcal || 0)} kcal)
            </p>
          </div>
          <div>
            <h4 className="font-semibold">Swap Suggestions</h4>
            <p className="text-sm">{day.swapSuggestions || 'No suggestions.'}</p>
          </div>
        </div>
      )}
    </div>
  );
};

const TargetsAndProfileView: React.FC<{
  currentProfile: Profile;
  onUpdateProfile: (profile: Profile) => void;
  currentTargets: MacroSet;
  onUpdateTargets: (targets: MacroSet) => void;
  allDays: Day[];
  allMeals: Meal[];
}> = ({ currentProfile, onUpdateProfile, currentTargets, onUpdateTargets, allDays, allMeals }) => {
  const [profileState, setProfileState] = useState(currentProfile);
  const [targetsState, setTargetsState] = useState(currentTargets);
  const [goal, setGoal] = useState<Goal>('maintain');
  const [targetOptions, setTargetOptions] = useState<{ options: TargetOption[]; notes: string } | null>(null);
  const [isGeneratingOptions, setIsGeneratingOptions] = useState(false);

  useEffect(() => setTargetsState(currentTargets), [currentTargets]);
  useEffect(() => setProfileState(currentProfile), [currentProfile]);

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setProfileState({
      ...profileState,
      [e.target.name]: e.target.type === 'number' ? parseFloat(e.target.value) || null : e.target.value,
    });
  };

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile(profileState);
  };

  const handleTargetsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTargetsState({ ...targetsState, [e.target.name]: parseInt(e.target.value, 10) || 0 });
  };

  const handleTargetsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateTargets(targetsState);
    alert('Targets updated!');
  };

  const handleGenerateTargetOptions = async () => {
    if (!profileState.weight_lbs) {
      alert('Please enter your weight in the Profile section first.');
      return;
    }
    setIsGeneratingOptions(true);
    setTargetOptions(null);
    try {
      const result = await getTargetOptions(profileState, goal);
      setTargetOptions(result);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsGeneratingOptions(false);
    }
  };

  const applyTargetOption = (option: MacroSet) => {
    onUpdateTargets(option);
    setTargetOptions(null);
    alert('Targets applied!');
  };

  return (
    <div className="space-y-6">
      {isGeneratingOptions && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4" aria-modal="true" role="dialog">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl flex flex-col items-center gap-4 text-center">
            <svg className="animate-spin h-10 w-10 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">Working on it...</p>
          </div>
        </div>
      )}

      <h2 className="text-2xl font-bold text-center mb-4">Profile & Targets</h2>

      {/* Profile */}
      <form onSubmit={handleProfileSubmit} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
        <h3 className="text-xl font-bold text-center">Your Profile</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Weight (lbs)</label>
            <input
              type="number"
              name="weight_lbs"
              value={profileState.weight_lbs || ''}
              onChange={handleProfileChange}
              placeholder="Required"
              required
              className="mt-1 block w-full input-style"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Height (in)</label>
            <input
              type="number"
              name="height_in"
              value={profileState.height_in || ''}
              onChange={handleProfileChange}
              className="mt-1 block w-full input-style"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Age</label>
            <input type="number" name="age" value={profileState.age || ''} onChange={handleProfileChange} className="mt-1 block w-full input-style" />
          </div>
          <div>
            <label className="block text-sm font-medium">Sex</label>
            <select name="sex" value={profileState.sex} onChange={handleProfileChange} className="mt-1 block w-full input-style">
              <option value="">—</option>
              <option>Male</option>
              <option>Female</option>
            </select>
          </div>
        </div>
        <button type="submit" className="w-full bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300">
          Save Profile
        </button>
      </form>

      {/* Targets */}
      <form onSubmit={handleTargetsSubmit} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
        <h3 className="text-xl font-bold text-center">Set Daily Targets</h3>
        <div className="flex gap-2 items-end">
          <div className="flex-grow">
            <label className="block text-sm font-medium">Goal</label>
            <select value={goal} onChange={(e) => setGoal(e.target.value as Goal)} className="mt-1 block w-full input-style">
              <option value="maintain">Maintain</option>
              <option value="cut_0_5">Cut (~0.5 lb/week)</option>
              <option value="recomp">Recomp</option>
              <option value="gain_0_25">Gain (~0.25 lb/week)</option>
            </select>
          </div>
          <button
            type="button"
            onClick={handleGenerateTargetOptions}
            disabled={isGeneratingOptions}
            className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-blue-700 transition duration-300 disabled:bg-blue-400"
          >
            AI Options
          </button>
        </div>
        {targetOptions && (
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-3">
            <p className="text-sm text-center">"{targetOptions.notes}"</p>
            {targetOptions.options.map((opt) => (
              <div key={opt.label} className="text-center p-2 border rounded-md border-gray-300 dark:border-gray-600">
                <p className="font-bold">{opt.label}</p>
                <p className="text-sm">
                  C:{opt.calories} P:{opt.protein} C:{opt.carbs} F:{opt.fat}
                </p>
                <button type="button" onClick={() => applyTargetOption(opt)} className="text-xs bg-green-600 text-white px-2 py-1 rounded mt-1">
                  Use This
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <TargetInput label="Calories (kcal)" name="calories" value={targetsState.calories} onChange={handleTargetsChange} />
          <TargetInput label="Protein (g)" name="protein" value={targetsState.protein} onChange={handleTargetsChange} />
          <TargetInput label="Carbs (g)" name="carbs" value={targetsState.carbs} onChange={handleTargetsChange} />
          <TargetInput label="Fat (g)" name="fat" value={targetsState.fat} onChange={handleTargetsChange} />
        </div>
        <button type="submit" className="w-full bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300">
          Save Manual Targets
        </button>
      </form>

      {/* Export */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
        <h3 className="text-xl font-bold text-center">Export Data</h3>
        <div className="flex gap-4">
          <button
            onClick={() => exportDaysToCSV(allDays)}
            className="flex-1 bg-green-600 text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-green-700 transition duration-300"
          >
            Export Days (CSV)
          </button>
          <button
            onClick={() => exportMealsToCSV(allMeals)}
            className="flex-1 bg-green-600 text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-green-700 transition duration-300"
          >
            Export Meals (CSV)
          </button>
        </div>
      </div>
    </div>
  );
};

const TargetInput: React.FC<{
  label: string;
  name: keyof MacroSet;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ label, name, value, onChange }) => (
  <div>
    <label htmlFor={name} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {label}
    </label>
    <input type="number" name={name} id={name} value={value} onChange={onChange} className="mt-1 block w-full input-style" />
  </div>
);

// ---------- Add Meal Modal ----------
const AddMealModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (meal: Omit<Meal, 'id'>) => void;
  date: string;
}> = ({ isOpen, onClose, onSubmit, date }) => {
  const [mealType, setMealType] = useState<'Breakfast' | 'Lunch' | 'Dinner' | 'Snack'>('Snack');
  const [mealSummary, setMealSummary] = useState('');
  const [macros, setMacros] = useState<MacroSet>({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimationNote, setEstimationNote] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setMealType('Snack');
    setMealSummary('');
    setMacros({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    setEstimationNote(null);
    setIsEstimating(false);
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ date, mealType, mealSummary, macros });
    resetForm();
  };
  const handleMacroChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setMacros({ ...macros, [e.target.name]: parseInt(e.target.value) || 0 });

  const handleEstimateMacros = async () => {
    if (!mealSummary) {
      alert('Please enter a meal description first.');
      return;
    }
    setIsEstimating(true);
    setEstimationNote(null);
    try {
      const result = await estimateMacrosForMeal(mealSummary);
      setMacros(result.macros);
      setEstimationNote(result.note);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsEstimating(false);
    }
  };

  if (!isOpen) return null;
  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Meal">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Meal Type</label>
          <select value={mealType} onChange={(e) => setMealType(e.target.value as any)} className="mt-1 block w-full input-style">
            <option>Breakfast</option> <option>Lunch</option> <option>Dinner</option> <option>Snack</option>
          </select>
        </div>
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="block text-sm font-medium">Meal Summary</label>
            <button
              type="button"
              onClick={handleEstimateMacros}
              disabled={isEstimating}
              className="text-sm bg-blue-600 text-white font-semibold py-1 px-3 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 disabled:bg-blue-400 disabled:cursor-not-allowed"
            >
              {isEstimating ? 'Estimating...' : 'Estimate with AI'}
            </button>
          </div>
          <input
            type="text"
            value={mealSummary}
            onChange={(e) => setMealSummary(e.target.value)}
            placeholder="e.g., 250g salmon, 1 cup risotto"
            required
            className="block w-full input-style"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TargetInput label="Calories" name="calories" value={macros.calories} onChange={handleMacroChange} />
          <TargetInput label="Protein (g)" name="protein" value={macros.protein} onChange={handleMacroChange} />
          <TargetInput label="Carbs (g)" name="carbs" value={macros.carbs} onChange={handleMacroChange} />
          <TargetInput label="Fat (g)" name="fat" value={macros.fat} onChange={handleMacroChange} />
        </div>
        {estimationNote && (
          <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-md text-sm text-center text-gray-600 dark:text-gray-300">
            <p>
              <strong>AI Note:</strong> {estimationNote}
            </p>
          </div>
        )}
        <button type="submit" className="w-full bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300">
          Log Meal
        </button>
      </form>
    </Modal>
  );
};

// ---------- Workout Modal ----------
const WorkoutModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (workoutText: string, workoutKcal: number) => void;
  currentWorkout: string;
  currentKcal: number;
  profile: Profile;
  onMissingProfile: () => void;
}> = ({ isOpen, onClose, onSubmit, currentWorkout, currentKcal, profile, onMissingProfile }) => {
  const [workout, setWorkout] = useState(currentWorkout);
  const [kcal, setKcal] = useState(currentKcal);
  const [isEstimating, setIsEstimating] = useState(false);

  useEffect(() => {
    setWorkout(currentWorkout);
    setKcal(currentKcal);
  }, [currentWorkout, currentKcal, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(workout, kcal);
  };
  const addChip = (chipText: string) => setWorkout((prev) => (prev ? `${prev}; ${chipText}` : chipText));

  const handleAiEstimate = async () => {
    if (!profile.weight_lbs) {
      onMissingProfile();
      return;
    }
    if (!workout) {
      alert('Please enter a workout description first.');
      return;
    }
    setIsEstimating(true);
    try {
      const result = await getWorkoutCalories(workout, profile);
      setKcal(Math.round(result.total_calories));
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsEstimating(false);
    }
  };

  if (!isOpen) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add/Edit Workout">
      {isEstimating && (
        <div className="absolute inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4" aria-modal="true" role="dialog">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl flex flex-col items-center gap-4 text-center">
            <svg className="animate-spin h-10 w-10 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">Working on it...</p>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Workout Log</label>
          <textarea value={workout} onChange={(e) => setWorkout(e.target.value)} rows={6} className="mt-1 block w-full input-style"></textarea>
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={handleAiEstimate}
            disabled={isEstimating}
            className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-blue-700 transition disabled:bg-blue-400"
          >
            AI Workout Calories
          </button>
          <div className="block w-full input-style bg-gray-100 dark:bg-gray-600 flex items-center justify-center h-10">
            <span className="text-gray-700 dark:text-gray-200 font-semibold">{kcal > 0 ? Math.round(kcal) : '-'}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">kcal</span>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-medium">Quick Add:</h4>
          <div className="flex flex-wrap gap-2 mt-2">
            {WORKOUT_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => addChip(chip)}
                className="bg-gray-200 dark:bg-gray-600 text-sm px-3 py-1 rounded-full hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="w-full bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-purple-700 transition duration-300">
          Save Workout
        </button>
      </form>
    </Modal>
  );
};

// ---------- Auth panel (password-based, inline) ----------
const AuthPanelMinimal: React.FC<{
  headerProfile: { email: string | null; full_name: string | null };
  onProfileReload: () => Promise<void>;
}> = ({ headerProfile, onProfileReload }) => {
  const [uid, setUid] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      setUid(await getUserId());
      unsub = onAuthChange(async (userId) => {
        setUid(userId);
        await onProfileReload();
      });
    })();
    return () => unsub();
  }, [onProfileReload]);

  const doSignIn = async () => {
    setPending(true);
    try {
      await signInWithPassword(email.trim(), password);
      setEmail(''); setPassword('');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPending(false);
    }
  };

  const doSignUp = async () => {
    if (!fullName.trim()) return alert('Please enter your full name.');
    if (!password) return alert('Please choose a password.');
    setPending(true);
    try {
      await signUpWithPassword(email.trim(), password, fullName.trim());
      setEmail(''); setPassword(''); setFullName('');
      setMode('signin');
      alert('Account created. Please sign in.');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPending(false);
    }
  };

  const doUpdateName = async () => {
    if (!fullName.trim()) return;
    setPending(true);
    try {
      await updateFullName(fullName.trim());
      await onProfileReload();
      setEditingName(false);
      alert('Name updated.');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPending(false);
    }
  };

  if (uid) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-sm text-white/90">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name"
                className="px-2 py-1 rounded text-black"
              />
              <button onClick={doUpdateName} disabled={pending} className="bg-white/20 px-2 py-1 rounded">
                Save
              </button>
              <button
                onClick={() => {
                  setEditingName(false);
                  setFullName(headerProfile.full_name || '');
                }}
                className="bg-white/10 px-2 py-1 rounded"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="font-semibold">{headerProfile.full_name || 'Unnamed User'}</div>
              <div className="text-xs opacity-90">{headerProfile.email}</div>
              <button
                onClick={() => {
                  setFullName(headerProfile.full_name || '');
                  setEditingName(true);
                }}
                className="ml-2 bg-white/20 px-2 py-1 rounded"
              >
                Edit name
              </button>
            </>
          )}
        </div>
        <button onClick={signOut} className="bg-white/20 px-3 py-1 rounded">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {mode === 'signin' ? (
        <>
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="px-2 py-1 rounded text-black"
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="px-2 py-1 rounded text-black"
          />
          <button onClick={doSignIn} disabled={pending} className="bg-white/20 px-3 py-1 rounded">
            Sign in
          </button>
          <button onClick={() => setMode('signup')} className="underline text-white/90 text-sm ml-1">
            Create account
          </button>
        </>
      ) : (
        <>
          <input
            type="text"
            placeholder="full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="px-2 py-1 rounded text-black"
          />
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="px-2 py-1 rounded text-black"
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="px-2 py-1 rounded text-black"
          />
          <button onClick={doSignUp} disabled={pending} className="bg-white/20 px-3 py-1 rounded">
            Sign up
          </button>
          <button onClick={() => setMode('signin')} className="underline text-white/90 text-sm ml-1">
            I have an account
          </button>
        </>
      )}
    </div>
  );
};

// ---------- Icons / Nav ----------
const ICONS = {
  home: (
    <svg xmlns="http://www.w3.org/2000/svg" className="hero" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  calendar: (
    <svg xmlns="http://www.w3.org/2000/svg" className="hero" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  cog: (
    <svg xmlns="http://www.w3.org/2000/svg" className="hero" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

const NavButton: React.FC<{ label: string; icon: keyof typeof ICONS; active: boolean; onClick: () => void }> = ({
  label,
  icon,
  active,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={`flex-1 flex flex-col items-center justify-center py-2 px-1 text-center text-sm transition-colors duration-200 ${
      active ? 'text-primary' : 'text-gray-500 dark:text-gray-400 hover:text-primary'
    }`}
  >
    {ICONS[icon]}
    <span className="mt-1">{label}</span>
  </button>
);

export default App;
