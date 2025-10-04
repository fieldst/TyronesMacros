/*
  # Create favorite_foods table

  1. New Tables
    - `favorite_foods`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `name` (text, food name)
      - `calories` (numeric)
      - `protein` (numeric)
      - `carbs` (numeric)
      - `fat` (numeric)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `favorite_foods` table
    - Add policy for users to manage their own favorite foods

  3. Indexes
    - Index on user_id for fast lookups
    - Index on name for search functionality
*/

CREATE TABLE IF NOT EXISTS favorite_foods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  calories numeric DEFAULT 0,
  protein numeric DEFAULT 0,
  carbs numeric DEFAULT 0,
  fat numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE favorite_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own favorite foods"
  ON favorite_foods
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_favorite_foods_user_id ON favorite_foods(user_id);
CREATE INDEX IF NOT EXISTS idx_favorite_foods_name ON favorite_foods(user_id, name);