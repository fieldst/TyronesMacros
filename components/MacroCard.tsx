// components/MacroCard.tsx
import React from 'react';

type Props = {
  label: string;
  consumed: number;
  target: number;
  unit: 'cal' | 'g';
  color?: 'blue' | 'green' | 'orange' | 'purple';
  loading?: boolean;
};

export default function MacroCard({ 
  label, 
  consumed, 
  target, 
  unit, 
  color = 'blue',
  loading = false 
}: Props) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 shadow-sm">
        <div className="animate-pulse">
          <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-16 mb-3"></div>
          <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded w-full mb-2"></div>
          <div className="space-y-2">
            <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded w-3/4"></div>
            <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  const safeConsumed = Math.max(0, consumed || 0);
  const safeTarget = Math.max(1, target || 1);
  const remaining = Math.max(0, safeTarget - safeConsumed);
  const percentage = Math.min(100, Math.max(0, (safeConsumed / safeTarget) * 100));

  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500', 
    orange: 'bg-orange-500',
    purple: 'bg-purple-500'
  };

  const progressColor = percentage >= 100 ? 'bg-green-500' : 
                       percentage >= 80 ? colorClasses[color] :
                       percentage >= 50 ? 'bg-yellow-500' : 'bg-neutral-400';

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {label}
        </h3>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {Math.round(percentage)}%
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-500 ${progressColor}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Values */}
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">Consumed:</span>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {Math.round(safeConsumed)} {unit}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">Target:</span>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {Math.round(safeTarget)} {unit}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">Remaining:</span>
          <span className={`font-medium ${remaining > 0 ? 'text-neutral-900 dark:text-neutral-100' : 'text-green-600 dark:text-green-400'}`}>
            {Math.round(remaining)} {unit}
          </span>
        </div>
      </div>
    </div>
  );
}