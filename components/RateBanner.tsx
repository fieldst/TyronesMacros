// components/RateBanner.tsx
import React, { useEffect, useState } from 'react';

export default function RateBanner() {
  const [limit, setLimit] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [reset, setReset] = useState<number | null>(null);

  useEffect(() => {
    function onUpdate(e: any) {
      const { limit, remaining, reset } = e.detail || {};
      setLimit(limit ?? null);
      setRemaining(remaining ?? null);
      setReset(reset ?? null);
    }
    window.addEventListener('rate-update' as any, onUpdate);
    return () => window.removeEventListener('rate-update' as any, onUpdate);
  }, []);

  if (limit == null || remaining == null) return null;

  const secs = reset ? Math.max(0, reset - Math.ceil(Date.now() / 1000)) : null;

  return (
    <div className="px-3 py-2 bg-amber-50 text-amber-800 text-xs border-b">
      API limit: <span className="font-semibold">{remaining}</span> / {limit}
      {typeof secs === 'number' ? <span> • resets in {secs}s</span> : null}
    </div>
  );
}
