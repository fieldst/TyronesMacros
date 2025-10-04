// components/HistoryCharts.tsx
import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Calendar, TrendingUp, Award } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from '../auth';
import { getCurrentChicagoDateKey } from '../lib/dateLocal';

type HistoryData = {
  date: string;
  calories_consumed: number;
  calories_target: number;
  calories_burned: number;
  protein: number;
  carbs: number;
  fat: number;
  remaining: number;
};

type Props = {
  days?: number;
};

export default function HistoryCharts({ days = 30 }: Props) {
  const [data, setData] = useState<HistoryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(days);
  const [trends, setTrends] = useState({
    avgDeficit: 0,
    bestStreak: 0,
    proteinPR: 0
  });

  useEffect(() => {
    loadHistoryData();
  }, [filter]);

  async function loadHistoryData() {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return;

      const endDate = getCurrentChicagoDateKey();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - filter);
      const startDateStr = startDate.toISOString().split('T')[0];

      // Get data from days table with totals
      const { data: historyData, error } = await supabase
        .from('days')
        .select('date, targets, totals')
        .eq('user_id', userId)
        .gte('date', startDateStr)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) throw error;

      // Fill missing dates with zeros
      const filledData: HistoryData[] = [];
      const current = new Date(startDateStr);
      const end = new Date(endDate);

      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        const existing = historyData?.find(d => d.date === dateStr);
        
        filledData.push({
          date: dateStr,
          calories_consumed: existing?.totals?.food_cals || 0,
          calories_target: existing?.targets?.calories || 0,
          calories_burned: existing?.totals?.workout_cals || 0,
          protein: existing?.totals?.protein || 0,
          carbs: existing?.totals?.carbs || 0,
          fat: existing?.totals?.fat || 0,
          remaining: existing?.totals?.remaining || 0
        });

        current.setDate(current.getDate() + 1);
      }

      setData(filledData);
      calculateTrends(filledData);
    } catch (error) {
      console.error('Error loading history data:', error);
    } finally {
      setLoading(false);
    }
  }

  function calculateTrends(data: HistoryData[]) {
    if (data.length === 0) return;

    // Average deficit/surplus
    const avgDeficit = data.reduce((sum, d) => sum + d.remaining, 0) / data.length;

    // Best streak (days with positive remaining calories)
    let currentStreak = 0;
    let bestStreak = 0;
    data.forEach(d => {
      if (d.remaining >= 0) {
        currentStreak++;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    });

    // Protein PR
    const proteinPR = Math.max(...data.map(d => d.protein));

    setTrends({ avgDeficit, bestStreak, proteinPR });
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-neutral-200 dark:bg-neutral-700 rounded w-48 mb-4"></div>
          <div className="h-64 bg-neutral-200 dark:bg-neutral-700 rounded mb-6"></div>
          <div className="h-64 bg-neutral-200 dark:bg-neutral-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">History & Trends</h2>
        <div className="flex gap-2">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setFilter(d)}
              className={`px-3 py-1 rounded-xl text-sm transition-colors ${
                filter === d 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Trends Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-blue-600" />
            <span className="text-sm font-medium">Avg Balance</span>
          </div>
          <div className="text-2xl font-bold">
            {trends.avgDeficit > 0 ? '+' : ''}{Math.round(trends.avgDeficit)}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            calories {trends.avgDeficit > 0 ? 'remaining' : 'over'}
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 mb-2">
            <Calendar size={16} className="text-green-600" />
            <span className="text-sm font-medium">Best Streak</span>
          </div>
          <div className="text-2xl font-bold">{trends.bestStreak}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            days on target
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 mb-2">
            <Award size={16} className="text-purple-600" />
            <span className="text-sm font-medium">Protein PR</span>
          </div>
          <div className="text-2xl font-bold">{Math.round(trends.proteinPR)}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            grams in a day
          </div>
        </div>
      </div>

      {/* Calories Chart */}
      <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
        <h3 className="text-lg font-semibold mb-4">Calories & Workouts</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis 
              dataKey="date" 
              tickFormatter={(date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              stroke="#6B7280"
            />
            <YAxis stroke="#6B7280" />
            <Tooltip 
              labelFormatter={(date) => new Date(date).toLocaleDateString()}
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: 'none', 
                borderRadius: '8px',
                color: '#F9FAFB'
              }}
            />
            <Legend />
            <Bar dataKey="calories_consumed" fill="#3B82F6" name="Food Calories" />
            <Bar dataKey="calories_burned" fill="#10B981" name="Workout Calories" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Macros Chart */}
      <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
        <h3 className="text-lg font-semibold mb-4">Macronutrients</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis 
              dataKey="date" 
              tickFormatter={(date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              stroke="#6B7280"
            />
            <YAxis stroke="#6B7280" />
            <Tooltip 
              labelFormatter={(date) => new Date(date).toLocaleDateString()}
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: 'none', 
                borderRadius: '8px',
                color: '#F9FAFB'
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="protein" stroke="#10B981" strokeWidth={2} name="Protein (g)" />
            <Line type="monotone" dataKey="carbs" stroke="#F59E0B" strokeWidth={2} name="Carbs (g)" />
            <Line type="monotone" dataKey="fat" stroke="#8B5CF6" strokeWidth={2} name="Fat (g)" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Remaining Calories Chart */}
      <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
        <h3 className="text-lg font-semibold mb-4">Daily Balance</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis 
              dataKey="date" 
              tickFormatter={(date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              stroke="#6B7280"
            />
            <YAxis stroke="#6B7280" />
            <Tooltip 
              labelFormatter={(date) => new Date(date).toLocaleDateString()}
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: 'none', 
                borderRadius: '8px',
                color: '#F9FAFB'
              }}
            />
            <Line 
              type="monotone" 
              dataKey="remaining" 
              stroke="#EF4444" 
              strokeWidth={2} 
              name="Remaining Calories"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}