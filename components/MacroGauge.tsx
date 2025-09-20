// components/MacroGauge.tsx
import React from 'react';

type Props = {
  label: string;
  left: number;      // remaining amount
  unit: 'cal' | 'g';
  total?: number;
};

export default function MacroGauge({ label, left, unit, total }: Props) {
  const safeTotal = total && total > 0 ? total : undefined;
  const used = safeTotal ? Math.max(0, safeTotal - left) : undefined;
  const pct = safeTotal ? Math.min(100, Math.max(0, Math.round((used! / safeTotal) * 100))) : 0;

  return (
    <div className="rounded-xl border p-3 flex flex-col gap-2">
      <div className="text-sm opacity-80">{label}</div>
      <div className="text-2xl font-semibold">
        {left}{unit === 'g' ? ' g' : ' cal'} left
      </div>
      {safeTotal && (
        <div className="h-2 w-full rounded-md bg-black/10 dark:bg-white/10 overflow-hidden">
          <div
            className="h-full bg-purple-600"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
