# Ligar o modo tempo real (Supabase)

Por padrão o sistema roda 100% local, no navegador. Este guia liga o **modo nuvem**:
uma base compartilhada entre os operadores, em tempo real, atrás de login.

Você faz isto **uma vez**. Leva ~10 minutos. Não precisa saber programar — é copiar,
colar e clicar.

---

## 1. Criar o projeto no Supabase

1. Entre em **[supabase.com](https://supabase.com)** e crie uma conta (gratuita).
2. **New project**. Dê um nome (ex.: `pacotes-tiktok`), escolha uma senha de banco
   (guarde-a) e a região mais próxima (**South America (São Paulo)**).
3. Espere ~2 minutos até o projeto ficar pronto.

## 2. Criar as tabelas

No menu lateral, abra **SQL Editor → New query**, cole todo o bloco abaixo e clique em **Run**:

```sql
-- Tabelas (uma por store do sistema; o objeto vai em `payload` como jsonb)
create table if not exists public.events (
  id text primary key, pkg_id text, ts bigint,
  payload jsonb not null, inserted_at timestamptz default now()
);
create index if not exists events_pkg_id_idx on public.events (pkg_id);

create table if not exists public.treatments (
  pkg_id text primary key, payload jsonb not null, updated_at timestamptz default now()
);
create table if not exists public.enrichment (
  pkg_id text primary key, payload jsonb not null
);
create table if not exists public.contacts (
  driver text primary key, payload jsonb not null, updated_at timestamptz default now()
);
create table if not exists public.meta (
  key text primary key, value jsonb
);

-- Segurança: só quem está logado lê ou escreve (a chave pública sozinha não abre nada)
alter table public.events     enable row level security;
alter table public.treatments enable row level security;
alter table public.enrichment enable row level security;
alter table public.contacts   enable row level security;
alter table public.meta       enable row level security;

create policy "operadores" on public.events     for all to authenticated using (true) with check (true);
create policy "operadores" on public.treatments for all to authenticated using (true) with check (true);
create policy "operadores" on public.enrichment for all to authenticated using (true) with check (true);
create policy "operadores" on public.contacts   for all to authenticated using (true) with check (true);
create policy "operadores" on public.meta       for all to authenticated using (true) with check (true);

-- Tempo real: avisa todos os operadores quando algo muda
alter publication supabase_realtime add table
  public.events, public.treatments, public.enrichment, public.contacts, public.meta;
```

Deve aparecer "Success. No rows returned".

## 3. Criar o login (usuário + senha, sem e-mail de verdade)

O login do sistema é por **usuário e senha** — ninguém precisa de e-mail real nem de
confirmar nada. Por baixo, o sistema completa o usuário com um domínio interno
(`base` vira `base@pacotes.local`), então no Supabase você cria a conta usando esse formato.

1. Menu lateral → **Authentication → Providers → Email**: deixe **habilitado**, **desligue**
   *Allow new users to sign up* e **desligue** *Confirm email* (assim a conta funciona na hora,
   sem e-mail de confirmação).
2. **Authentication → Users → Add user → Create new user**:
   - **Email**: `base@pacotes.local` (o usuário será `base` — a parte antes do `@`)
   - **Password**: a senha que a equipe vai usar
   - marque **Auto Confirm User** → **Create user**

   Isso cria **um login compartilhado** para a base inteira. Se quiser logins separados por
   pessoa, repita criando `joao@pacotes.local`, `maria@pacotes.local`, etc. — cada um entra
   digitando só o nome antes do `@` e a senha.

> O domínio `pacotes.local` é interno e configurável em `src/supabase-config.js`
> (campo `dominioLogin`). O operador nunca vê nem digita isso — só o usuário e a senha.

## 4. Pegar as credenciais e ligar o modo nuvem

1. Menu lateral → **Project Settings → API**. Copie:
   - **Project URL** (ex.: `https://abcdxyz.supabase.co`)
   - **anon public** key (começa com `eyJ...`)
2. Abra o arquivo **`src/supabase-config.js`** e cole nos dois campos:
   ```js
   export const SUPABASE = {
     url: "https://abcdxyz.supabase.co",
     anonKey: "eyJhbGciOi...",
   };
   ```
3. Publique a mudança:
   ```bash
   git add -A && git commit -m "Liga o modo tempo real (Supabase)" && git push
   ```

Pronto. Ao abrir o site, ele agora pede login e a base é compartilhada em tempo real.

---

## O que muda

- **Login**: cada operador entra com o **usuário e senha** que você criou no passo 3
  (o usuário é a parte antes do `@` — ex.: `base`).
- **Tempo real**: quando alguém importa uma planilha, marca um ticket ou trata um pacote,
  a tela dos outros atualiza sozinha em segundos.
- **A base local antiga não vem junto**: a primeira vez que abrir no modo nuvem, importe a
  planilha uma vez para popular a base compartilhada. A partir daí é só um lugar para todos.
- **Se a nuvem cair**: o sistema avisa e volta a usar a base local daquela máquina, sem travar
  o operador.

## É seguro deixar a chave no código público?

Sim. A `anon key` só funciona junto com um login válido — as regras de linha (RLS) do passo 2
barram qualquer leitura ou escrita de quem não está autenticado. Sem uma conta que você criou,
a chave sozinha não abre nada.

## Voltar para o modo local

Esvazie os dois campos em `src/supabase-config.js`, faça commit e push. O sistema volta a
rodar 100% no navegador, como antes.
