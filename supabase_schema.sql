-- Execute este script no SQL Editor do Supabase.
create table if not exists public.user_finance_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  months jsonb not null default '[]'::jsonb,
  selected_month_id text,
  updated_at timestamptz not null default now()
);

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
