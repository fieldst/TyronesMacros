import { apiClient } from './apiClient';

export type FoodItem = {
  name: string;
  quantity: string;
  unit?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type EstimateResponse = {
  items: FoodItem[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  confidence: 'high' | 'medium' | 'low';
};

export async function estimateMacros(
  text: string,
  userGoals?: 'cut' | 'recomp' | 'bulk',
  timezone?: string
): Promise<EstimateResponse> {
  const response = await apiClient.post<EstimateResponse>('/api/estimate-macros', {
    text: text.trim(),
    userGoals,
    timezone
  });

  if (!response.success) {
    throw new Error(response.error || 'Failed to estimate macros');
  }

  return response.data!;
}

export async function swapMeal(description: string, calories?: number) {
  const response = await apiClient.post('/api/meal-swap', {
    description,
    calories
  });

  if (!response.success) {
    throw new Error(response.error || 'Failed to get meal swap');
  }

  return response.data!;
}