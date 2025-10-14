import React from "react";

type MeterPillProps = {
  label: string;
  value: number;        // current
  max: number;          // total
  suffix?: string;      // e.g., 'kcal', 'g'
};

export default function MeterPill({ label, value, max, suffix = "" }: MeterPillProps) {
  const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</span>
        <span className="text-sm font-medium">{value.toLocaleString()} {suffix}</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
        <div className="h-full rounded-full bg-purple-600 transition-all" style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}
