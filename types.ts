// types.ts
export type Target = {
  id: string;
  user_id: string;
  source: 'ai' | 'manual';
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  rationale?: string | null;
  inputs?: any;
  is_active: boolean;
  created_at: string;
};

