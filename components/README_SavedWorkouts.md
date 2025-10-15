
    # Saved Workouts Add-on (Oct 14c)

    ## New files
    - `services/savedWorkoutsService.ts`
    - `components/SavedWorkouts.tsx`

    ## Minimal wiring (App.tsx)
    1) Import the page: `import SavedWorkouts from "./components/SavedWorkouts"`
    2) Add a nav button (or route) to reach it.
    3) Render `<SavedWorkouts />` when route === 'saved'.

    ## From WeeklyWorkoutPlan.tsx (optional)
    Import `saveWorkoutPlan` and add a "Save" button next to each generated plan/day.

    ## SQL (Supabase)
    Run this in your Supabase SQL editor:

    ```sql

-- SQL: saved_workouts table and RLS
create table if not exists public.saved_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.saved_workouts enable row level security;

-- RLS policies
create policy "rw-own-saved-workouts" on public.saved_workouts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Optional: enforce max 10 via trigger (client also enforces)
create or replace function public.enforce_max_10_saved_workouts()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.saved_workouts where user_id = new.user_id) >= 10 then
    raise exception 'Limit reached (10). Remove one before saving another.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_max_10 on public.saved_workouts;
create trigger trg_enforce_max_10
before insert on public.saved_workouts
for each row execute function public.enforce_max_10_saved_workouts();

    ```

    ## Notes
    - Client enforces limit of 10; SQL trigger enforces on server.
    - `addSavedToToday()` inserts rows into `workout_entries` using today's Chicago date.
    - After adding to today, we emit `eventBus.emit("day:totals")` to refresh the meters.
