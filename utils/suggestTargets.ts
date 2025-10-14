// utils/suggestTargets.ts
// A fully local, personalized target suggester with motivating rationale.

export type SuggestTargetsInput = {
  sex?: 'male' | 'female';
  age?: number;              // years
  heightIn?: number;         // inches
  weightLbs?: number;        // lbs
  activity?: 'sedentary' | 'light' | 'moderate' | 'very';
  goal?: 'cut' | 'maintain' | 'recomp' | 'bulk'; // optional explicit goal
  goalText?: string;         // free text for AI coach parsing
};

export type SuggestTargetsResult = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  label: 'CUT' | 'LEAN' | 'RECOMP' | 'MAINTAIN' | 'BULK';
  rationale: string; // motivating, personalized explanation
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function parseIntent(text: string | undefined) {
  const t = (text || '').toLowerCase();

  const wantsLoss   = /\b(cut|deficit|lean|lose|fat loss|weight loss|reduce)\b/.test(t);
  const wantsGain   = /\b(bulk|surplus|gain|muscle gain|add size)\b/.test(t);
  const recomp      = /\b(recomp|re-composition|recomposition)\b/.test(t) || (/\bmaintain\b/.test(t) && /\bbuild|\bstrength|\bperformance/.test(t));

  // Intensity parsing
  const aggressive  = /\b(aggressive|fast|hard cut|mini cut|rapid|2+?\s*lb\/?wk)\b/.test(t);
  const moderate    = /\b(moderate|~?1\s*lb\/?wk|1\s*lb( per|\/)week)\b/.test(t);
  const mild        = /\b(mild|slow|~?0\.5\s*lb\/?wk|0\.5\s*lb( per|\/)week)\b/.test(t);

  // Lifestyle/constraints for coaching tone
  const lactose     = /\b(lactose|dairy[- ]?free|milk allergy|lactase)\b/.test(t);
  const gluten      = /\b(gluten|celiac)\b/.test(t);
  const vegetarian  = /\b(vegetarian|ovo|lacto)\b/.test(t);
  const vegan       = /\b(vegan|plant[- ]?based)\b/.test(t);
  const travel      = /\b(travel|flying|airport|hotel)\b/.test(t);
  const eveningWO   = /\b(evening|pm)\b/.test(t) && /\b(workout|train|lift|run|ride)\b/.test(t);
  const morningWO   = /\b(morning|am)\b/.test(t) && /\b(workout|train|lift|run|ride)\b/.test(t);
  const strength    = /\b(lift|strength|resistance|weights|barbell|hypertrophy)\b/.test(t);
  const endurance   = /\b(run|ride|cycle|swim|cardio|marathon|tri|zone 2|z2)\b/.test(t);
  const steps       = /\b(\d{3,5,}k\s*steps|[5-9]k\s*steps|1[0-5]k\s*steps|step goal)\b/.test(t);

  // Decide goal
  let goal: 'cut' | 'maintain' | 'recomp' | 'bulk' = 'maintain';
  if (wantsLoss) goal = 'cut';
  else if (wantsGain) goal = 'bulk';
  else if (recomp) goal = 'recomp';

  // Deficit/surplus size (kcal)
  let delta = 0;
  if (goal === 'cut') {
    if (aggressive) delta = -600;  // fast cut (short blocks recommended)
    else if (moderate) delta = -450;
    else if (mild) delta = -300;
    else delta = -400;             // default
  } else if (goal === 'bulk') {
    if (aggressive) delta = +450;  // watch fat gain
    else if (moderate) delta = +300;
    else if (mild) delta = +200;
    else delta = +300;             // default
  } else if (goal === 'recomp') {
    // small surplus on training, small deficit on rest; here we set near maintenance
    delta = 0;
  }

  return {
    goal,
    delta,
    flags: { lactose, gluten, vegetarian, vegan, travel, eveningWO, morningWO, strength, endurance, steps }
  };
}

function activityFactor(level?: SuggestTargetsInput['activity']) {
  switch (level) {
    case 'very': return 1.725;
    case 'moderate': return 1.55;
    case 'light': return 1.375;
    default: return 1.2; // sedentary
  }
}

function mifflinStJeorBmr(sex: 'male' | 'female', age: number, heightCm: number, weightKg: number) {
  return sex === 'female'
    ? 10 * weightKg + 6.25 * heightCm - 5 * age - 161
    : 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
}

function estimateBmi(heightIn?: number, weightLbs?: number) {
  if (!heightIn || !weightLbs) return null;
  const hM = heightIn * 0.0254;
  const wKg = weightLbs * 0.45359237;
  if (hM <= 0) return null;
  return wKg / (hM * hM);
}

function pickProteinPerLb(goal: 'cut'|'maintain'|'recomp'|'bulk', bmi: number | null, strength: boolean) {
  // Base bands
  let perLb = goal === 'cut' ? 0.9 : goal === 'bulk' ? 0.85 : 0.8;
  // If BMI is high or user is dieting aggressively → push higher end for satiety/lean mass retention
  if (goal === 'cut' && bmi && bmi >= 28) perLb = Math.max(perLb, 0.95);
  // If strength/hypertrophy specifically mentioned, bump slightly
  if (strength) perLb += 0.05;
  return clamp(perLb, 0.75, 1.05);
}

