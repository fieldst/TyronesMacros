import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, History, Target, Settings } from 'lucide-react';

type Props = {
  title?: string;
  children: React.ReactNode;
};

export default function AppShell({ title = "Tyrone’s Macros", children }: Props) {
  const nav = useNavigate();
  const { pathname } = useLocation();

  const tabs = [
    { key: '/', label: 'Today', icon: <Home size={22} />, to: '/' },
    { key: '/history', label: 'History', icon: <History size={22} />, to: '/history' },
    { key: '/targets', label: 'Targets', icon: <Target size={22} />, to: '/targets' },
    { key: '/settings', label: 'Settings', icon: <Settings size={22} />, to: '/settings' },
  ];

  return (
    <div className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 min-h-[100dvh] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/60 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-950/90 backdrop-blur pt-[env(safe-area-inset-top)]">
  <div className="mx-auto w-full max-w-[800px] px-4 py-2 flex items-center justify-between">
    <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
    {/* Right side (keep minimal to avoid wrapping on small screens) */}
    <div className="text-xs opacity-70">AI Coach</div>
  </div>
</header>


      {/* Main scroll area */}
      <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+80px)]">
        <div className="mx-auto w-full max-w-[800px] px-4 pb-[72px] pt-4">
          {children}
        </div>
      </main>

      {/* Sticky bottom nav */}
      <<nav className="fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-40 border-t border-zinc-200/60 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto w-full max-w-[800px] grid grid-cols-4">
          {tabs.map(t => {
            const active = pathname === t.to;
            return (
              <button
                key={t.key}
                onClick={() => nav(t.to)}
                className={`h-[64px] md:h-[72px] flex flex-col items-center justify-center gap-1 text-xs ${active ? 'font-semibold' : 'opacity-70 hover:opacity-100'}`}

              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
