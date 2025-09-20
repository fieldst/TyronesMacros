// server/dev-api.ts
import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load .env.local for dev
dotenv.config({ path: '.env.local' });

const app = express();

// --- CORS (manual) ---
const DEV_ORIGIN = 'http://localhost:5173';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', DEV_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // If you use cookies, also: res.header('Access-Control-Allow-Credentials','true');
  if (req.method === 'OPTIONS') return res.sendStatus(204); // preflight ok
  next();
});

// Body parsing AFTER CORS
app.use(bodyParser.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// (optional) health route to test quickly
app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, system, model } = req.body ?? {};
    const out = await client.chat.completions.create({
      model: model ?? 'gpt-4o-mini',
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt ?? '' },
      ],
    });
    res.json({ text: out.choices[0]?.message?.content ?? '' });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ msg: 'Server error', detail: String(e?.message ?? e) });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Dev API listening on http://localhost:${PORT}`);
});
