// components/ModelSelector.tsx
import React, { useEffect, useState } from 'react';

const DEFAULT_MODEL = (import.meta as any).env?.VITE_OPENAI_MODEL || 'gpt-4o-mini';

const MODELS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
  { id: 'gpt-4o', label: 'GPT-4o (higher quality)' },
];

export default function ModelSelector() {
  const [model, setModel] = useState<string>(DEFAULT_MODEL);

  useEffect(() => {
    try {
      const m = localStorage.getItem('selectedModel');
      if (m) setModel(m);
    } catch {}
  }, []);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    setModel(v);
    try { localStorage.setItem('selectedModel', v); } catch {}
  }

  return (
    <label className="text-xs text-gray-600 flex items-center gap-2">
      Model:
      <select
        className="border rounded px-2 py-1 text-xs"
        value={model}
        onChange={onChange}
      >
        {MODELS.map(m => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
    </label>
  );
}
