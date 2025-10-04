// services/coachSuggest.ts
import type { InferredGoal } from './targetsService'

export function workoutStyleSuggestion(opts: {
  goalText: string | null
  inferred: InferredGoal
  styleOptions?: Array<'classic'|'push-pull-legs'|'upper-lower'|'circuit'|'crossfit'>
}) {
  const styles = opts.styleOptions || ['classic','upper-lower','push-pull-legs','circuit','crossfit']
  const sExplain: Record<string,string> = {
    classic: 'Organizes primary muscle groups so you can push hard and recover well—great for steady hypertrophy.',
    'upper-lower': 'Higher frequency on the big lifts; easy to balance volume and recovery across the week.',
    'push-pull-legs': 'Even volume across movement patterns with clear rest spacing; excellent for muscle gain.',
    circuit: 'Time-efficient mixed stations that keep HR up while touching multiple patterns—good for recomposition/cuts.',
    crossfit: 'Mixed modal strength + conditioning + skill—excellent conditioning with varied stimuli.',
  }

  // pick the top two for each inferred goal
  let rec: string[] = []
  if (opts.inferred === 'bulk') rec = ['push-pull-legs','upper-lower']
  else if (opts.inferred === 'cut') rec = ['circuit','crossfit']
  else if (opts.inferred === 'recomp') rec = ['upper-lower','circuit']
  else rec = ['classic','upper-lower']

  // Keep only styles the app knows about
  rec = rec.filter(r => styles.includes(r as any))

  const why =
    opts.inferred === 'bulk'
      ? 'Your target prioritizes muscle gain, so we bias splits that deliver high-quality volume and progressive overload.'
      : opts.inferred === 'cut'
        ? 'Your target emphasizes fat loss with muscle retention, so we bias mixed-modal/metabolic styles with controlled strength work.'
        : opts.inferred === 'recomp'
          ? 'You want to add muscle while reducing fat, so we blend frequency for the big lifts with short, controlled conditioning.'
          : 'You want consistency and performance, so we keep a balanced strength/conditioning split.'

  const header = opts.goalText ? `Target: “${opts.goalText}”. ` : ''
  return {
    header: `${header}${why}`,
    bullets: rec.map(r => `**${label(r)}** — ${sExplain[r]}`),
  }
}

function label(k: string) {
  return k === 'push-pull-legs' ? 'Push/Pull/Legs'
    : k === 'upper-lower' ? 'Upper/Lower'
    : k[0].toUpperCase() + k.slice(1)
}

type Macro = { kcal: number; protein_g: number; carbs_g: number; fat_g: number }

export function buildFiveDayMealPlan(macros: Macro) {
  // very light templating; each item includes a protein estimate
  const days = Array.from({ length: 5 }, (_, i) => i + 1).map((d) => {
    return {
      day: d,
      mealsPerDay: 4, // breakfast, lunch, snack, dinner
      target: macros,
      meals: [
        {
          name: 'Breakfast',
          items: [
            { food: 'Greek yogurt (200g) + berries', protein_g: 22 },
            { food: 'Oats (60g) with 1 tbsp peanut butter', protein_g: 8 },
          ]
        },
        {
          name: 'Lunch',
          items: [
            { food: 'Chicken breast (6 oz) + rice (1.5 cup cooked) + veggies', protein_g: 45 },
          ]
        },
        {
          name: 'Snack',
          items: [
            { food: 'Protein shake (whey) + banana', protein_g: 25 },
          ]
        },
        {
          name: 'Dinner',
          items: [
            { food: 'Salmon (6 oz) + potatoes (300g) + salad', protein_g: 40 },
          ]
        },
      ]
    }
  })
  return days
}