function fatFloorPerLb(sex: 'male'|'female', goal: 'cut'|'maintain'|'recomp'|'bulk') {
  // Minimum fat per lb bodyweight to support hormones; slightly higher for females
  const base = sex === 'female' ? 0.35 : 0.3;
  if (goal === 'cut') return base;              // don’t go too low when cutting
  if (goal === 'bulk') return base * 0.9;       // a bit lower floor (more carbs)
  return base;                                   // maintain/recomp
}

function buildCoachingRationale(
  inp: SuggestTargetsInput,
  out: { calories: number; protein: number; carbs: number; fat: number },
  parsed: ReturnType<typeof parseIntent>
) {
  const { goal, delta } = parsed;
  const cal = Math.round(out.calories);
  const p = Math.round(out.protein);
  const c = Math.round(out.carbs);
  const f = Math.round(out.fat);
  const d = Math.abs(Math.round(delta || 0));

  const calLine =
    goal === 'bulk'
      ? `Calorie plan — a small extra ${d || 200} calories per day to help you build muscle without adding much fat.`
      : goal === 'cut'
      ? `Calorie plan — a small shortfall of ${d || 250} calories per day to lose fat while keeping your workouts strong.`
      : goal === 'recomp'
      ? `Calorie plan — about even with what you burn so you can add muscle slowly while trimming fat.`
      : `Calorie plan — near even to keep your training and recovery steady.`;

  return [
    `Why these targets make sense:\n`,
    `• ${calLine}`,
    `• Protein ~${p} g — the raw material your body uses to repair and build muscle.`,
    `• Carbs ~${c} g — your main workout fuel so sets feel strong and you recover faster.`,
    `• Fats ~${f} g (~25–30% of ${cal} kcal) — support hormones, joints, and long-lasting energy.`,
    ``,
    `What to do next:`,
    `• Try to lift a little more each week (add a tiny amount of weight or 1 extra rep).`,
    `• Log meals; if your body weight hasn’t changed for ~2 weeks, nudge calories by 100–150 either way.`,
  ].join('\n');
}



export async function suggestTargets(input: SuggestTargetsInput): Promise<SuggestTargetsResult> {
  const sex: 'male' | 'female' = (input.sex || 'male');
  const age = Number(input.age || 30);
  const heightIn = Number(input.heightIn || 68);
  const weightLbs = Number(input.weightLbs || 170);
  const activity = input.activity || 'sedentary';

  const heightCm = heightIn * 2.54;
  const weightKg = weightLbs * 0.45359237;

  const baseBmr = mifflinStJeorBmr(sex, age, heightCm, weightKg);
  const tdee = baseBmr * activityFactor(activity);

  const parsed = parseIntent(input.goalText);
  // If explicit goal provided, override parsed goal but keep parsed delta shape/intensity
  const goal = input.goal || parsed.goal;
  const delta = parsed.delta;

  // Calories with guardrails
  let calories = Math.round(tdee + delta);
  calories = clamp(calories, 1200, 6000); // prevent extremes

  // Protein
  const bmi = estimateBmi(heightIn, weightLbs);
  const proteinPerLb = pickProteinPerLb(goal, bmi, parsed.flags.strength);
  let protein = Math.round(proteinPerLb * weightLbs);

  // Fat floor & carb allocation
  const fatFloor = Math.round(fatFloorPerLb(sex, goal) * weightLbs);
  const kcalAfterProtein = Math.max(0, calories - protein * 4);

  // If kcalAfterProtein is very low (aggressive cut on lighter bodyweight), reduce protein slightly but keep >=0.75 g/lb
  if (kcalAfterProtein < fatFloor * 9) {
    const minProtein = Math.round(0.75 * weightLbs);
    protein = Math.max(minProtein, Math.floor((calories - fatFloor * 9) / 4));
  }

  const kcalAfterProtein2 = Math.max(0, calories - protein * 4);
  const fat = Math.max(fatFloor, Math.round(Math.min(kcalAfterProtein2 * 0.35, kcalAfterProtein2) / 9));

  const kcalAfterPF = Math.max(0, calories - protein * 4 - fat * 9);

  // Carb emphasis for more active folks & strength athletes
  const carbBias =
    activity === 'very' || parsed.flags.strength ? 1.0 :
    activity === 'moderate' ? 0.9 :
    0.8;

  const carbs = Math.max(0, Math.round((kcalAfterPF * carbBias) / 4));

  // Label mapping
  const label: SuggestTargetsResult['label'] =
    goal === 'cut' ? 'LEAN' :
    goal === 'bulk' ? 'BULK' :
    goal === 'recomp' ? 'RECOMP' :
    'MAINTAIN';

  // Motivating rationale
  const rationale = buildCoachingRationale(
    { sex, age, heightIn, weightLbs, activity, goalText: input.goalText, goal },
    { calories, protein, carbs, fat },
    parsed
  );

  return { calories, protein, carbs, fat, label, rationale };
}
