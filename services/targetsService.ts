// services/targetsService.ts
import { supabase } from '../supabaseClient'

export type Goal = 'cut' | 'lean' | 'bulk' | 'recomp';

export type Target = {
  goal?: Goal | string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  label?: string | null;
  rationale?: string | null;
};

export function inferGoalFromTargetText(text?: string | null): Goal | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(recomp|body\s*recomp|burn\s*fat\s*while\s*bulking)\b/.test(t)) return 'recomp';
  if (/\b(cut|cutting|fat\s*loss|deficit|shred|lean\s*out)\b/.test(t)) return 'cut';
  if (/\b(lean|tone|maintenance|maintain)\b/.test(t)) return 'lean';
  if (/\b(bulk|surplus|gain|mass)\b/.test(t)) return 'bulk';
  return null;
}

function normalizeTarget(t?: Partial<Target> | null): Target | null {
  if (!t) return null;
  return {
    goal: t.goal ?? null,
    calories: t.calories ?? null,
    protein: t.protein ?? null,
    carbs: t.carbs ?? null,
    fat: t.fat ?? null,
    label: t.label ?? null,
    rationale: t.rationale ?? null,
  };
}

export async function getActiveTarget(userId: string, dateKey: string): Promise<Target | null> {
  if (!userId || !dateKey) return null;

  const dayRes = await supabase
    .from('days')
    .select('targets')
    .eq('user_id', userId)
    .eq('date', dateKey)
    .maybeSingle();

  if (dayRes.data?.targets) return normalizeTarget(dayRes.data.targets);

  const tgtRes = await supabase
    .from('targets')
    .select('goal, calories, protein, carbs, fat, label, rationale, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  const row = tgtRes.data?.[0] as any;
  if (!row) return null;
  return normalizeTarget(row);
}

export async function setActiveTargetForDay(userId: string, dateKey: string, target: Target) {
  if (!userId || !dateKey) throw new Error('setActiveTargetForDay requires userId and dateKey');

  const payload = { user_id: userId, date: dateKey, targets: normalizeTarget(target) };
  const { error } = await supabase.from('days').upsert(payload, { onConflict: 'user_id,date' });
  if (error) throw error;
}

export function shortGoalLabel(t: Target | null): string | null {
  if (!t) return null;
  const inferred = inferGoalFromTargetText(t.label ?? (t.goal as string) ?? null);
  return inferred ?? (t.goal as string) ?? (t.label ?? null);
}
