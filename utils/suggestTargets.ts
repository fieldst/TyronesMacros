// utils/suggestTargets.ts
// Your original math (MSJ → activity → goal adj → macros) + optional AI route.
// Always returns { calories, protein, carbs, fat, label, rationale }.
// "rationale" is a clear, human explanation from the AI Coach.
//
// If /api/suggest-targets is present, we use it. Otherwise we compute locally.

type Input = {
  sex?: 'male' | 'female'
  age?: number           // years
  heightIn?: number      // inches
  weightLbs?: number     // pounds
  activity?: 'sedentary' | 'light' | 'moderate' | 'very'
  goal?: 'cut' | 'recomp' | 'bulk' // legacy
  goalText?: string                 // free-text user goal
}

export type SuggestTargetsResult = {
  calories: number
  protein: number
  carbs: number
  fat: number
  label?: 'CUT' | 'BULK' | 'RECOMP' | 'MAINTAIN' | 'LEAN'
  rationale?: string // AI Coach explanation
}

// ---------- helpers ----------
const clampInt = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(n)))

const lbsToKg = (lbs?: number) => (lbs ?? 0) * 0.45359237
const inToCm  = (i?: number)   => (i ?? 0) * 2.54

function classifyLabel(goalText?: string, legacy?: Input['goal']): SuggestTargetsResult['label'] {
  if (legacy === 'cut') return 'CUT'
  if (legacy === 'recomp') return 'RECOMP'
  if (legacy === 'bulk') return 'BULK'
  const s = (goalText || '').toLowerCase()
  if (/\b(cut|shred|deficit|fat\s*loss|lean\s*down|lose)\b/.test(s)) return 'CUT'
  if (/\b(bulk|mass|surplus|gain)\b/.test(s)) return 'BULK'
  if (/\b(recomp|re-composition|re\W*comp)\b/.test(s)) return 'RECOMP'
  if (/\b(maintain|maintenance|maint)\b/.test(s)) return 'MAINTAIN'
  if (/\b(lean)\b/.test(s)) return 'LEAN'
  return 'LEAN'
}

function msjBmr({ sex, age, heightCm, weightKg }: { sex: 'male' | 'female', age: number, heightCm: number, weightKg: number }) {
  return sex === 'male'
    ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * age - 161
}

function activityMult(a: Input['activity']) {
  switch (a) {
    case 'sedentary': return 1.2
    case 'light':     return 1.375
    case 'moderate':  return 1.55
    case 'very':      return 1.725
    default:          return 1.55
  }
}

function goalAdjForLabel(label: NonNullable<SuggestTargetsResult['label']>) {
  switch (label) {
    case 'CUT':      return 0.85
    case 'RECOMP':   return 0.95
    case 'BULK':     return 1.10
    case 'MAINTAIN': return 1.00
    case 'LEAN':
    default:         return 0.95
  }
}

function buildCoachExplanation(opts: {
  sex: 'male'|'female', age: number, heightIn: number, weightLbs: number,
  activity: NonNullable<Input['activity']>, label: NonNullable<SuggestTargetsResult['label']>,
  bmr: number, tdee: number, calories: number,
  protein: number, fat: number, carbs: number
}) {
  const { sex, age, heightIn, weightLbs, activity, label, bmr, tdee, calories, protein, fat, carbs } = opts
  const weightKg = lbsToKg(weightLbs)
  const pPerLb = protein / Math.max(1, weightLbs)
  const fPerKg = fat / Math.max(1, weightKg)
  const adjPct = Math.round(((calories / Math.max(1, tdee)) - 1) * 100)
  // Compose a concise, human explanation in plain language:
  return [
    `I used Mifflin–St Jeor with your info (${sex}, ${age}y, ${heightIn}in, ${weightLbs}lb) to estimate BMR ≈ ${Math.round(bmr)} kcal.`,
    `With activity "${activity}", TDEE ≈ ${Math.round(tdee)} kcal.`,
    `Because your target is **${label}**, calories are set near ${calories} kcal (${adjPct > 0 ? '+' : ''}${adjPct}% vs TDEE).`,
    `Protein ≈ ${protein} g (${pPerLb.toFixed(2)} g/lb) for muscle retention/recovery.`,
    `Fat ≈ ${fat} g (${fPerKg.toFixed(2)} g/kg) to cover essential hormones and satiety.`,
    `Carbs ≈ ${carbs} g fill the remaining energy to fuel training and day-to-day activity.`
  ].join(' ')
}

