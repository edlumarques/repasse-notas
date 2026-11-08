# Repasse de Notas

App web para importar as NFS-e da sociedade, conferir os impostos, atribuir cada nota a um ou mais sócios, calcular o repasse de 85% e gerar relatórios em PDF. Cada sócio entra com o próprio e-mail e vê só a própria produção.

- **Banco e login:** Supabase (Postgres + login por link no e-mail). As permissões ficam no banco: um sócio não consegue ler as notas de outro, mesmo mexendo no navegador.
- **Site:** arquivos estáticos (HTML, CSS e JS), hospedados no GitHub Pages.
- **Notas:** XML ABRASF 2.03, soltos ou em .zip. A leitura acontece no navegador.

## Instalação (uma vez, cerca de 20 minutos)

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com), região **South America (São Paulo)**.
2. Abra **SQL Editor → New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Authentication → Providers → Email**, deixe ativado e **desligue "Allow new users to sign up"**. Assim só entra quem for convidado.
4. Em **Authentication → URL Configuration**, coloque o endereço do site (passo 3) em **Site URL** e em **Redirect URLs**.
5. Copie a **Project URL** (botão **Connect** no topo, ou Project Settings → Data API) e a **Publishable key**, que começa com `sb_publishable_` (Project Settings → API Keys). Em projetos antigos, a chave equivalente é a **anon public**, na aba *Legacy API Keys*.

### 2. Configuração
Edite `js/config.js` e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (cole ali a publishable key). **Nunca** use a *Secret key* (`sb_secret_`) ou a `service_role` no site.

### 3. GitHub Pages
1. Suba esta pasta para um repositório no GitHub.
2. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. O site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

### 4. Seu acesso de administrador
1. Em **Authentication → Users → Invite user**, convide o seu e-mail e abra o link recebido.
2. No **SQL Editor**, rode (trocando o e-mail):
   ```sql
   insert into public.usuarios (user_id, papel)
   select id, 'admin' from auth.users where email = 'seu-email@exemplo.com';
   ```
3. Recarregue o site. Você entra como administração.

### 5. Acesso dos sócios
1. No app, aba **Sócios e acessos**: cadastre nome, CRM e e-mail de cada sócio.
2. No Supabase, **Authentication → Users → Invite user** com o mesmo e-mail.
3. O sócio abre o link e já entra em **Minha produção**. O vínculo é automático pelo e-mail.

Para mais alguém da administração, convide o e-mail e rode o mesmo SQL do passo 4.

## Uso mensal
1. Baixe as notas do mês em XML (.zip) e clique em **Carregar .zip ou XML**. Reimportar a mesma nota só atualiza os dados dela.
2. Em **Notas e atribuição**, marque o sócio de cada nota. Com dois sócios, o app divide meio a meio e você ajusta os percentuais.
3. Resolva ou marque como conferido o que aparecer em **Alertas**.
4. Confira **Apuração** e **Repasse**, gere os PDFs em **Relatórios**.
5. Em **Fechamento**, feche o mês. Ele fica travado e os sócios veem os valores como definitivos. Para corrigir algo, reabra o mês.

## Regras de cálculo
| Item | Regra |
| --- | --- |
| PIS / COFINS | 0,65% / 3% do faturamento |
| IRPJ | 15% sobre 8% do faturamento; adicional de 10% sobre a base acima de R$ 20 mil/mês |
| CSLL | 9% sobre 12% do faturamento |
| ISS | 5%, conforme a nota |
| Retenções | abatidas do devido; IRRF acima do IRPJ vira saldo a compensar |
| CSLL retida informada em 4,65% | considerada 1% (o restante é PIS e COFINS) |
| Repasse | 85% do valor de cada nota (já sem desconto); 15% fica na sociedade |
| IBS / CBS 2026 | informativos (alíquotas de teste) |

As alíquotas ficam na tabela `parametros` do banco e podem ser alteradas sem mexer no código. Os valores servem para conferência; a apuração oficial continua com o contador.

## Segurança e LGPD
- As notas trazem nome e CPF de pacientes (dado de saúde). Elas ficam no seu projeto Supabase, em São Paulo, e só a administração e o sócio da nota conseguem lê-las.
- Toda alteração de atribuição, nota e fechamento fica registrada na tabela `auditoria`.
- Ative a autenticação em dois fatores na sua conta do Supabase e do GitHub.

## Testes
`node tests/calc.test.js caminho/da/amostra.json` (a amostra de notas não fica no repositório) confere o motor de cálculo com as notas de outubro/2026.
