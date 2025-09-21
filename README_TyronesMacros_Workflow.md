# Tyrone's Macros - Dev ⇄ Prod Workflow Cheat Sheet

## 🚧 Dev (local)
1. **Start API**
   ```bash
   npm run dev:api
   ```
   → http://localhost:3001

2. **Start UI**
   ```bash
   npm run dev
   ```
   → http://localhost:5173  
   (Vite proxy forwards `/api/*` → 3001)

3. **Open**
   ```
   http://localhost:5173
   ```

### 🔎 Quick tests
- Health:
  ```bash
  curl http://localhost:3001/api/health
  ```

- Generate:
  ```bash
  curl -X POST http://localhost:5173/api/generate -H "Content-Type: application/json" -d "{\"prompt\":\"Say hi\"}"
  ```

---

## 🌐 Production (Vercel)
- Frontend always calls `/api/generate` (relative).
- Serverless function lives at `api/generate.ts`.
- Set `OPENAI_API_KEY` in Vercel **Environment Variables** (Production + Preview).
- **Do not** set `VITE_API_BASE` in Vercel.

### 🚀 Deploy / Preview
- Preview (temporary Vercel URL):
  ```bash
  npm run vercel:dev
  ```

- Production (updates main prod URL):
  ```bash
  npm run vercel:prod
  ```

---

## 🛠 Common "Why isn’t it working?" Checks
- **Proxy Error** at 5173 → dev API isn’t running  
  ```bash
  npm run dev:api
  ```

- **CORS in dev** → call relative `/api/...` & restart Vite after editing config

- **401/403** → missing or invalid `OPENAI_API_KEY`

- **404 in prod** → confirm `api/generate.ts` exists and appears under Vercel → Functions


# Tyrone's Macros

Fitness & nutrition tracking app with AI-powered macro coaching.

---

## 🚀 Quick Commands Cheat Sheet

```bash
# Start API server (localhost:3001)
npm run dev:api

# Start Front-End (localhost:5173, proxies /api/* to API)
npm run dev

# Run both (two terminals)
npm run dev:api   # API
npm run dev       # Front-End

# Build & Preview Production
npm run build
npm run preview
