import { z } from 'zod';
import { wrap, validate } from './_wrap';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- helpers to parse equipment strings and build strict rules ---
function parsePoundsList(arr: string[]): number[] {
  const out: number[] = [];
  for (const s of arr || []) {
    const m = s.match(/(\d+)\s?lb/i);
    if (m) out.push(parseInt(m[1], 10));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
function hasAnyEquipment(equipment: string[]): boolean {
  return Array.isArray(equipment) && equipment.some(s => /\d+\s?lb|barbell|bench|bike|treadmill/i.test(s));
}
function equipmentRulesText(equipment: string[]) {
  const dbs = parsePoundsList(equipment.filter(s => /db|dumbbell/i.test(s)));
  const kbs = parsePoundsList(equipment.filter(s => /kb|kettlebell/i.test(s)));
  const mbs = parsePoundsList(equipment.filter(s => /med(icine)? ball/i.test(s)));
  const slams = parsePoundsList(equipment.filter(s => /slam ball/i.test(s)));
  const barMax = Math.max(...parsePoundsList(equipment.filter(s => /barbell|plates?/i.test(s))), 0) || 315;
  const cardio: string[] = [];
  if (equipment.some(s => /assault bike/i.test(s))) cardio.push('assault bike');
  if (equipment.some(s => /treadmill/i.test(s))) cardio.push('treadmill');

  const lines: string[] = [];
  if (dbs.length) lines.push(`Dumbbells (pairs): ${dbs.map(n => n + ' lb').join(', ')}`);
  if (kbs.length) lines.push(`Kettlebells: ${kbs.map(n => n + ' lb').join(', ')}`);
  lines.push(`Barbell max load: ${barMax} lb`);
  if (mbs.length) lines.push(`Medicine balls: ${mbs.map(n => n + ' lb').join(', ')}`);
  if (slams.length) lines.push(`Slam balls: ${slams.map(n => n + ' lb').join(', ')}`);
  if (cardio.length) lines.push(`Cardio: ${cardio.join(', ')}`);

  const rules = [
    'ONLY use equipment listed above. If none listed, use bodyweight only.',
    'All loads must be in **pounds** (lb). No "50s/50s".',
    'Dumbbells: format as "2 × {weight} lb DB" for pairs.',
    'Kettlebells: "KB {weight} lb".',
    'Barbell: "Barbell {weight} lb" and never exceed the Barbell max load.',
  ]
    .map(s => '- ' + s)
    .join('\n');

  return { lines, barMax, rules };
}
function sanitizeTextLbs(s: string): string {
  return s
    .replace(/(\d+)s\/(\d+)s/g, (_m, a, b) => `2 × ${a} lb DB / 2 × ${b} lb DB`)
    .replace(/(\d+)\s?lbs?\b/gi, (_m, a) => `${a} lb`);
}

const PlanWeekSchema = z.object({
  goal: z.string().min(1),
  days_available: z.number().min(1).max(7),
  minutes: z.number().min(10).max(180),
  style: z.string().min(1),
  equipment: z.array(z.string()),
  experience: z.string().optional().default('intermediate'),
  intensity: z.string().optional().default('moderate'),
});

// Fallback workout plans
const FALLBACK_PLANS: Record<string, any> = {
  'HIIT': {
    plan: [
      {
        day: 'Monday',
        title: 'HIIT Upper Body',
        blocks: [
          { exercise: 'Push-ups', sets: 4, reps: 15 },
          { exercise: 'Mountain Climbers', minutes: 1 },
          { exercise: 'Burpees', sets: 3, reps: 10 },
        ],
        estimated_calories: 300,
        notes: 'Rest 30 seconds between exercises',
      },
      {
        day: 'Tuesday',
        title: 'HIIT Lower Body',
        blocks: [
          { exercise: 'Jump Squats', sets: 4, reps: 15 },
          { exercise: 'Lunges', sets: 3, reps: 12 },
          { exercise: 'High Knees', minutes: 1 },
        ],
        estimated_calories: 280,
        notes: 'Focus on explosive movements',
      },
      {
        day: 'Wednesday',
        title: 'Active Recovery',
        blocks: [{ exercise: 'Walking', minutes: 30 }, { exercise: 'Stretching', minutes: 15 }],
        estimated_calories: 150,
        notes: 'Light movement day',
      },
      {
        day: 'Thursday',
        title: 'HIIT Full Body',
        blocks: [
          { exercise: 'Burpees', sets: 3, reps: 8 },
          { exercise: 'Plank', minutes: 1 },
          { exercise: 'Jumping Jacks', minutes: 2 },
        ],
        estimated_calories: 320,
        notes: 'High intensity circuit',
      },
      {
        day: 'Friday',
        title: 'HIIT Core Focus',
        blocks: [
          { exercise: 'Russian Twists', sets: 3, reps: 20 },
          { exercise: 'Bicycle Crunches', sets: 3, reps: 15 },
          { exercise: 'Plank Variations', minutes: 2 },
        ],
        estimated_calories: 200,
        notes: 'Core strength and stability',
      },
      {
        day: 'Saturday',
        title: 'HIIT Cardio Blast',
        blocks: [{ exercise: 'Sprint Intervals', minutes: 20 }, { exercise: 'Cool Down Walk', minutes: 10 }],
        estimated_calories: 350,
        notes: '30 seconds on, 30 seconds rest',
      },
      {
        day: 'Sunday',
        title: 'Rest Day',
        blocks: [{ exercise: 'Gentle Yoga', minutes: 20 }, { exercise: 'Meditation', minutes: 10 }],
        estimated_calories: 80,
        notes: 'Recovery and relaxation',
      },
    ],
    benefits:
      'HIIT workouts burn calories efficiently, improve cardiovascular fitness, and can be completed in short time periods. Great for fat loss and metabolic conditioning.',
  },
  'Cardio Focus': {
    plan: [
      {
        day: 'Monday',
        title: 'Steady State Cardio',
        blocks: [{ exercise: 'Brisk Walking', minutes: 30 }, { exercise: 'Light Stretching', minutes: 10 }],
        estimated_calories: 200,
        notes: 'Maintain conversational pace',
      },
      {
        day: 'Tuesday',
        title: 'Interval Training',
        blocks: [{ exercise: 'Walk/Jog Intervals', minutes: 25 }, { exercise: 'Cool Down', minutes: 5 }],
        estimated_calories: 250,
        notes: '2 minutes walk, 1 minute jog',
      },
      {
        day: 'Wednesday',
        title: 'Low Impact Cardio',
        blocks: [{ exercise: 'Swimming or Water Walking', minutes: 30 }],
        estimated_calories: 220,
        notes: 'Joint-friendly option',
      },
      {
        day: 'Thursday',
        title: 'Dance Cardio',
        blocks: [{ exercise: 'Dance Workout', minutes: 30 }, { exercise: 'Stretching', minutes: 10 }],
        estimated_calories: 280,
        notes: 'Fun and engaging cardio',
      },
      {
        day: 'Friday',
        title: 'Hill Walking',
        blocks: [{ exercise: 'Incline Walking', minutes: 35 }],
        estimated_calories: 300,
        notes: 'Increase intensity with incline',
      },
      {
        day: 'Saturday',
        title: 'Long Steady Cardio',
        blocks: [{ exercise: 'Continuous Walking/Cycling', minutes: 45 }],
        estimated_calories: 350,
        notes: 'Build endurance',
      },
      {
        day: 'Sunday',
        title: 'Active Recovery',
        blocks: [{ exercise: 'Gentle Yoga', minutes: 30 }],
        estimated_calories: 120,
        notes: 'Recovery and flexibility',
      },
    ],
    benefits:
      'Cardio workouts improve heart health, endurance, and are excellent for weight management. Progressive approach builds fitness safely.',
  },
  'Strength + Cardio': {
    plan: [
      {
        day: 'Monday',
        title: 'Upper Body Strength',
        blocks: [
          { exercise: 'Push-ups', sets: 3, reps: 12 },
          { exercise: 'Pull-ups/Rows', sets: 3, reps: 8 },
          { exercise: 'Shoulder Press', sets: 3, reps: 10 },
        ],
        estimated_calories: 250,
        notes: 'Focus on form over speed',
      },
      {
        day: 'Tuesday',
        title: 'Cardio Intervals',
        blocks: [{ exercise: 'Running/Cycling', minutes: 20 }, { exercise: 'Cool Down', minutes: 10 }],
        estimated_calories: 300,
        notes: 'Moderate to high intensity',
      },
      {
        day: 'Wednesday',
        title: 'Lower Body Strength',
        blocks: [
          { exercise: 'Squats', sets: 3, reps: 15 },
          { exercise: 'Deadlifts', sets: 3, reps: 10 },
          { exercise: 'Lunges', sets: 3, reps: 12 },
        ],
        estimated_calories: 280,
        notes: 'Progressive overload',
      },
      {
        day: 'Thursday',
        title: 'Active Recovery',
        blocks: [{ exercise: 'Light Walking', minutes: 30 }, { exercise: 'Stretching', minutes: 15 }],
        estimated_calories: 150,
        notes: 'Recovery and mobility',
      },
      {
        day: 'Friday',
        title: 'Full Body Circuit',
        blocks: [
          { exercise: 'Burpees', sets: 3, reps: 8 },
          { exercise: 'Kettlebell Swings', sets: 3, reps: 15 },
          { exercise: 'Mountain Climbers', minutes: 2 },
        ],
        estimated_calories: 350,
        notes: 'Combine strength and cardio',
      },
      {
        day: 'Saturday',
        title: 'Cardio Endurance',
        blocks: [{ exercise: 'Steady State Cardio', minutes: 40 }],
        estimated_calories: 320,
        notes: 'Build aerobic base',
      },
      {
        day: 'Sunday',
        title: 'Rest Day',
        blocks: [{ exercise: 'Yoga or Meditation', minutes: 20 }],
        estimated_calories: 80,
        notes: 'Complete rest and recovery',
      },
    ],
    benefits:
      'Combining strength and cardio provides balanced fitness development, improves both muscle strength and cardiovascular health.',
  },
  'CrossFit Style': {
    plan: [
      {
        day: 'Monday',
        title: 'WOD: Functional Strength',
        blocks: [
          { exercise: 'Deadlifts', sets: 5, reps: 5 },
          { exercise: 'Box Jumps', sets: 3, reps: 10 },
          { exercise: 'Kettlebell Swings', sets: 3, reps: 20 },
        ],
        estimated_calories: 400,
        notes: 'Focus on functional movements',
      },
      {
        day: 'Tuesday',
        title: 'WOD: Metcon',
        blocks: [
          { exercise: 'Burpees', sets: 5, reps: 10 },
          { exercise: 'Air Squats', sets: 5, reps: 15 },
          { exercise: 'Push-ups', sets: 5, reps: 10 },
        ],
        estimated_calories: 350,
        notes: 'For time - metabolic conditioning',
      },
      {
        day: 'Wednesday',
        title: 'WOD: Olympic Lifting',
        blocks: [
          { exercise: 'Clean and Press', sets: 5, reps: 3 },
          { exercise: 'Front Squats', sets: 4, reps: 8 },
          { exercise: 'Rowing', minutes: 10 },
        ],
        estimated_calories: 380,
        notes: 'Technical skill development',
      },
      {
        day: 'Thursday',
        title: 'WOD: Bodyweight',
        blocks: [
          { exercise: 'Pull-ups', sets: 5, reps: 5 },
          { exercise: 'Handstand Push-ups', sets: 3, reps: 5 },
          { exercise: 'Pistol Squats', sets: 3, reps: 5 },
        ],
        estimated_calories: 300,
        notes: 'Bodyweight mastery',
      },
      {
        day: 'Friday',
        title: 'WOD: Team/Partner',
        blocks: [
          { exercise: 'Partner Carries', minutes: 10 },
          { exercise: 'Medicine Ball Throws', sets: 4, reps: 12 },
          { exercise: 'Battle Ropes', minutes: 5 },
        ],
        estimated_calories: 420,
        notes: 'Fun and competitive',
      },
      {
        day: 'Saturday',
        title: 'WOD: Long Chipper',
        blocks: [{ exercise: '100 Burpees for time', minutes: 15 }, { exercise: 'Cool down walk', minutes: 10 }],
        estimated_calories: 450,
        notes: 'Mental toughness challenge',
      },
      {
        day: 'Sunday',
        title: 'Active Recovery',
        blocks: [{ exercise: 'Mobility Work', minutes: 30 }, { exercise: 'Light Movement', minutes: 15 }],
        estimated_calories: 120,
        notes: 'Recovery and preparation',
      },
    ],
    benefits:
      'CrossFit style training develops functional fitness, builds community, and provides constantly varied workouts that prevent boredom.',
  },
};

function getFallbackPlan(style: string, daysAvailable: number, minutes: number) {
  // Find matching plan or default to Strength + Cardio
  const planKey =
    Object.keys(FALLBACK_PLANS).find(key => key.toLowerCase().includes(style.toLowerCase())) ||
    'Strength + Cardio';

  const fallback = FALLBACK_PLANS[planKey];

  let plan = [...fallback.plan];

  // Adjust for available days
  if (daysAvailable < 7) {
    plan = plan.slice(0, daysAvailable);
  }

  // Adjust workout duration proportionally
  const durationMultiplier = minutes / 45; // 45 is baseline
  plan = plan.map(day => ({
    ...day,
    blocks: day.blocks.map((block: any) => ({
      ...block,
      minutes: block.minutes ? Math.max(5, Math.round(block.minutes * durationMultiplier)) : block.minutes,
    })),
    estimated_calories: Math.round(day.estimated_calories * durationMultiplier),
  }));

  return {
    plan,
    benefits: fallback.benefits,
  };
}

export const POST = wrap(async (req: Request) => {
  const body = await req.json();
  // include intensity in the validated input so `${intensity}` resolves
  const { goal, days_available, minutes, style, equipment, experience, intensity } =
    validate(PlanWeekSchema, body);

  // If no API key, return fallback
  if (!process.env.OPENAI_API_KEY) {
    const fallbackPlan = getFallbackPlan(style, days_available, minutes);
    return new Response(JSON.stringify({ success: true, data: fallbackPlan }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const systemPrompt = `Create a workout plan that uses ONLY the user's available equipment and expresses ALL loads in pounds (lb). No vague loads like 50s/50s.
Return ONLY valid JSON matching this exact schema:
{
  "plan": [
    {
      "day": "Monday",
      "title": "workout name",
      "blocks": [
        {
          "exercise": "exercise name",
          "sets": 3,
          "reps": 12,
          "minutes": 5
        }
      ],
      "estimated_calories": 300,
      "notes": "optional notes"
    }
  ],
  "benefits": "explanation of why this style works"
}

Create exactly ${days_available} days. Each workout should be approximately ${minutes} minutes total.
Include either sets/reps OR minutes for each exercise block.`;


    const eqInfo = equipmentRulesText(equipment);
   const eqHeader = eqInfo.lines.length
  ? `Available Equipment:
- ${eqInfo.lines.join('\n- ')}`
  : 'No equipment listed — use bodyweight only.';


    const userPrompt = `Create a ${days_available}-day ${style} workout plan:
- Goal: ${goal}
- Duration: ${minutes} minutes per session
- Intensity: ${intensity}
- Experience: ${experience}
${eqHeader}

Rules:
${eqInfo.rules}

Make it practical, progressive, and safe. Scale suggested loads to the listed intensity and equipment. Return only the JSON object.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });

    const aiText = response.choices[0]?.message?.content;
    if (aiText) {
      try {
        const parsed = JSON.parse(aiText);
        if (parsed?.plan && Array.isArray(parsed.plan) && parsed.plan.length > 0 && parsed.benefits) {
          // scrub loads to lb if model slipped
          parsed.plan = parsed.plan.map((d: any) => ({
            ...d,
            blocks: (d.blocks || []).map((b: any) => ({
              ...b,
              exercise: typeof b.exercise === 'string' ? sanitizeTextLbs(b.exercise) : b.exercise,
            })),
          }));
          return new Response(JSON.stringify({ success: true, data: parsed }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (parseError) {
        console.error('Failed to parse AI response:', parseError);
      }
    }
  } catch (error) {
    console.error('OpenAI API error:', error);
  }

  // Fallback on any error
  const fallbackPlan = getFallbackPlan(style, days_available, minutes);
  return new Response(JSON.stringify({ success: true, data: fallbackPlan }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
