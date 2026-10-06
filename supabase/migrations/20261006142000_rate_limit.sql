-- Limite de requisições das Edge Functions.
-- Estado em memória não funciona aqui: cada requisição pode cair num isolado diferente,
-- então a contagem mora no Postgres e é incrementada de forma atômica.

create table if not exists public.edge_rate_hits (
  caller text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (caller, window_start)
);

alter table public.edge_rate_hits enable row level security;

create or replace function public.rate_limit_hit(
  p_caller text,
  p_window_seconds integer,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into edge_rate_hits (caller, window_start, hits)
  values (p_caller, v_window_start, 1)
  on conflict (caller, window_start)
  do update set hits = edge_rate_hits.hits + 1
  returning hits into v_hits;

  delete from edge_rate_hits
  where window_start < now() - make_interval(secs => p_window_seconds * 3);

  return v_hits;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
