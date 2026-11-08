-- Atualização: fechamento do mês por funções no banco (com mensagem clara de permissão)
create or replace function public.exigir_admin() returns void
language plpgsql stable security definer set search_path = public as $$
declare e text;
begin
  if not public.is_admin() then
    select email into e from auth.users where id = auth.uid();
    raise exception 'Sem permissão de administrador (login recebido: %). Saia e entre de novo.', coalesce(e, 'nenhum, sessão expirada');
  end if;
end $$;

create or replace function public.fechar_mes(p_mes date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  insert into fechamentos(competencia, fechado_por)
  values (date_trunc('month', p_mes)::date, auth.uid()) on conflict (competencia) do nothing;
end $$;

create or replace function public.reabrir_mes(p_mes date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  delete from fechamentos where competencia = date_trunc('month', p_mes)::date;
end $$;

create or replace function public.meses_resumo()
returns table(mes text, notas bigint, sem_socio bigint, alertas bigint, fechado boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  return query
  select to_char(t.m, 'YYYY-MM'), count(*), count(*) filter (where t.soma <> 100),
         count(*) filter (where t.alerta), exists (select 1 from fechamentos f where f.competencia = t.m)
  from (select date_trunc('month', n.emissao)::date as m,
               coalesce((select sum(a.percentual) from atribuicoes a where a.nota_id = n.id), 0) as soma,
               (n.conferido is null and exists (select 1 from jsonb_array_elements(n.alertas) x where x->>0 <> 'info')) as alerta
        from notas n where not n.cancelada) t
  group by t.m order by 1 desc;
end $$;

revoke execute on function public.fechar_mes(date), public.reabrir_mes(date), public.meses_resumo(), public.exigir_admin() from anon, public;
grant execute on function public.fechar_mes(date), public.reabrir_mes(date), public.meses_resumo(), public.exigir_admin() to authenticated;
