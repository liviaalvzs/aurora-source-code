-- aurora: um registro por usuário com todos os hábitos, lembretes e marcações (JSON).
-- Rodar uma vez no SQL Editor do Supabase.
create table if not exists public.aurora_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.aurora_state enable row level security;

create policy "dono lê" on public.aurora_state for select to authenticated using (auth.uid() = user_id);
create policy "dono cria" on public.aurora_state for insert to authenticated with check (auth.uid() = user_id);
create policy "dono altera" on public.aurora_state for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.aurora_state to authenticated;
