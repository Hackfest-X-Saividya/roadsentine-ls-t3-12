-- Apply in the Supabase SQL editor. All application data is protected by RLS.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (category in ('transport','electricity','fuel','waste')),
  subcategory text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  ev_charging_kwh numeric not null default 0
    check (ev_charging_kwh >= 0 and ev_charging_kwh <= quantity),
  activity_date date not null check (activity_date <= current_date),
  note text not null default '' check (char_length(note) <= 240),
  calculation jsonb not null,
  factor_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calculation_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  activity_id uuid references public.activity_records(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reduction_percentage numeric not null check (reduction_percentage between 1 and 90),
  duration_days integer not null check (duration_days between 7 and 365),
  baseline_kg_co2e numeric not null check (baseline_kg_co2e > 0),
  baseline_period_days integer not null default 30 check (baseline_period_days between 1 and 365),
  started_date date not null default current_date,
  target_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recommendation_key text not null,
  content jsonb not null,
  generated_at timestamptz not null default now()
);

create table if not exists public.action_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action_id text not null,
  title text not null,
  completed_date date not null default current_date,
  estimated_savings_kg_co2e numeric not null default 0 check (estimated_savings_kg_co2e >= 0),
  is_measured_reduction boolean not null default false check (is_measured_reduction = false),
  created_at timestamptz not null default now()
);

create table if not exists public.progress_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  baseline_kg_co2e numeric not null default 0 check (baseline_kg_co2e >= 0),
  current_kg_co2e numeric not null default 0 check (current_kg_co2e >= 0),
  observed_change_kg_co2e numeric not null default 0,
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  check (period_end >= period_start)
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','activity_records','calculation_results','targets',
    'recommendations','action_completions','progress_history'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    if table_name = 'profiles' then
      execute format(
        'create policy %I on public.%I for all to authenticated using (id = auth.uid()) with check (id = auth.uid())',
        table_name || '_user_scope', table_name
      );
    else
      execute format(
        'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
        table_name || '_user_scope', table_name
      );
    end if;
  end loop;
end $$;

create index if not exists activity_records_user_date_idx
  on public.activity_records (user_id, activity_date desc);
create index if not exists progress_history_user_date_idx
  on public.progress_history (user_id, period_end desc);
