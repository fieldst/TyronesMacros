import { GoogleGenerativeAI } from '@google/generative-ai';
import type { MacroSet, Profile, Goal } from '../types';

// ---- Config ----
const API_BASE = (import.meta as any).env?.VITE_API_BASE || ''; // usually blank
const BROWSER_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const MODEL = (import.meta as any).env?.VITE_GEMINI_MODEL || 'gemini-1.5-flash';

// ---- JSON helper (robust against prose / ```json fences) ----
function extractFirstJson(text: string): any {
  // Strip code fences if present
  const fenced = text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  // Try direct parse
  try { return JSON.parse(candidate); } catch {}

  // Try to find the first {...} block
  const braceStart = candidate.indexOf('{');
  const braceEnd = candidate.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    const maybe = candidate.slice(braceStart, braceEnd + 1);
    try { return JSON.parse(maybe); } catch {}
  }

  // Last resort: strip leading/trailing junk and try again
  try { return JSON.parse(candidate.replace(/^[^{]*/,'').replace(/[^}]*$/,'')); } catch {}

  throw new Error('Unable to parse JSON from model response');
}

// ---- Server call (preferred) ----
async function callServer(prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `API error ${res.status}`);
    return data.text as string;
  } catch {
    return null; // fall back to browser SDK in dev
  }
}

// ---- Browser fallback (force JSON too) ----
async function callBrowser(prompt: string): Promise<string> {
  if (!BROWSER_KEY) throw new Error('Missing VITE_GEMINI_API_KEY for browser fallback.');
  const genAI = new GoogleGenerativeAI(BROWSER_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });
  return result.response.text();
}

async function callGemini(prompt: string): Promise<string> {
  const viaServer = await callServer(prompt);
  if (viaServer !== null) return viaServer;
  return await callBrowser(prompt);
}

// ---- Public API ----
export type TargetOption = {
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export async function estimateMacrosForMeal(mealSummary: string): Promise<{ macros: MacroSet; note: string }> {
  const prompt =
    `Estimate macros as strict JSON only: {"calories": number, "protein": number, "carbs": number, "fat": number} ` +
    `for this meal: ${mealSummary}. Respond ONLY JSON (no prose).`;
  const text = await callGemini(prompt);
  try {
    const obj = extractFirstJson(text);
    const macros: MacroSet = {
      calories: Number(obj.calories) || 0,
      protein: Number(obj.protein) || 0,
      carbs: Number(obj.carbs) || 0,
      fat: Number(obj.fat) || 0,
    };
    return { macros, note: 'AI estimate' };
  } catch {
    return { macros: { calories: 0, protein: 0, carbs: 0, fat: 0 }, note: 'AI estimate (unparsed)' };
  }
}

export async function getWorkoutCalories(workout: string, profile: Profile): Promise<{ total_calories: number }> {
  const weight = profile?.weight_lbs ?? 'unknown';
  const prompt =
    `Given weight ${weight} lbs, estimate TOTAL calories burned for this workout strictly as JSON only: ` +
    `{"total_calories": number}. No prose. Workout: ${workout}`;
  const text = await callGemini(prompt);
  try {
    const obj = extractFirstJson(text);
    return { total_calories: Number(obj.total_calories) || 0 };
  } catch {
    return { total_calories: 0 };
  }
}

export async function getSwapSuggestion(remaining: MacroSet): Promise<string> {
  // This is free-form text, not JSON
  const prompt = `Suggest one quick food swap to hit these remaining macros: ${JSON.stringify(remaining)}. Keep it to one sentence.`;
  return await callGemini(prompt);
}

export async function getTargetOptions(profile: Profile, goal: Goal): Promise<{ options: TargetOption[]; notes: string }> {
  const prompt =
    `Given profile ${JSON.stringify(profile)} and goal "${goal}", reply ONLY JSON like: ` +
    `{"notes": string, "options": [{"label":"Conservative","calories":..., "protein":..., "carbs":..., "fat":...}, ...]}. No prose.`;
  const text = await callGemini(prompt);
  try {
    const parsed = extractFirstJson(text);
    if (!Array.isArray(parsed?.options)) throw new Error('Bad shape');
    return parsed as { options: TargetOption[]; notes: string };
  } catch {
    return { notes: 'AI options unavailable', options: [] };
  }
}
