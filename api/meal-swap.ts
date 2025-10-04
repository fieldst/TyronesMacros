import { z } from 'zod';
import { wrap, validate } from './_wrap';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MealSwapSchema = z.object({
  description: z.string().min(1).max(200),
  calories: z.number().optional()
});

// Fallback meal swaps
const FALLBACK_SWAPS: Record<string, any> = {
  'chicken wing': {
    swapped_meal: 'Grilled chicken breast with herbs',
    macros: { calories: 165, protein: 31, carbs: 0, fat: 4 }
  },
  'fries': {
    swapped_meal: 'Baked sweet potato wedges',
    macros: { calories: 112, protein: 2, carbs: 26, fat: 0 }
  },
  'burger': {
    swapped_meal: 'Turkey lettuce wrap with avocado',
    macros: { calories: 250, protein: 25, carbs: 8, fat: 12 }
  },
  'pizza': {
    swapped_meal: 'Cauliflower crust pizza with vegetables',
    macros: { calories: 180, protein: 12, carbs: 15, fat: 8 }
  }
};

function createFallbackResponse(description: string, originalCalories?: number) {
  const desc = description.toLowerCase();
  
  // Try to find a matching fallback
  for (const [key, swap] of Object.entries(FALLBACK_SWAPS)) {
    if (desc.includes(key)) {
      return swap;
    }
  }

  // Create generic healthier version
  const baseCals = originalCalories || 300;
  
  return {
    swapped_meal: `Healthier version of ${description}`,
    macros: {
      calories: Math.max(100, Math.round(baseCals * 0.8)),
      protein: Math.round((originalCalories || 300) * 0.2 / 4),
      carbs: Math.round((originalCalories || 300) * 0.4 / 4),
      fat: Math.round((originalCalories || 300) * 0.3 / 9)
    }
  };
}

export const POST = wrap(async (req: Request) => {
  const body = await req.json();
  const { description, calories } = validate(MealSwapSchema, body);

  // Check if OpenAI is available
  if (!process.env.OPENAI_API_KEY) {
    const fallbackData = createFallbackResponse(description, calories);
    return new Response(JSON.stringify({
      success: true,
      data: fallbackData
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const systemPrompt = `Suggest a healthier meal alternative. Return ONLY valid JSON:
{
  "swapped_meal": "description of healthier alternative",
  "macros": {
    "calories": number,
    "protein": number,
    "carbs": number,
    "fat": number
  }
}

Focus on: lower calories, higher protein, more nutrients, less processed ingredients.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: `Original meal: ${description}${calories ? ` (${calories} calories)` : ''}. Suggest a healthier alternative.` 
        }
      ],
      response_format: { type: 'json_object' }
    });

    const aiText = response.choices[0]?.message?.content;
    if (aiText) {
      try {
        const parsed = JSON.parse(aiText);
        if (parsed.swapped_meal && parsed.macros) {
          return new Response(JSON.stringify({
            success: true,
            data: parsed
          }), { headers: { 'Content-Type': 'application/json' } });
        }
      } catch {}
    }
  } catch (error) {
    console.error('OpenAI API error:', error);
  }

  // Fallback on any error
  const fallbackData = createFallbackResponse(description, calories);
  return new Response(JSON.stringify({
    success: true,
    data: fallbackData
  }), { headers: { 'Content-Type': 'application/json' } });
});