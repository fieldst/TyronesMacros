// pages/TodayView.tsx
import React, { useEffect, useState, useRef } from 'react';
import { Plus, CreditCard as Edit3, Trash2, Save, Calendar, RefreshCw } from 'lucide-react';
import Greeting from '../components/Greeting';
import MacroCard from '../components/MacroCard';
import FoodNLInput from '../components/FoodNLInput';
import WorkoutFormModal from '../components/WorkoutFormModal';
import PlanWeekModal from '../components/PlanWeekModal';
import { getCurrentUserId } from '../auth';
import { getCurrentChicagoDateKey } from '../lib/dateLocal';
import { ensureTodayDay, getTodaySnapshot, getFoodForDate, getWorkoutsForDate } from '../services/dayService';
import { upsertFoodEntry, deleteFoodEntry, upsertWorkoutEntry, deleteWorkoutEntry, saveMeal } from '../services/loggingService';
import { swapMeal } from '../services/aiFoodService';
import { supabase } from '../supabaseClient';
import { eventBus } from '../lib/eventBus';

type MacroSet = { calories: number; protein: number; carbs: number; fat: number };

type FoodEntry = {
  id: string;
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source?: string;
};

type WorkoutEntry = {
  id: string;
  activity: string;
  minutes?: number;
  calories_burned: number;
  intensity?: string;
  source?: string;
};

