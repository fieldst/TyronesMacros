// pages/HistoryView.tsx
import React from 'react';
import HistoryCharts from '../components/HistoryCharts';

export default function HistoryView() {
  return (
    <div className="min-h-[100svh] w-full bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-6xl px-4 py-6">
        <HistoryCharts />
      </div>
    </div>
  );
}