// ---------- optional backend AI ----------
async function tryBackendAI(input: Input): Promise<SuggestTargetsResult | null> {
  try {
    const resp = await fetch('/api/suggest-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sex: input.sex,
        age: input.age,
        height_cm: inToCm(input.heightIn),
        weight_kg: lbsToKg(input.weightLbs),
        activity: input.activity || 'moderate',
        goal_text: input.goalText || input.goal || ''
      })
    })
    if (!resp.ok) return null
    const data = await resp.json()
    const label = classifyLabel(input.goalText, input.goal)
    // Make sure we still provide a clear coach explanation even if API sends a short rationale
    const calories = clampInt(data.calories ?? 2200, 1200, 4500)
    const protein  = clampInt(data.protein_g ?? 160, 40, 400)
    const carbs    = clampInt(data.carbs_g ?? 220, 20, 800)
    const fat      = clampInt(data.fat_g ?? 70, 20, 200)

    // Build a compact "AI Coach" explanation around the API output
    const fallbackCoach = `Calories ${calories}, protein ${protein} g, fat ${fat} g, carbs ${carbs} g based on your goal and activity. Protein is kept high for recovery; fats moderate; carbs fill the remainder.`
    return {
      calories, protein, carbs, fat,
      label,
      rationale: data.rationale || fallbackCoach
    }
  } catch {
    return null
  }
}

// ---------- public API ----------
export async function suggestTargets(input: Input): Promise<SuggestTargetsResult> {
  // 1) Try server AI if available
  const ai = await tryBackendAI(input)
  if (ai) return ai

  // 2) Fallback to your original calculator (unchanged defaults)
  const sex = input.sex ?? 'male'
  const age = input.age ?? 30
  const heightIn = input.heightIn ?? 70
  const weightLbs = input.weightLbs ?? 190
  const activity = input.activity ?? 'moderate'
  const label = classifyLabel(input.goalText, input.goal ?? 'recomp')

  const weightKg = lbsToKg(weightLbs)
  const heightCm = inToCm(heightIn)

  const bmr = msjBmr({ sex, age, heightCm, weightKg })
  const tdee = bmr * activityMult(activity)

  const calories = clampInt(tdee * goalAdjForLabel(label), 1200, 4500)

  // Macro allocation (your original style with light guardrails)
  const proteinPerLb = (label === 'BULK') ? 0.85 : 1.0
  const fatPerLb =
    label === 'CUT' ? 0.30 : label === 'RECOMP' ? 0.33 : 0.35

  let protein = Math.round(proteinPerLb * weightLbs) // g
  let fat     = Math.round(fatPerLb * weightLbs)     // g

  let kcalFromProtein = protein * 4
  let kcalFromFat     = fat * 9
  let kcalForCarbs    = Math.max(0, calories - kcalFromProtein - kcalFromFat)
  let carbs           = Math.round(kcalForCarbs / 4)

  if (kcalForCarbs === 0 && (kcalFromProtein + kcalFromFat) > calories) {
    const scale = calories / (kcalFromProtein + kcalFromFat)
    protein = Math.max(0, Math.floor(protein * scale))
    fat     = Math.max(0, Math.floor(fat * scale))
    kcalFromProtein = protein * 4
    kcalFromFat     = fat * 9
    kcalForCarbs    = Math.max(0, calories - kcalFromProtein - kcalFromFat)
    carbs           = Math.max(0, Math.round(kcalForCarbs / 4))
  }

  // Build clear AI Coach reasoning
  const rationale = buildCoachExplanation({
    sex, age, heightIn, weightLbs, activity, label,
    bmr, tdee, calories, protein, fat, carbs
  })

  return { calories, protein, carbs, fat, label, rationale }
}
