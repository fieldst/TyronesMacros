/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Supabase (required on the client)
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;

  // OpenAI (client reads model name, NOT the secret key)
  readonly VITE_OPENAI_MODEL?: string; // e.g., "gpt-4o-mini"

  // Optional: where your API lives during dev/deploy
  // e.g., "" (empty) if using `vercel dev`, or "https://your-app.vercel.app"
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// env.d.ts
declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
  }): (reload?: boolean) => void;
}