type FoodItem = {
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type DayTotals = {
  food_cals: number;
  workout_cals: number;
  allowance: number;
  remaining: number;
  protein: number;
  carbs: number;
  fat: number;
};

export default function TodayView() {
  const bootstrapped = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Targets and totals
  const [targets, setTargets] = useState<MacroSet>({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [totals, setTotals] = useState<DayTotals>({
    food_cals: 0,
    workout_cals: 0,
    allowance: 0,
    remaining: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  });

  // Food entries
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [editingFood, setEditingFood] = useState<FoodEntry | null>(null);
  const [savedMeals, setSavedMeals] = useState<any[]>([]);

  // Workout entries
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [workoutModalOpen, setWorkoutModalOpen] = useState(false);

  // Plan week modal
  const [planWeekOpen, setPlanWeekOpen] = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  const dateStr = getCurrentChicagoDateKey();

  // Bootstrap with snapshot, then hydrate from server
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    let mounted = true;

    async function bootstrap() {
      try {
        // 1. Load snapshot immediately for instant UI
        const snapshot = getTodaySnapshot();
        if (snapshot && mounted) {
          if (snapshot.targets) {
            setTargets({
              calories: Number(snapshot.targets.calories) || 0,
              protein: Number(snapshot.targets.protein) || 0,
              carbs: Number(snapshot.targets.carbs) || 0,
              fat: Number(snapshot.targets.fat) || 0,
            });
          }
          if (snapshot.totals) {
            setTotals({
              food_cals: Number(snapshot.totals.food_cals) || 0,
              workout_cals: Number(snapshot.totals.workout_cals) || 0,
              allowance: Number(snapshot.totals.allowance) || 0,
              remaining: Number(snapshot.totals.remaining) || 0,
              protein: Number(snapshot.totals.protein) || 0,
              carbs: Number(snapshot.totals.carbs) || 0,
              fat: Number(snapshot.totals.fat) || 0,
            });
          }
        }

        // 2. Get user and hydrate from server
        const id = await getCurrentUserId();
        if (!mounted || !id) {
          setLoading(false);
          return;
        }
        setUserId(id);

        // 3. Ensure today's day exists and get fresh data
        const day = await ensureTodayDay(id);
        if (!mounted) return;

        // Update targets from server
        if (day.targets) {
          setTargets({
            calories: Number(day.targets.calories) || 0,
            protein: Number(day.targets.protein) || 0,
            carbs: Number(day.targets.carbs) || 0,
            fat: Number(day.targets.fat) || 0,
          });
        }

        // Update totals from server
        if (day.totals) {
          setTotals({
            food_cals: Number(day.totals.food_cals) || 0,
            workout_cals: Number(day.totals.workout_cals) || 0,
            allowance: Number(day.totals.allowance) || 0,
            remaining: Number(day.totals.remaining) || 0,
            protein: Number(day.totals.protein) || 0,
            carbs: Number(day.totals.carbs) || 0,
            fat: Number(day.totals.fat) || 0,
          });
        }

        // 4. Load food and workout entries
        await Promise.all([
          loadFoodEntries(id),
          loadWorkoutEntries(id),
          loadSavedMeals(id)
        ]);

        setLoading(false);
      } catch (e) {
        console.error('Bootstrap error:', e);
        setLoading(false);
      }
    }

    bootstrap();

    // Event listeners for real-time updates
    const offTotals = eventBus.on<{ userId: string; date: string; totals: DayTotals }>('day:totals', ({ totals: newTotals }) => {
      if (mounted) {
        setTotals(newTotals);
      }
    });

    const offFood = eventBus.on('food:upsert', () => {
      if (mounted && userId) {
        loadFoodEntries(userId);
      }
    });

    const offFoodDelete = eventBus.on('food:delete', () => {
      if (mounted && userId) {
        loadFoodEntries(userId);
      }
    });

    const offWorkout = eventBus.on('workout:upsert', () => {
      if (mounted && userId) {
        loadWorkoutEntries(userId);
      }
    });

    const offWorkoutDelete = eventBus.on('workout:delete', () => {
      if (mounted && userId) {
        loadWorkoutEntries(userId);
      }
    });

    return () => {
      mounted = false;
      offTotals();
      offFood();
      offFoodDelete();
      offWorkout();
      offWorkoutDelete();
    };
  }, [dateStr]);

  async function loadFoodEntries(uid: string) {
    try {
      const data = await getFoodForDate(uid, dateStr);
      setFoods(data.map((item: any) => ({
        id: item.id,
        description: item.description,
        calories: Number(item.calories) || 0,
        protein: Number(item.protein) || 0,
        carbs: Number(item.carbs) || 0,
        fat: Number(item.fat) || 0,
        source: item.source
      })));
    } catch (error) {
      console.error('Error loading food entries:', error);
    }
  }

  async function loadWorkoutEntries(uid: string) {
    try {
      const data = await getWorkoutsForDate(uid, dateStr);
      setWorkouts(data.map((item: any) => ({
        id: item.id,
        activity: item.activity,
        minutes: item.minutes,
        calories_burned: Number(item.calories_burned) || 0,
        intensity: item.intensity,
        source: item.source
      })));
    } catch (error) {
      console.error('Error loading workout entries:', error);
    }
  }

  async function loadSavedMeals(uid: string) {
    try {
      const { data, error } = await supabase
        .from('saved_meals')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSavedMeals(data || []);
    } catch (error) {
      console.error('Error loading saved meals:', error);
    }
  }

  async function handleAddFoodItems(items: FoodItem[], totals: { calories: number; protein: number; carbs: number; fat: number }) {
    if (!userId) return;

    try {
      // Add each item as a separate food entry
      for (const item of items) {
        await upsertFoodEntry(userId, {
          description: `${item.name} (${item.quantity})`,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          source: 'nl_input'
        });
      }
      showToast(`Added ${items.length} food item${items.length > 1 ? 's' : ''} successfully!`);
    } catch (error: any) {
      throw new Error(error.message || 'Failed to add food');
    }
  }

  async function handleAddWorkout(workoutData: {
    activity: string;
    minutes?: number;
    intensity?: string;
    calories_burned: number;
  }) {
    if (!userId) return;
    
    try {
      await upsertWorkoutEntry(userId, {
        activity: workoutData.activity,
        minutes: workoutData.minutes,
        calories_burned: workoutData.calories_burned,
        intensity: workoutData.intensity,
        source: 'manual'
      });
      showToast('Workout added successfully!');
    } catch (e: any) {
      throw new Error(e?.message || 'Failed to add workout');
    }
  }

  async function handleAddPlanWorkout(day: any) {
    if (!userId) return;

    try {
      await upsertWorkoutEntry(userId, {
        activity: `${day.title} (${day.day})`,
        calories_burned: day.estimated_calories,
        intensity: 'moderate',
        source: 'plan_week'
      });
      showToast(`Added ${day.day} workout to your log!`);
    } catch (e: any) {
      throw new Error(e?.message || 'Failed to add workout from plan');
    }
  }

  async function handleEditFood(food: FoodEntry) {
    if (!userId) return;

    try {
      await upsertFoodEntry(userId, food);
      setEditingFood(null);
      showToast('Food updated successfully!');
    } catch (e: any) {
      showToast(e?.message || 'Failed to update food');
    }
  }

  async function handleDeleteFood(id: string) {
    if (!userId) return;
    try {
      await deleteFoodEntry(userId, id);
      showToast('Food deleted');
    } catch (e: any) {
      showToast(e?.message || 'Failed to delete food');
    }
  }

  async function handleSaveAsMeal(food: FoodEntry) {
    if (!userId) return;

    const name = prompt('Enter a name for this meal:', food.description);
    if (!name) return;

    try {
      await saveMeal(userId, {
        name: name.trim(),
        description: food.description,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat
      });
      showToast('Meal saved!');
      loadSavedMeals(userId); // Refresh saved meals
    } catch (e: any) {
      showToast(e?.message || 'Failed to save meal');
    }
  }

  async function handleMealSwap(food: FoodEntry) {
    if (!userId) return;

    try {
      const swapResult = await swapMeal(food.description, food.calories);
      
      // Replace the original food entry
      await upsertFoodEntry(userId, {
        id: food.id,
        description: swapResult.swapped_meal,
        calories: swapResult.macros.calories,
        protein: swapResult.macros.protein,
        carbs: swapResult.macros.carbs,
        fat: swapResult.macros.fat,
        source: 'meal_swap'
      });

      showToast(`Swapped to: ${swapResult.swapped_meal}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to swap meal');
    }
  }

  async function handleDeleteWorkout(id: string) {
    if (!userId) return;
    try {
      await deleteWorkoutEntry(userId, id);
      showToast('Workout deleted');
    } catch (e: any) {
      showToast(e?.message || 'Failed to delete workout');
    }
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="min-h-[100svh] w-full bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 top-4 -translate-x-1/2 z-50">
          <div className="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2 shadow-lg">
            {toast}
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-4xl px-4 py-6">
        {/* Greeting */}
        <Greeting />

        {/* Macro Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <MacroCard 
            label="Calories" 
            consumed={totals.food_cals}
            target={totals.allowance || targets.calories}
            unit="cal"
            color="blue"
            loading={loading}
          />
          <MacroCard 
            label="Protein" 
            consumed={totals.protein}
            target={targets.protein}
            unit="g"
            color="green"
            loading={loading}
          />
          <MacroCard 
            label="Carbs" 
            consumed={totals.carbs}
            target={targets.carbs}
            unit="g"
            color="orange"
            loading={loading}
          />
          <MacroCard 
            label="Fat" 
            consumed={totals.fat}
            target={targets.fat}
            unit="g"
            color="purple"
            loading={loading}
          />
        </div>

        {/* Food Section */}
        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Food</h2>
          </div>

          {/* Natural Language Food Input */}
          <FoodNLInput 
            onAdd={handleAddFoodItems}
            savedMeals={savedMeals}
            loading={loading}
          />

          {/* Food List */}
          {loading ? (
            <div className="space-y-2 mt-4">
              {[1, 2].map(i => (
                <div key={i} className="animate-pulse">
                  <div className="h-16 bg-neutral-200 dark:bg-neutral-700 rounded-xl"></div>
                </div>
              ))}
            </div>
          ) : foods.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-4 mt-4">
              No food logged today
            </p>
          ) : (
            <div className="space-y-2 mt-4">
              {foods.map((food) => (
                <div key={food.id} className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
                  {editingFood?.id === food.id ? (
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={editingFood.description}
                        onChange={(e) => setEditingFood({ ...editingFood, description: e.target.value })}
                        className="w-full px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                      />
                      <div className="grid grid-cols-4 gap-2">
                        <input
                          type="number"
                          value={editingFood.calories}
                          onChange={(e) => setEditingFood({ ...editingFood, calories: Number(e.target.value) })}
                          placeholder="Cal"
                          className="px-2 py-1 text-xs border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                        />
                        <input
                          type="number"
                          value={editingFood.protein}
                          onChange={(e) => setEditingFood({ ...editingFood, protein: Number(e.target.value) })}
                          placeholder="P"
                          className="px-2 py-1 text-xs border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                        />
                        <input
                          type="number"
                          value={editingFood.carbs}
                          onChange={(e) => setEditingFood({ ...editingFood, carbs: Number(e.target.value) })}
                          placeholder="C"
                          className="px-2 py-1 text-xs border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                        />
                        <input
                          type="number"
                          value={editingFood.fat}
                          onChange={(e) => setEditingFood({ ...editingFood, fat: Number(e.target.value) })}
                          placeholder="F"
                          className="px-2 py-1 text-xs border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditFood(editingFood)}
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingFood(null)}
                          className="px-2 py-1 text-xs bg-neutral-500 text-white rounded hover:bg-neutral-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{food.description}</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">
                          {food.calories} cal • {food.protein}g protein • {food.carbs}g carbs • {food.fat}g fat
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleSaveAsMeal(food)}
                          className="p-1 text-neutral-500 hover:text-blue-600 transition-colors"
                          title="Save as meal"
                        >
                          <Save size={14} />
                        </button>
                        <button
                          onClick={() => handleMealSwap(food)}
                          className="p-1 text-neutral-500 hover:text-orange-600 transition-colors"
                          title="Swap for healthier option"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          onClick={() => setEditingFood(food)}
                          className="p-1 text-neutral-500 hover:text-blue-600 transition-colors"
                          title="Edit"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteFood(food.id)}
                          className="p-1 text-neutral-500 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workout Section */}
        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Workouts</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setPlanWeekOpen(true)}
                className="px-3 py-1 rounded-xl border border-neutral-200 dark:border-neutral-800 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors flex items-center gap-1"
              >
                <Calendar size={14} />
                Plan Week
              </button>
              <button
                onClick={() => setWorkoutModalOpen(true)}
                className="px-3 py-1 rounded-xl bg-green-600 text-white text-sm hover:bg-green-700 transition-colors flex items-center gap-1"
              >
                <Plus size={16} />
                Add Workout
              </button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1].map(i => (
                <div key={i} className="animate-pulse">
                  <div className="h-16 bg-neutral-200 dark:bg-neutral-700 rounded-xl"></div>
                </div>
              ))}
            </div>
          ) : workouts.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-4">
              No workouts logged today
            </p>
          ) : (
            <div className="space-y-2">
              {workouts.map((workout) => (
                <div key={workout.id} className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{workout.activity}</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      {workout.calories_burned} calories burned
                      {workout.minutes && ` • ${workout.minutes} min`}
                      {workout.intensity && ` • ${workout.intensity}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteWorkout(workout.id)}
                    className="p-1 text-neutral-500 hover:text-red-600 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Workout Modal */}
      <WorkoutFormModal
        isOpen={workoutModalOpen}
        onClose={() => setWorkoutModalOpen(false)}
        onSave={handleAddWorkout}
        loading={loading}
      />

      {/* Plan Week Modal */}
      <PlanWeekModal
        isOpen={planWeekOpen}
        onClose={() => setPlanWeekOpen(false)}
        onAddWorkout={handleAddPlanWorkout}
      />
    </div>
  );
}