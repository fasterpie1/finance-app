-- Validação do payload `months` no banco.
--
-- O app escreve essa lista direto pela API REST, então hoje qualquer cliente autenticado
-- guarda o que quiser na própria linha: um bug de versão antiga, um script ou uma sessão
-- sequestrada podem gravar uma lista sem `id`, sem `bills` ou com valores fora da realidade,
-- e o dashboard quebra na próxima leitura. As regras abaixo aceitam exatamente o formato que
-- o app produz e rejeitam o resto.
--
-- Limites tirados do conteúdo real da tabela (48 meses, 148 contas, 73 faturas, 580
-- lançamentos): no máximo 13 meses por linha, 104 kB, 30 contas por mês, 17 faturas por
-- mês, 68 lançamentos por fatura. Os tetos aqui ficam uma ordem de grandeza acima.

-- Devolve a primeira irregularidade encontrada, ou null quando o payload é aceitável.
-- Função pura: dá para testar com SELECT, sem escrever em lugar nenhum.
create or replace function public.finance_months_problem(p_months jsonb)
returns text
language plpgsql
stable
as $$
declare
  v_month jsonb;
  v_bill jsonb;
  v_invoice jsonb;
  v_tx jsonb;
begin
  if p_months is null or jsonb_typeof(p_months) <> 'array' then
    return 'months precisa ser uma lista de meses';
  end if;
  if jsonb_array_length(p_months) < 1 or jsonb_array_length(p_months) > 240 then
    return 'quantidade de meses fora do aceito (1 a 240)';
  end if;
  if octet_length(p_months::text) > 2000000 then
    return 'lista de meses maior que o aceito (2 MB)';
  end if;

  for v_month in select jsonb_array_elements(p_months) loop
    if jsonb_typeof(v_month) <> 'object' then
      return 'mes precisa ser um objeto';
    end if;
    if coalesce(jsonb_typeof(v_month -> 'id'), '') <> 'string'
      or char_length(v_month ->> 'id') not between 1 and 80 then
      return 'mes sem id valido';
    end if;
    if coalesce(jsonb_typeof(v_month -> 'name'), '') <> 'string' or char_length(v_month ->> 'name') > 60 then
      return 'mes sem nome valido';
    end if;
    if coalesce(jsonb_typeof(v_month -> 'year'), '') <> 'number' then
      return 'mes sem ano';
    end if;
    if (v_month ->> 'year')::numeric not between 1970 and 2200 then
      return 'ano do mes fora do aceito';
    end if;
    if coalesce(jsonb_typeof(v_month -> 'income'), '') <> 'number'
      or abs((v_month ->> 'income')::numeric) > 100000000000 then
      return 'renda do mes fora do aceito';
    end if;
    if coalesce(jsonb_typeof(v_month -> 'bills'), '') <> 'array' then
      return 'mes sem lista de contas';
    end if;
    if jsonb_array_length(v_month -> 'bills') > 2000 then
      return 'conta demais em um mes';
    end if;
    if v_month ? 'creditCardDueDay' then
      if jsonb_typeof(v_month -> 'creditCardDueDay') <> 'number' then
        return 'dia de vencimento do cartao invalido';
      end if;
      if (v_month ->> 'creditCardDueDay')::numeric not between 1 and 31 then
        return 'dia de vencimento do cartao fora do mes';
      end if;
    end if;
    if v_month ? 'creditCardInvoices' and jsonb_typeof(v_month -> 'creditCardInvoices') <> 'array' then
      return 'faturas do cartao precisam ser uma lista';
    end if;
    if v_month ? 'creditCardInvoices' and jsonb_array_length(v_month -> 'creditCardInvoices') > 240 then
      return 'fatura demais em um mes';
    end if;

    for v_bill in select jsonb_array_elements(v_month -> 'bills') loop
      if jsonb_typeof(v_bill) <> 'object' then
        return 'conta precisa ser um objeto';
      end if;
      if coalesce(jsonb_typeof(v_bill -> 'id'), '') <> 'string'
        or char_length(v_bill ->> 'id') not between 1 and 80 then
        return 'conta sem id valido';
      end if;
      if coalesce(jsonb_typeof(v_bill -> 'amount'), '') <> 'number'
        or abs((v_bill ->> 'amount')::numeric) > 10000000000 then
        return 'valor da conta fora do aceito';
      end if;
      if coalesce(jsonb_typeof(v_bill -> 'dueDay'), '') <> 'number'
        or (v_bill ->> 'dueDay')::numeric not between 1 and 31 then
        return 'dia de vencimento da conta fora do mes';
      end if;
      if coalesce(jsonb_typeof(v_bill -> 'isPaid'), '') <> 'boolean' then
        return 'conta sem pago/nao pago';
      end if;
      if coalesce(jsonb_typeof(v_bill -> 'category'), '') <> 'string'
        or char_length(v_bill ->> 'category') > 40 then
        return 'categoria da conta invalida';
      end if;
      if coalesce(jsonb_typeof(v_bill -> 'name'), '') <> 'string' or char_length(v_bill ->> 'name') > 200 then
        return 'nome da conta invalido';
      end if;
    end loop;

    if v_month ? 'creditCardInvoices' then
      for v_invoice in select jsonb_array_elements(v_month -> 'creditCardInvoices') loop
        if jsonb_typeof(v_invoice) <> 'object' then
          return 'fatura precisa ser um objeto';
        end if;
        if coalesce(jsonb_typeof(v_invoice -> 'id'), '') <> 'string'
          or char_length(v_invoice ->> 'id') not between 1 and 80 then
          return 'fatura sem id valido';
        end if;
        if coalesce(jsonb_typeof(v_invoice -> 'transactions'), '') <> 'array' then
          return 'fatura sem lista de lancamentos';
        end if;
        if jsonb_array_length(v_invoice -> 'transactions') > 5000 then
          return 'lancamento demais em uma fatura';
        end if;
        if v_invoice ? 'statementTotalCents'
          and (jsonb_typeof(v_invoice -> 'statementTotalCents') <> 'number'
            or abs((v_invoice ->> 'statementTotalCents')::numeric) > 1000000000000) then
          return 'total da fatura fora do aceito';
        end if;

        for v_tx in select jsonb_array_elements(v_invoice -> 'transactions') loop
          if jsonb_typeof(v_tx) <> 'object' then
            return 'lancamento precisa ser um objeto';
          end if;
          if coalesce(jsonb_typeof(v_tx -> 'id'), '') <> 'string'
            or char_length(v_tx ->> 'id') not between 1 and 80 then
            return 'lancamento sem id valido';
          end if;
          if coalesce(jsonb_typeof(v_tx -> 'amountCents'), '') <> 'number'
            or abs((v_tx ->> 'amountCents')::numeric) > 100000000000 then
            return 'valor do lancamento fora do aceito';
          end if;
          if coalesce(jsonb_typeof(v_tx -> 'merchant'), '') <> 'string'
            or char_length(v_tx ->> 'merchant') > 200 then
            return 'estabelecimento do lancamento invalido';
          end if;
          if v_tx ? 'installmentCurrent'
            and (jsonb_typeof(v_tx -> 'installmentCurrent') <> 'number'
              or (v_tx ->> 'installmentCurrent')::numeric not between 0 and 600) then
            return 'parcela do lancamento fora do aceito';
          end if;
          if v_tx ? 'installmentTotal'
            and (jsonb_typeof(v_tx -> 'installmentTotal') <> 'number'
              or (v_tx ->> 'installmentTotal')::numeric not between 0 and 600) then
            return 'total de parcelas fora do aceito';
          end if;
        end loop;
      end loop;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.validate_finance_months()
returns trigger
language plpgsql
as $$
declare
  v_problem text;
begin
  v_problem := public.finance_months_problem(NEW.months);
  if v_problem is not null then
    raise exception 'user_finance_data.months rejeitado: %', v_problem;
  end if;
  return NEW;
end;
$$;

drop trigger if exists user_finance_data_validate_months on public.user_finance_data;
create trigger user_finance_data_validate_months
  before insert or update of months on public.user_finance_data
  for each row execute function public.validate_finance_months();
