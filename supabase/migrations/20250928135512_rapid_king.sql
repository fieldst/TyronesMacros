/*
  # Create saved_meals table

  1. New Tables
    - `saved_meals`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `name` (text, meal name)
      - `description` (text, optional description)
      - `calories` (numeric, calories per serving)
      - `protein` (numeric, protein in grams)
      - `carbs` (numeric, carbs in grams)
      - `fat` (numeric, fat in grams)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `saved_meals` table
    - Add policies for users to manage their own saved meals
*/

CREATE TABLE IF NOT EXISTS public.saved_meals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  calories numeric NOT NULL DEFAULT 0,
  protein numeric NOT NULL DEFAULT 0,
  carbs numeric NOT NULL DEFAULT 0,
  fat numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.saved_meals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own saved meals" 
  ON public.saved_meals FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own saved meals" 
  ON public.saved_meals FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved meals" 
  ON public.saved_meals FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved meals" 
  ON public.saved_meals FOR DELETE 
  USING (auth.uid() = user_id);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_saved_meals_user_id 
  ON public.saved_meals(user_id);

CREATE INDEX IF NOT EXISTS idx_saved_meals_created_at 
  ON public.saved_meals(user_id, created_at DESC);