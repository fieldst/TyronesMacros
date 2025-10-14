import React from "react";

export default function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="sticky top-14 z-30 -mx-4 px-4 py-2 bg-neutral-950/75 backdrop-blur border-b border-neutral-900 flex items-center justify-between">
      <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
      {action}
    </div>
  );
}
