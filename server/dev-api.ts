// server/dev-api.ts — clean API for Tyrone's Macros
import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import OpenAI from "openai";
import crypto from "crypto";
import { z, ZodError } from "zod";

// Load .env.local file
dotenv.config({ path: ".env.local" });

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

// --- Allow your frontend on 5173 to talk to API ---
const DEV_ORIGIN = "http://localhost:5173";
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", DEV_ORIGIN);
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-req-id");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// --- Correlation id + request log ---
app.use((req, _res, next) => {
  (req as any).reqId = req.headers["x-req-id"] || crypto.randomUUID();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} rid=${(req as any).reqId}`);
  next();
});

// --- OpenAI client ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const envOk = !!process.env.OPENAI_API_KEY;

// --- Error helper ---
let lastError: any = null;
function sendError(res: Response, status: number, message: string, details?: any) {
  lastError = { at: new Date().toISOString(), status, message, details };
  return res.status(status).json({ success: false, error: message, details });
}
function safeJSON(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

// --- Handler wrapper ---
function handle<T extends z.ZodTypeAny>(schema: T, fn: (args: z.infer<T>, req: Request) => Promise<any>) {
  return async (req: Request, res: Response) => {
    try {
      const args = schema.parse(req.body);
      const data = await fn(args, req);
      return res.json({ success: true, data });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return sendError(res, 400, "Invalid request body", { ...err.flatten(), reqId: (req as any).reqId });
      }
      if (err?.error) {
        return sendError(res, 502, "Upstream AI error", { ...err.error, reqId: (req as any).reqId });
      }
      return sendError(res, 500, err?.message || "Server error", { reqId: (req as any).reqId });
    }
  };
}

// --- Schemas ---
const GenerateSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  system: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const EstimateSchema = z.object({
  description: z.string().min(4, "Please describe the meal."),
});

const SwapSchema = z.object({
  description: z.string().min(4),
  calories: z.number().optional(),
});

const PlanWeekSchema = z.object({
  minutes: z.number().int().min(20).max(120),
  days: z.number().int().min(2).max(7),
  goal: z.string(),
  style: z.string(),
  targets: z.object({
    calories: z.number().nullable().optional(),
    protein: z.number().nullable().optional(),
    carbs: z.number().nullable().optional(),
    fat: z.number().nullable().optional(),
    label: z.string().nullable().optional(),
    rationale: z.string().nullable().optional(),
  }).optional(),
  equipment: z.array(z.string()).optional(),
  userName: z.string().optional(),
});

// --- Routes ---

// Generate text (greetings / suggestions) — resilient
app.post("/api/generate", handle(GenerateSchema, async ({ prompt, system, model, temperature }) => {
  // Try OpenAI first
  try {
    const completion = await openai.chat.completions.create({
      model: model || "gpt-4o-mini",
      temperature: typeof temperature === 'number' ? temperature : 0.2,
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user", content: prompt },
      ],
    });
    const text = completion.choices?.[0]?.message?.content || "";
    if (text && text.trim().length) {
      return { text };
    }
  } catch (err) {
    console.error("OpenAI /api/generate error:", err);
  }
  // Fallback so UI never gets null
  return { text: String(prompt || '').slice(0, 400) };
}));
// Generate text (greetings, etc.)
// Estimate nutrition — resilient
app.post("/api/estimate", handle(EstimateSchema, async ({ description }) => {
  // Try OpenAI first
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON {items:[{name,quantity,unit?,calories,protein,carbs,fat}], totals:{calories,protein,carbs,fat}}" },
        { role: "user", content: description },
      ],
    });
    const content = completion.choices?.[0]?.message?.content || "{}";
    const parsed = safeJSON(content);
    if (parsed) return parsed;
  } catch (e) {
    console.warn("[/api/estimate] OpenAI failed, falling back:", e?.message || e);
  }

  // Fallback for common items (no 500s)
  const txt = description.trim().toLowerCase();
  const m = txt.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  const qty = m ? parseFloat(m[1]) : 1;
  const item = (m ? m[2] : txt).replace(/\s+$/, '');

  const table: Record<string, { cal: number; p: number; c: number; f: number; unit?: string }> = {
    "chicken wing": { cal: 99, p: 9, c: 0, f: 7, unit: "wing" }, // approx per wing with skin/bone
  };
  const key = item.endsWith('s') ? item.slice(0, -1) : item;
  const row = table[key] || { cal: 120, p: 7, c: 0, f: 8, unit: "" };

  const calories = Math.round(row.cal * qty);
  const protein  = Math.round(row.p   * qty);
  const carbs    = Math.round(row.c   * qty);
  const fat      = Math.round(row.f   * qty);

  return {
    items: [{ name: `${qty} ${row.unit ? row.unit + ' ' : ''}${item}`.trim(), quantity: String(qty), unit: row.unit || undefined, calories, protein, carbs, fat }],
    totals: { calories, protein, carbs, fat },
  };
}));


// Meal swap
app.post("/api/meal-swap", handle(SwapSchema, async ({ description, calories }) => {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return JSON {suggestion:string, description:string, calories:number}" },
      { role: "user", content: JSON.stringify({ description, calories: calories ?? null }) },
    ],
  });
  const content = completion.choices?.[0]?.message?.content || "{}";
  return safeJSON(content) || { suggestion: "Grilled chicken salad", description: "", calories: calories ?? 0 };
}));

// Plan workouts
app.post("/api/plan-week", handle(PlanWeekSchema, async (args) => {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return JSON {week:[{day,warmup[],main[],finisher?,cooldown[]}]} honoring minutes, goal, style, and equipment." },
      { role: "user", content: JSON.stringify(args) },
    ],
  });
  const content = completion.choices?.[0]?.message?.content || "{}";
  return safeJSON(content) || { week: [] };
}));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    envOk,
    model: "gpt-4o-mini",
    port: Number(process.env.DEV_API_PORT || 3002),
    lastError,
    routes: ["/api/health", "/api/estimate", "/api/meal-swap", "/api/generate", "/api/plan-week"],
  });
});

// Error guard
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  return sendError(res, 500, "Unhandled server error");
});

// Start server
const PORT = Number(process.env.DEV_API_PORT || 3002);
app.listen(PORT, () => {
  console.log(`Dev API listening on http://localhost:${PORT} (env OK: ${envOk})`);
});
