-- =====================================================================
-- Repasse de Notas – banco de dados (Supabase / Postgres)
-- Rodar uma vez em: Supabase → SQL Editor → New query → colar → Run
-- =====================================================================

-- ---------- Usuários e papéis ----------------------------------------
create table if not exists public.socios (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  crm         text,
  email       text unique,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- Liga cada login (auth.users) a um papel. Sem linha aqui, o usuário não vê nada.
create table if not exists public.usuarios (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  papel     text not null check (papel in ('admin','socio')),
  socio_id  uuid references public.socios(id),
  check (papel = 'admin' or socio_id is not null)
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where user_id = auth.uid() and papel = 'admin');
$$;

create or replace function public.meu_socio_id() returns uuid
language sql stable security definer set search_path = public as $$
  select socio_id from usuarios where user_id = auth.uid();
$$;

-- Vincula automaticamente o login ao sócio quando o e-mail confere.
create or replace function public.vincular_login() returns trigger
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  select id into s from socios where lower(email) = lower(new.email) and ativo;
  if s is not null then
    insert into usuarios(user_id, papel, socio_id) values (new.id, 'socio', s)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_vincular_login on auth.users;
create trigger trg_vincular_login after insert on auth.users
  for each row execute function public.vincular_login();

-- Vincula logins que já existiam antes do cadastro do sócio (chamado pelo app).
create or replace function public.vincular_existentes() returns integer
language plpgsql security definer set search_path = public as $$
declare k integer;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  insert into usuarios(user_id, papel, socio_id)
  select u.id, 'socio', s.id from auth.users u join socios s on lower(s.email) = lower(u.email) and s.ativo
  where not exists (select 1 from usuarios x where x.user_id = u.id);
  get diagnostics k = row_count;
  return k;
end $$;

-- ---------- Parâmetros fiscais (com vigência) -------------------------
create table if not exists public.parametros (
  id            serial primary key,
  vigencia_ini  date not null,
  vigencia_fim  date,
  pis           numeric(7,5) not null default 0.0065,
  cofins        numeric(7,5) not null default 0.03,
  presuncao_ir  numeric(7,5) not null default 0.08,
  aliquota_ir   numeric(7,5) not null default 0.15,
  adicional_ir  numeric(7,5) not null default 0.10,
  limite_adicional_mes numeric(14,2) not null default 20000,
  presuncao_cs  numeric(7,5) not null default 0.12,
  aliquota_cs   numeric(7,5) not null default 0.09,
  aliquota_iss  numeric(7,5) not null default 0.05,
  repasse       numeric(7,5) not null default 0.85
);
insert into public.parametros (vigencia_ini) select '2026-01-01'
  where not exists (select 1 from public.parametros);

-- ---------- Notas fiscais -------------------------------------------
create table if not exists public.notas (
  id              uuid primary key default gen_random_uuid(),
  cnpj_prestador  text not null,
  numero          integer not null,
  emissao         date not null,
  competencia     date not null,
  tomador_tipo    text not null check (tomador_tipo in ('PF','PJ')),
  tomador_doc     text,
  tomador_nome    text,
  categoria       text,
  discriminacao   text,
  valor_servicos  numeric(14,2) not null,
  desconto        numeric(14,2) not null default 0,
  base_calculo    numeric(14,2) not null,
  aliquota_iss    numeric(5,2)  not null,
  valor_iss       numeric(14,2) not null,
  iss_retido      boolean not null default false,
  pis_informado   numeric(14,2) not null default 0,
  cofins_informado numeric(14,2) not null default 0,
  ir_informado    numeric(14,2) not null default 0,
  csll_informado  numeric(14,2) not null default 0,
  liquido         numeric(14,2) not null,
  ibs             numeric(14,2) not null default 0,
  cbs             numeric(14,2) not null default 0,
  -- retenções consideradas depois da conferência (regras do app)
  pis_ret         numeric(14,2) not null default 0,
  cofins_ret      numeric(14,2) not null default 0,
  ir_ret          numeric(14,2) not null default 0,
  csll_ret        numeric(14,2) not null default 0,
  iss_ret         numeric(14,2) not null default 0,
  alertas         jsonb not null default '[]',
  conferido       text,
  cancelada       boolean not null default false,
  xml             text,
  importado_em    timestamptz not null default now(),
  importado_por   uuid default auth.uid(),
  unique (cnpj_prestador, numero)
);
create index if not exists notas_emissao_idx on public.notas (emissao);

-- ---------- Atribuição nota → sócio ----------------------------------
create table if not exists public.atribuicoes (
  nota_id      uuid not null references public.notas(id) on delete cascade,
  socio_id     uuid not null references public.socios(id),
  percentual   numeric(5,2) not null check (percentual > 0 and percentual <= 100),
  alterado_por uuid default auth.uid(),
  alterado_em  timestamptz not null default now(),
  primary key (nota_id, socio_id)
);

-- ---------- Fechamento mensal ----------------------------------------
create table if not exists public.fechamentos (
  competencia  date primary key,             -- 1º dia do mês
  fechado_por  uuid default auth.uid(),
  fechado_em   timestamptz not null default now()
);

create or replace function public.mes_fechado(d date) returns boolean
language sql stable as $$
  select exists (select 1 from public.fechamentos where competencia = date_trunc('month', d)::date);
$$;

create or replace function public.bloquear_fechado() returns trigger
language plpgsql as $$
declare d date;
begin
  if tg_table_name = 'notas' then
    d := coalesce(new.emissao, old.emissao);
    if tg_op = 'UPDATE' and old.emissao is distinct from new.emissao and public.mes_fechado(old.emissao) then
      raise exception 'Mês % está fechado', to_char(old.emissao,'MM/YYYY');
    end if;
  else
    select emissao into d from public.notas where id = coalesce(new.nota_id, old.nota_id);
  end if;
  if public.mes_fechado(d) then
    raise exception 'Mês % está fechado. Reabra o mês para alterar.', to_char(d,'MM/YYYY');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_bloq_notas on public.notas;
create trigger trg_bloq_notas before insert or update or delete on public.notas
  for each row execute function public.bloquear_fechado();
drop trigger if exists trg_bloq_atrib on public.atribuicoes;
create trigger trg_bloq_atrib before insert or update or delete on public.atribuicoes
  for each row execute function public.bloquear_fechado();

-- ---------- Auditoria ------------------------------------------------
create table if not exists public.auditoria (
  id        bigserial primary key,
  em        timestamptz not null default now(),
  usuario   uuid default auth.uid(),
  tabela    text not null,
  operacao  text not null,
  antes     jsonb,
  depois    jsonb
);
create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into auditoria(tabela, operacao, antes, depois)
  values (tg_table_name, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'xml' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'xml' end);
  return coalesce(new, old);
end $$;
drop trigger if exists trg_aud_atrib on public.atribuicoes;
create trigger trg_aud_atrib after insert or update or delete on public.atribuicoes
  for each row execute function public.auditar();
drop trigger if exists trg_aud_notas on public.notas;
create trigger trg_aud_notas after update or delete on public.notas
  for each row execute function public.auditar();
drop trigger if exists trg_aud_fech on public.fechamentos;
create trigger trg_aud_fech after insert or delete on public.fechamentos
  for each row execute function public.auditar();

-- ---------- Permissões (Row Level Security) --------------------------
alter table public.socios      enable row level security;
alter table public.usuarios    enable row level security;
alter table public.parametros  enable row level security;
alter table public.notas       enable row level security;
alter table public.atribuicoes enable row level security;
alter table public.fechamentos enable row level security;
alter table public.auditoria   enable row level security;

-- admin: tudo
do $$ declare t text; begin
  foreach t in array array['socios','usuarios','parametros','notas','atribuicoes','fechamentos'] loop
    execute format('drop policy if exists admin_tudo on public.%I', t);
    execute format('create policy admin_tudo on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;
drop policy if exists admin_le on public.auditoria;
create policy admin_le on public.auditoria for select to authenticated using (public.is_admin());

-- sócio: só o que é dele
drop policy if exists socio_proprio on public.socios;
create policy socio_proprio on public.socios for select to authenticated using (id = public.meu_socio_id());
drop policy if exists usuario_proprio on public.usuarios;
create policy usuario_proprio on public.usuarios for select to authenticated using (user_id = auth.uid());
drop policy if exists socio_atrib on public.atribuicoes;
create policy socio_atrib on public.atribuicoes for select to authenticated using (socio_id = public.meu_socio_id());
drop policy if exists socio_notas on public.notas;
create policy socio_notas on public.notas for select to authenticated using (
  exists (select 1 from public.atribuicoes a where a.nota_id = notas.id and a.socio_id = public.meu_socio_id()));
drop policy if exists todos_leem on public.parametros;
create policy todos_leem on public.parametros for select to authenticated using (true);
drop policy if exists todos_leem on public.fechamentos;
create policy todos_leem on public.fechamentos for select to authenticated using (true);

-- =====================================================================
-- DEPOIS do seu primeiro login no app, rode (troque o e-mail):
--   insert into public.usuarios (user_id, papel)
--   select id, 'admin' from auth.users where email = 'seu-email@exemplo.com';
-- =====================================================================
