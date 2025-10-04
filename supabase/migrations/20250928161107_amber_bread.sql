/*
  # Create v_day_totals view for history charts

  1. New Views
    - `v_day_totals` - Aggregated view of daily totals from days table
      - Extracts data from JSONB columns (targets, totals)
      - Provides structured access to food calories, workout calories, macros
      - Enables history chart functionality

  2. Purpose
    - Fixes missing table error in HistoryCharts component
    - Provides clean interface for querying daily aggregated data
    - Maintains compatibility with existing frontend expectations
*/

CREATE OR REPLACE VIEW v_day_totals AS
SELECT
  d.id,
  d.user_id,
  d.date,
  d.targets, -- Keep targets as JSONB
  COALESCE((d.totals->>'food_cals')::int, 0) AS food_cals,
  COALESCE((d.totals->>'workout_cals')::int, 0) AS workout_cals,
  COALESCE((d.totals->>'protein')::int, 0) AS food_protein,
  COALESCE((d.totals->>'carbs')::int, 0) AS food_carbs,
  COALESCE((d.totals->>'fat')::int, 0) AS food_fat,
  COALESCE((d.totals->>'remaining')::int, 0) AS remaining,
  COALESCE((d.totals->>'allowance')::int, 0) AS allowance,
  d.created_at,
  d.updated_at
FROM
  days d;