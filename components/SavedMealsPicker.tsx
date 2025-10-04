// components/SavedMealsPicker.tsx
import React, { useEffect, useState } from 'react';
import { Search, Clock } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from '../auth';

type SavedMeal = {
  id: string;
  name: string;
  description?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  created_at: string;
};

type Props = {
  onSelect: (meal: SavedMeal) => void;
  onClose: () => void;
};

export default function SavedMealsPicker({ onSelect, onClose }: Props) {
  const [meals, setMeals] = useState<SavedMeal[]>([]);
  const [filteredMeals, setFilteredMeals] = useState<SavedMeal[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSavedMeals();
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setFilteredMeals(meals);
    } else {
      const filtered = meals.filter(meal => 
        meal.name.toLowerCase().includes(search.toLowerCase()) ||
        meal.description?.toLowerCase().includes(search.toLowerCase())
      );
      setFilteredMeals(filtered);
    }
  }, [search, meals]);

  async function loadSavedMeals() {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return;

      const { data, error } = await supabase
        .from('saved_meals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMeals(data || []);
    } catch (error) {
      console.error('Error loading saved meals:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="animate-pulse">
          <div className="h-10 bg-neutral-200 dark:bg-neutral-700 rounded-xl mb-3"></div>
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-neutral-200 dark:bg-neutral-700 rounded-xl"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400" size={16} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search saved meals..."
          className="w-full pl-10 pr-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Meals List */}
      <div className="max-h-96 overflow-y-auto space-y-2">
        {filteredMeals.length === 0 ? (
          <div className="text-center py-8 text-neutral-500 dark:text-neutral-400">
            {meals.length === 0 ? 'No saved meals yet' : 'No meals match your search'}
          </div>
        ) : (
          filteredMeals.map((meal) => (
            <button
              key={meal.id}
              onClick={() => onSelect(meal)}
              className="w-full p-3 text-left border border-neutral-200 dark:border-neutral-700 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-medium text-neutral-900 dark:text-neutral-100">
                    {meal.name}
                  </h4>
                  {meal.description && (
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
                      {meal.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    <span>{meal.calories} cal</span>
                    <span>{meal.protein}p</span>
                    <span>{meal.carbs}c</span>
                    <span>{meal.fat}f</span>
                  </div>
                </div>
                <div className="flex items-center text-xs text-neutral-400 ml-2">
                  <Clock size={12} className="mr-1" />
                  {new Date(meal.created_at).toLocaleDateString()}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Close Button */}
      <button
        onClick={onClose}
        className="w-full py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
      >
        Close
      </button>
    </div>
  );
}