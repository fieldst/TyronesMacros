// lib/nutrition.ts
export type Sex = 'male' | 'female'

export type ProfileInputs = {
  sex: Sex
  age: number
  heightIn: number   // inches
  weightLbs: number
  activityLevel?: string | null
}

export function mifflinStJeor({ sex, age, heightIn, weightLbs }: ProfileInputs): number {
  const kg = weightLbs * 0.453592
  const cm = heightIn * 2.54
  const base = (10 * kg) + (6.25 * cm) - (5 * age)
  return Math.round(sex === 'male' ? base + 5 : base - 161)
}

export function activityMultiplier(label?: string | null): number {
  const v = (label || '').toLowerCase()
  if (v.includes('very') && v.includes('active')) return 1.725
  if (v.includes('active')) return 1.55
  if (v.includes('light')) return 1.375
  if (v.includes('sedentary') || v.includes('low')) return 1.2
  return 1.4
}

export function adjustForGoal(tdee: number, inferred: 'cut'|'lean'|'bulk'|'recomp'): number {
  const factor =
    inferred === 'cut'    ? 0.80 :
    inferred === 'recomp' ? 0.90 :
    inferred === 'bulk'   ? 1.10 : 1.00
  return Math.round(tdee * factor)
}

/** Simple default macro split if your Targets row doesn't store macros. */
export function defaultMacros(kcal: number, weightLbs: number, inferred: 'cut'|'lean'|'bulk'|'recomp') {
  // protein: 0.9–1.0g/lb for cut/recomp, 0.8–0.9 for bulk/lean
  const p = Math.round((inferred === 'cut' || inferred === 'recomp' ? 1.0 : 0.9) * weightLbs)
  // fat ~25% kcal
  const fatKcal = Math.round(kcal * 0.25)
  const f = Math.round(fatKcal / 9)
  // carbs = remainder
  const carbKcal = Math.max(0, kcal - (p * 4) - (f * 9))
  const c = Math.round(carbKcal / 4)
  return { protein_g: p, carbs_g: c, fat_g: f }
}
