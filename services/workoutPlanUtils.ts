// Reserved for future shared helpers (not strictly required by current edits).
// Keeping empty to avoid unused import issues.
export {};


// Estimate kcal from workout text and user profile
export async function estimateEditWorkoutKcal(text: string, profile: any): Promise<number> {
  if (!text || typeof text !== 'string') return 0;

  const lowered = text.toLowerCase();
  if (lowered.includes('bench') || lowered.includes('strength')) return 120;
  if (lowered.includes('run')) return 300;
  if (lowered.includes('walk')) return 150;
  if (lowered.includes('bike')) return 200;
  if (lowered.includes('swim')) return 400;
  return 204; // fallback
}
