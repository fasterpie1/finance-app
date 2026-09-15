-- Execute este script no SQL Editor do Supabase.
create table if not exists public.user_finance_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  months jsonb not null default '[]'::jsonb,
  selected_month_id text,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_finance_data add column if not exists revision integer not null default 0;

alter table public.user_finance_data enable row level security;

drop policy if exists "Users can view own finance data" on public.user_finance_data;
create policy "Users can view own finance data"
  on public.user_finance_data for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own finance data" on public.user_finance_data;
create policy "Users can insert own finance data"
  on public.user_finance_data for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own finance data" on public.user_finance_data;
create policy "Users can update own finance data"
  on public.user_finance_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own finance data" on public.user_finance_data;
create policy "Users can delete own finance data"
  on public.user_finance_data for delete using (auth.uid() = user_id);

create table if not exists public.user_groq_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_key text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_groq_keys enable row level security;

create table if not exists public.user_calendar_integrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'google',
  provider_account_id text,
  provider_email text,
  encrypted_access_token text,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_calendar_integrations_provider_check check (provider = 'google')
);

alter table public.user_calendar_integrations enable row level security;

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.google_calendar_oauth_states enable row level security;
