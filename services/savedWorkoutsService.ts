
// services/savedWorkoutsService.ts
import { supabase } from "../supabaseClient";
import { dateKeyChicago } from "../lib/dateLocal";

export type SavedWorkout = {
  id: string;
  user_id: string;
  name: string;
  // We persist a normalized shape but allow any to avoid breaking callers
  plan: any;
  created_at?: string;
};

const TABLE = "saved_workouts";
const MAX_SAVED = 10;

/**
 * Ensure table exists (for local dev). No-op in prod. Safe to call.
 * NOTE: This does NOT create RLS; follow SQL in the README snippet we provide.
 */
export async function ensureSavedWorkoutsTable() {
  // No-op: Supabase can't create schema from client. Kept for clarity.
  return true;
}

/** List current user's saved workouts (most recent first). */
export async function listSavedWorkouts(): Promise<SavedWorkout[]> {
  const { data: user } = await supabase.auth.getUser();
  const userId = user?.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as SavedWorkout[]) || [];
}

/**
 * Save a workout plan by name. Enforces max of 10 per user.
 * `plan` can be any JSON; minimally include a `items` array with { activity, minutes, calories_burned?, intensity? }
 */
export async function saveWorkoutPlan(name: string, plan: any): Promise<SavedWorkout> {
  const { data: user } = await supabase.auth.getUser();
  const userId = user?.user?.id;
  if (!userId) throw new Error("Not signed in");

  // Enforce limit
  const { count, error: countErr } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countErr) throw countErr;
  if ((count ?? 0) >= MAX_SAVED) {
    throw new Error(`Limit reached. You can only save up to ${MAX_SAVED} workouts.`);
  }

  const insert = { user_id: userId, name, plan };
  const { data, error } = await supabase.from(TABLE).insert(insert).select().single();
  if (error) throw error;
  return data as SavedWorkout;
}

/** Remove a saved workout by id (must belong to user). */
export async function removeSavedWorkout(id: string): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  const userId = user?.user?.id;
  if (!userId) throw new Error("Not signed in");
  const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

/**
 * Add a saved workout to today's `workout_entries` rows.
 * We accept saved plan with a few possible shapes and try to normalize.
 */
  export async function addSavedToToday(saved: SavedWorkout): Promise<{ inserted: number }> {
  const { data: user } = await supabase.auth.getUser();
  const userId = user?.user?.id;
  if (!userId) throw new Error("Not signed in");

  const today = dateKeyChicago(new Date());
  const items: any[] = normalizePlanItems(saved.plan);

  if (!items.length) return { inserted: 0 };

  // ---- kcal helpers (scoped to this function; no renames) ----
  // kcal helpers (inline; no renames)
const perMinuteForKind = (kind?: string) => {
  const k = (kind || "").toLowerCase();
  if (k.includes("warm")) return 4;
  if (k.includes("strength")) return 6;
  if (k.includes("interval") || k.includes("hiit") || k.includes("metcon") || k.includes("tabata")) return 9;
  return 7;
};
const ensureCalories = (minutes?: number, kind?: string, explicit?: number) => {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const m = Number.isFinite(minutes) ? (minutes as number) : 0;
  return Math.round(m * perMinuteForKind(kind));
};

const rows = items.map((it) => {
    const minutes = toInt(it?.minutes, 0);
    const rawCals = toInt(it?.calories_burned ?? it?.calories ?? it?.kcal, 0);

    // Prefer a descriptive line if present (Saved/AI blocks use `text`)
    const label =
      (it?.text && String(it.text)) ||
      (it?.activity && String(it.activity)) ||
      (it?.title && String(it.title)) ||
      (it?.name && String(it.name)) ||
      (it?.kind && String(it.kind)) ||
      (saved?.name ? String(saved.name) : "Workout");

    return {
      user_id: userId,
      entry_date: today,
      activity: label,
      minutes,
      calories_burned: ensureCalories(minutes, it?.kind ?? it?.category, rawCals),
      intensity: it?.intensity ?? null,
      source: "saved",
    };
  });

  const { error } = await supabase.from("workout_entries").insert(rows);
  if (error) throw error;
  return { inserted: rows.length };
}

// --- helpers ---

function toInt(v: any, dflt: number) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function normalizePlanItems(plan: any): any[] {
  if (!plan) return [];

  // Caller might pass the array directly
  if (Array.isArray(plan)) return plan;

  // Safely read supported shapes
  const p: any = plan as any;
  const blocks = Array.isArray(p.blocks) ? p.blocks : [];
  const items  = Array.isArray(p.items)  ? p.items  : [];

  // If neither array exists but it looks like a single block, wrap it
  if (!blocks.length && !items.length) {
    if (p && (p.text || p.activity || p.title || p.name)) return [p];
  }

  // ← THIS is the only array you should use downstream
  return [...blocks, ...items];
}


