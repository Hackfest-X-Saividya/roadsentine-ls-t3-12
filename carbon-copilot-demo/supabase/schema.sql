-- Run in the Supabase SQL editor for a new project.
-- Every user-owned table is protected by RLS. The application uses the anon
-- key plus the signed-in user's access token; never use a service-role key.

create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 80),
  location text not null default '' check (char_length(location) <= 100),
  budget text not null default 'any' check (budget in ('any', 'free', 'moderate')),
  transport text not null default 'any' check (transport in ('any', 'transit', 'limited')),
  preferences text not null default '' check (char_length(preferences) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_date date not null,
  activity_data jsonb not null,
  factor_values jsonb not null,
  calculation_result jsonb not null,
  transport_kg_co2e double precision not null check (transport_kg_co2e >= 0),
  electricity_kg_co2e double precision not null check (electricity_kg_co2e >= 0),
  fuel_kg_co2e double precision not null check (fuel_kg_co2e >= 0),
  waste_kg_co2e double precision not null check (waste_kg_co2e >= 0),
  food_kg_co2e double precision not null default 0 check (food_kg_co2e >= 0),
  total_kg_co2e double precision not null check (total_kg_co2e >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, activity_date)
);

alter table public.activity_records
  add column if not exists food_kg_co2e double precision not null default 0
  check (food_kg_co2e >= 0);

create table if not exists public.reduction_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reduction_percent double precision not null check (reduction_percent between 1 and 90),
  duration_days integer not null check (duration_days in (30, 60, 90)),
  baseline_daily_kg_co2e double precision not null check (baseline_daily_kg_co2e >= 0),
  target_daily_kg_co2e double precision not null check (target_daily_kg_co2e >= 0),
  baseline_days integer not null check (baseline_days between 1 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists one_active_target_per_user
  on public.reduction_targets (user_id) where active;

create table if not exists public.recommended_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recommendation_key text not null check (char_length(recommendation_key) between 1 and 64),
  recommendation_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, recommendation_key)
);

create table if not exists public.action_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recommended_action_id uuid not null references public.recommended_actions (id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, recommended_action_id),
  check ((completed and completed_at is not null) or (not completed and completed_at is null))
);

create table if not exists public.progress_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_record_id uuid not null references public.activity_records (id) on delete cascade,
  activity_date date not null,
  total_kg_co2e double precision not null check (total_kg_co2e >= 0),
  categories jsonb not null,
  calculation_result jsonb not null,
  recorded_at timestamptz not null default now(),
  unique (user_id, activity_date)
);

create index if not exists activity_records_user_date
  on public.activity_records (user_id, activity_date desc);
create index if not exists progress_history_user_date
  on public.progress_history (user_id, activity_date desc);
create index if not exists action_completions_user_date
  on public.action_completions (user_id, completed_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at
before update on public.user_profiles
for each row execute function public.touch_updated_at();

drop trigger if exists activity_records_touch_updated_at on public.activity_records;
create trigger activity_records_touch_updated_at
before update on public.activity_records
for each row execute function public.touch_updated_at();

create or replace function public.sync_activity_progress_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.progress_history (
    user_id, activity_record_id, activity_date, total_kg_co2e,
    categories, calculation_result, recorded_at
  )
  values (
    new.user_id, new.id, new.activity_date, new.total_kg_co2e,
    new.calculation_result -> 'categories', new.calculation_result, now()
  )
  on conflict (user_id, activity_date) do update set
    activity_record_id = excluded.activity_record_id,
    total_kg_co2e = excluded.total_kg_co2e,
    categories = excluded.categories,
    calculation_result = excluded.calculation_result,
    recorded_at = now();
  return new;
end;
$$;

drop trigger if exists activity_records_sync_progress on public.activity_records;
create trigger activity_records_sync_progress
after insert or update on public.activity_records
for each row execute function public.sync_activity_progress_history();

create or replace function public.set_action_completion_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.completed_at = case when new.completed then now() else null end;
  return new;
end;
$$;

drop trigger if exists action_completion_timestamp on public.action_completions;
create trigger action_completion_timestamp
before insert or update on public.action_completions
for each row execute function public.set_action_completion_time();

alter table public.user_profiles enable row level security;
alter table public.activity_records enable row level security;
alter table public.reduction_targets enable row level security;
alter table public.recommended_actions enable row level security;
alter table public.action_completions enable row level security;
alter table public.progress_history enable row level security;

drop policy if exists "Users manage their own profile" on public.user_profiles;
create policy "Users manage their own profile"
  on public.user_profiles for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own activity" on public.activity_records;
create policy "Users manage their own activity"
  on public.activity_records for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own targets" on public.reduction_targets;
create policy "Users manage their own targets"
  on public.reduction_targets for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own recommendations" on public.recommended_actions;
create policy "Users manage their own recommendations"
  on public.recommended_actions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own action completions" on public.action_completions;
create policy "Users manage their own action completions"
  on public.action_completions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users read their own progress" on public.progress_history;
create policy "Users read their own progress"
  on public.progress_history for select to authenticated
  using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.user_profiles to authenticated;
grant select, insert, update, delete on public.activity_records to authenticated;
grant select, insert, update, delete on public.reduction_targets to authenticated;
grant select, insert, update, delete on public.recommended_actions to authenticated;
grant select, insert, update, delete on public.action_completions to authenticated;
grant select on public.progress_history to authenticated;
