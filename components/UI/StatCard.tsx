import React from "react";

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
};

export default function StatCard({ label, value, sub, right }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 px-4 py-3 flex items-center justify-between shadow-lg shadow-black/10">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
        <div className="text-lg font-semibold">{value}</div>
        {sub && <div className="text-xs text-neutral-400 mt-0.5">{sub}</div>}
      </div>
      {right}
    </div>
  );
}
