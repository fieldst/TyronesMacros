import { z } from 'zod';
import { wrap, validate } from './_wrap';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EstimateMacrosSchema = z.object({
  text: z.string().min(1).max(500),
  userGoals: z.enum(['cut', 'recomp', 'bulk']).optional(),
  timezone: z.string().optional()
});

type FoodItem = {
  name: string;
  quantity: string;
  unit?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type EstimateResponse = {
  items: FoodItem[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  confidence: 'high' | 'medium' | 'low';
};

// Fallback food database
const FALLBACK_FOODS: Record<string, Omit<FoodItem, 'name' | 'quantity'>> = {
  'chicken wing': { calories: 99, protein: 9, carbs: 0, fat: 7 },
  'chicken breast': { calories: 165, protein: 31, carbs: 0, fat: 4 },
  'steak': { calories: 250, protein: 26, carbs: 0, fat: 15 },
  'banana': { calories: 105, protein: 1, carbs: 27, fat: 0 },
  'apple': { calories: 95, protein: 0, carbs: 25, fat: 0 },
  'egg': { calories: 70, protein: 6, carbs: 1, fat: 5 },
  'rice': { calories: 130, protein: 3, carbs: 28, fat: 0 },
  'fries': { calories: 365, protein: 4, carbs: 48, fat: 17 },
  'salad': { calories: 20, protein: 1, carbs: 4, fat: 0 }
};

function createFallbackResponse(text: string): EstimateResponse {
  const words = text.toLowerCase().split(/\s+/);
  const items: FoodItem[] = [];
  
  // Extract quantities
  const quantityMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:oz|cup|piece|slice|serving)?/i);
  const baseQuantity = quantityMatch ? parseFloat(quantityMatch[1]) : 1;
  
  // Try to match common foods
  for (const [food, macros] of Object.entries(FALLBACK_FOODS)) {
    if (words.some(word => word.includes(food.split(' ')[0]))) {
      const multiplier = food === 'steak' && text.includes('oz') ? baseQuantity / 6 : baseQuantity;
      items.push({
        name: food,
        quantity: `${baseQuantity} ${food === 'steak' ? 'oz' : 'serving'}`,
        calories: Math.round(macros.calories * multiplier),
        protein: Math.round(macros.protein * multiplier),
        carbs: Math.round(macros.carbs * multiplier),
        fat: Math.round(macros.fat * multiplier)
      });
    }
  }

  // If no matches, create generic estimate
  if (items.length === 0) {
    items.push({
      name: text.substring(0, 50),
      quantity: '1 serving',
      calories: 200,
      protein: 15,
      carbs: 20,
      fat: 8
    });
  }

  const totals = items.reduce((acc, item) => ({
    calories: acc.calories + item.calories,
    protein: acc.protein + item.protein,
    carbs: acc.carbs + item.carbs,
    fat: acc.fat + item.fat
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  return {
    items,
    totals,
    confidence: items.length > 1 ? 'medium' : 'low'
  };
}

export const POST = wrap(async (req: Request) => {
  const body = await req.json();
  const { text, userGoals, timezone } = validate(EstimateMacrosSchema, body);

  // Check if OpenAI is available
  if (!process.env.OPENAI_API_KEY) {
    const fallbackData = createFallbackResponse(text);
    return new Response(JSON.stringify({
      success: true,
      data: fallbackData
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const systemPrompt = `Parse food descriptions into structured JSON. Return ONLY valid JSON matching this exact schema:
{
  "items": [
    {
      "name": "food name",
      "quantity": "amount with unit",
      "unit": "optional unit",
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number
    }
  ],
  "totals": {
    "calories": number,
    "protein": number,
    "carbs": number,
    "fat": number
  },
  "confidence": "high" | "medium" | "low"
}

Use standard nutrition data. Be precise with quantities and realistic with macros.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Parse this food description: "${text}"` }
      ],
      response_format: { type: 'json_object' }
    });

    const aiText = response.choices[0]?.message?.content;
    if (aiText) {
      try {
        const parsed = JSON.parse(aiText);
        if (parsed.items && parsed.totals && parsed.confidence) {
          return new Response(JSON.stringify({
            success: true,
            data: parsed
          }), { headers: { 'Content-Type': 'application/json' } });
        }
      } catch (parseError) {
        console.error('Failed to parse AI response:', parseError);
      }
    }

    // Retry with more explicit schema
    const retryResponse = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt + '\n\nIMPORTANT: Return valid JSON only. No explanations.' },
        { role: 'user', content: `Food: "${text}". Return JSON with items array, totals object, and confidence string.` }
      ],
      response_format: { type: 'json_object' }
    });

    const retryText = retryResponse.choices[0]?.message?.content;
    if (retryText) {
      try {
        const parsed = JSON.parse(retryText);
        if (parsed.items && parsed.totals) {
          return new Response(JSON.stringify({
            success: true,
            data: parsed
          }), { headers: { 'Content-Type': 'application/json' } });
        }
      } catch {}
    }

    // AI failed, return 502
    return new Response(JSON.stringify({
      success: false,
      error: 'AI response invalid'
    }), { 
      status: 502,
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('OpenAI API error:', error);
    
    // Fallback on any error
    const fallbackData = createFallbackResponse(text);
    return new Response(JSON.stringify({
      success: true,
      data: fallbackData
    }), { headers: { 'Content-Type': 'application/json' } });
  }
});