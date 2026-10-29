drop policy if exists "Users can view own Pluggy items" on public.user_pluggy_items;
create policy "Test account can view own Pluggy items"
  on public.user_pluggy_items for select
  using (auth.uid() = user_id and lower(auth.jwt() ->> 'email') = 'pajp@hotmail.com');

drop policy if exists "Users can view own pending Pluggy transactions" on public.user_pluggy_transactions;
create policy "Test account can view own pending Pluggy transactions"
  on public.user_pluggy_transactions for select
  using (auth.uid() = user_id and lower(auth.jwt() ->> 'email') = 'pajp@hotmail.com');
