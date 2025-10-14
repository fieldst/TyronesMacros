import React from "react";

export default function EmptyState({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center space-y-2">
      <div className="text-base font-semibold">{title}</div>
      {subtitle && <div className="text-sm text-neutral-400">{subtitle}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
