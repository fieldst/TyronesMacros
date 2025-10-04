/*
  # Tyrone's Macros v2 Schema

  1. Tables
    - days (user_id, date, targets, totals)
    - food_entries (user_id, entry_date, description, macros)
    - workout_entries (user_id, entry_date, activity, details)
    - saved_meals (user templates)
    - user_profiles (display names, preferences)

  2. Views
    - v_day_totals (aggregated daily stats)

  3. Functions
    - ensure_today_day() (upsert with target carryforward)
*/

-- Ensure days table with proper constraints
CREATE TABLE IF NOT EXISTS days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  targets jsonb NOT NULL DEFAULT '{"calories": 2000, "protein": 150, "carbs": 200, "fat": 65}',
  totals jsonb NOT NULL DEFAULT '{"food_cals": 0, "workout_cals": 0, "allowance": 2000, "remaining": 2000, "protein": 0, "carbs": 0, "fat": 0}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- Ensure food_entries table
CREATE TABLE IF NOT EXISTS food_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  description text NOT NULL,
  calories integer NOT NULL DEFAULT 0,
  protein integer DEFAULT 0,
  carbs integer DEFAULT 0,
  fat integer DEFAULT 0,
  source text DEFAULT 'manual',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure workout_entries table
CREATE TABLE IF NOT EXISTS workout_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  activity text NOT NULL,
  minutes integer,
  intensity text,
  calories_burned integer NOT NULL DEFAULT 0,
  source text DEFAULT 'manual',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- New: saved_meals table
CREATE TABLE IF NOT EXISTS saved_meals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  calories integer NOT NULL,
  protein integer DEFAULT 0,
  carbs integer DEFAULT 0,
  fat integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure user_profiles table exists
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  sex text,
  age integer,
  height_in integer,
  weight_lbs integer,
  activity_level text,
  goal_pretext text,
  workout_style text DEFAULT 'strength_cardio',
  updated_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_days_user_date ON days(user_id, date);
CREATE INDEX IF NOT EXISTS idx_food_entries_user_date ON food_entries(user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_workout_entries_user_date ON workout_entries(user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_saved_meals_user ON saved_meals(user_id);

-- View: v_day_totals (aggregated daily stats)
CREATE OR REPLACE VIEW v_day_totals AS
SELECT 
  d.user_id,
  d.date,
  d.targets,
  COALESCE(f.food_cals, 0) as food_cals,
  COALESCE(f.food_protein, 0) as food_protein,
  COALESCE(f.food_carbs, 0) as food_carbs,
  COALESCE(f.food_fat, 0) as food_fat,
  COALESCE(w.workout_cals, 0) as workout_cals,
  (COALESCE((d.targets->>'calories')::int, 0) + COALESCE(w.workout_cals, 0)) as allowance,
  (COALESCE((d.targets->>'calories')::int, 0) + COALESCE(w.workout_cals, 0) - COALESCE(f.food_cals, 0)) as remaining
FROM days d
LEFT JOIN (
  SELECT 
    user_id, 
    entry_date,
    SUM(calories) as food_cals,
    SUM(protein) as food_protein,
    SUM(carbs) as food_carbs,
    SUM(fat) as food_fat
  FROM food_entries 
  GROUP BY user_id, entry_date
) f ON d.user_id = f.user_id AND d.date = f.entry_date
LEFT JOIN (
  SELECT 
    user_id, 
    entry_date,
    SUM(calories_burned) as workout_cals
  FROM workout_entries 
  GROUP BY user_id, entry_date
) w ON d.user_id = w.user_id AND d.date = w.entry_date;

-- Function: ensure_today_day (upsert with target carryforward)
CREATE OR REPLACE FUNCTION ensure_today_day(p_user_id uuid, p_date date DEFAULT CURRENT_DATE)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_day_id uuid;
  v_last_targets jsonb;
BEGIN
  -- Try to get existing day
  SELECT id INTO v_day_id
  FROM days 
  WHERE user_id = p_user_id AND date = p_date;
  
  IF v_day_id IS NOT NULL THEN
    RETURN v_day_id;
  END IF;
  
  -- Get last targets to carry forward
  SELECT targets INTO v_last_targets
  FROM days 
  WHERE user_id = p_user_id AND date < p_date
  ORDER BY date DESC 
  LIMIT 1;
  
  -- Default targets if none found
  IF v_last_targets IS NULL THEN
    v_last_targets := '{"calories": 2000, "protein": 150, "carbs": 200, "fat": 65}';
  END IF;
  
  -- Insert new day
  INSERT INTO days (user_id, date, targets, totals)
  VALUES (
    p_user_id, 
    p_date, 
    v_last_targets,
    jsonb_build_object(
      'food_cals', 0,
      'workout_cals', 0,
      'allowance', COALESCE((v_last_targets->>'calories')::int, 2000),
      'remaining', COALESCE((v_last_targets->>'calories')::int, 2000),
      'protein', 0,
      'carbs', 0,
      'fat', 0
    )
  )
  RETURNING id INTO v_day_id;
  
  RETURN v_day_id;
END;
$$;

-- Enable RLS
ALTER TABLE days ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage own days" ON days FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own food entries" ON food_entries FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own workout entries" ON workout_entries FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own saved meals" ON saved_meals FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own profile" ON user_profiles FOR ALL USING (auth.uid() = user_id);