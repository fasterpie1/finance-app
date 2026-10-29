create table if not exists public.user_pluggy_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  connector_name text not null,
  status text not null default 'UPDATED',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.user_pluggy_items enable row level security;

drop policy if exists "Users can view own Pluggy items" on public.user_pluggy_items;
create policy "Users can view own Pluggy items"
  on public.user_pluggy_items for select
  using (auth.uid() = user_id and lower(auth.jwt() ->> 'email') = 'pajp@hotmail.com');

create table if not exists public.user_pluggy_transactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_transaction_id text not null,
  item_id text not null,
  account_id text not null,
  account_name text not null,
  card_last4 text,
  bill_id text,
  bill_month text not null,
  statement_total_cents bigint,
  merchant text not null,
  amount_cents bigint not null check (amount_cents > 0),
  transaction_date date not null,
  transaction_type text not null check (transaction_type in ('PURCHASE', 'INSTALLMENT', 'REFUND', 'PAYMENT', 'FEE', 'OTHER')),
  installment_current integer not null default 1,
  installment_total integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'imported', 'duplicate', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider_transaction_id)
);

alter table public.user_pluggy_transactions enable row level security;

drop policy if exists "Users can view own pending Pluggy transactions" on public.user_pluggy_transactions;
create policy "Users can view own pending Pluggy transactions"
  on public.user_pluggy_transactions for select
  using (auth.uid() = user_id and lower(auth.jwt() ->> 'email') = 'pajp@hotmail.com');

create index if not exists user_pluggy_transactions_pending_idx
  on public.user_pluggy_transactions (user_id, status, transaction_date);
