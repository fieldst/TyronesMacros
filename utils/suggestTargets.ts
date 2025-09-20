// utils/suggestTargets.ts
// Realistic target calculation using:
// - Mifflin–St Jeor BMR
// - Activity multiplier
// - Goal adjustment (cut/recomp/bulk)
// - Macro allocation: higher protein for cut/recomp, carbs as remainder

type Input = {
  sex?: 'male' | 'female'
  age?: number           // years
  heightIn?: number      // inches
  weightLbs?: number     // pounds
  activity?: 'sedentary' | 'light' | 'moderate' | 'very'
  goal?: 'cut' | 'recomp' | 'bulk'
}

export async function suggestTargets(input: Input): Promise<{
  calories: number
  protein: number
  carbs: number
  fat: number
}> {
  // Defaults if missing (keeps UX forgiving)
  const sex = input.sex ?? 'male'
  const age = input.age ?? 30
  const heightIn = input.heightIn ?? 70
  const weightLbs = input.weightLbs ?? 190
  const activity = input.activity ?? 'moderate'
  const goal = input.goal ?? 'recomp'

  // Unit conversions
  const weightKg = weightLbs * 0.45359237
  const heightCm = heightIn * 2.54

  // Mifflin–St Jeor BMR
  // Male:   10*kg + 6.25*cm - 5*age + 5
  // Female: 10*kg + 6.25*cm - 5*age - 161
  const bmr =
    (sex === 'male'
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161)

  // Activity multiplier
  const mult =
    activity === 'sedentary' ? 1.2 :
    activity === 'light'     ? 1.375 :
    activity === 'moderate'  ? 1.55 :
    /* very */                 1.725

  let tdee = bmr * mult

  // Goal adjustment
  // cut:    -15% (gentle fat loss)
  // recomp:  -5% (or near maintenance with high protein)
  // bulk:   +10% (lean gain)
  const goalAdj =
    goal === 'cut'   ? 0.85 :
    goal === 'bulk'  ? 1.10 :
    /* recomp */       0.95

  let calories = Math.round(tdee * goalAdj)

  // Macro allocation
  // Higher protein for cut/recomp; moderate fat; carbs = remainder.
  const proteinPerLb =
    goal === 'bulk' ? 0.85 : 1.0  // g/lb
  const fatPerLb =
    goal === 'cut' ? 0.30 : goal === 'recomp' ? 0.33 : 0.35 // g/lb

  const protein = Math.round(proteinPerLb * weightLbs) // g
  const fat     = Math.round(fatPerLb * weightLbs)     // g

  const kcalFromProtein = protein * 4
  const kcalFromFat     = fat * 9
  const kcalForCarbs    = Math.max(0, calories - kcalFromProtein - kcalFromFat)
  const carbs           = Math.round(kcalForCarbs / 4)

  // If protein/fat allocations overshoot calories (rare with small cals), scale down safely
  if (kcalForCarbs === 0 && (kcalFromProtein + kcalFromFat) > calories) {
    const scale = calories / (kcalFromProtein + kcalFromFat)
    const p2 = Math.max(0, Math.floor(protein * scale))
    const f2 = Math.max(0, Math.floor(fat * scale))
    const kcP = p2 * 4, kcF = f2 * 9
    const c2 = Math.max(0, Math.round((calories - kcP - kcF) / 4))
    return { calories, protein: p2, fat: f2, carbs: c2 }
  }

  return { calories, protein, carbs, fat }
}
