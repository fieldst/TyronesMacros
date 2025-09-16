import React from 'react';
import type { MacroStatusType } from '../types';

interface MacroCounterProps {
  label: string;
  remaining: number;
  unit: string;
  status: MacroStatusType;
}

const statusConfig = {
  'on-target': { color: 'text-green-500 dark:text-green-400', icon: '✅' },
  over:        { color: 'text-red-500 dark:text-red-400',     icon: '⬆️' },
  under:       { color: 'text-yellow-500 dark:text-yellow-400', icon: '⬇️' },
} as const;

const MacroCounter: React.FC<MacroCounterProps> = ({ label, remaining, unit, status }) => {
  const cfg = statusConfig[status];
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow flex flex-col items-center">
      <div className={`text-2xl font-bold ${cfg.color}`}>{remaining} {unit}</div>
      <div className="text-sm text-gray-600 dark:text-gray-300">{label} {cfg.icon}</div>
    </div>
  );
};

export default MacroCounter;
