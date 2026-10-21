-- v3：入出金を「口座明細」と「クレカ明細」に分け、目標マスタを足す（docs/SPEC.md §3）
-- 前の版の表（entries・card_bills・debts）は消さない。アプリを開いたときに、新しい表へ写す（何度写しても二重にならない）
-- 何度実行しても壊れない

-- 口座明細：口座と財布のお金の動き
create table if not exists ggmg.account_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account text not null default 'bank' check (account in ('bank','wallet')),
  direction text not null check (direction in ('in','out')),
  status text not null check (status in ('plan','confirmed')),
  "group" text not null check ("group" in ('variable','fixed','tatekae','card','other','salary','extra','refund')),
  category text,
  name text not null default '',
  memo text not null default '',
  date date not null,
  amount integer not null check (amount >= 0),
  source text not null default 'manual' check (source in ('manual','recurring','card_bill','goal','migration')),
  source_ref text,
  recurring_id uuid,
  goal_id uuid,
  card text,
  pair_id uuid,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_ref)
);
create index if not exists account_entries_user_date on ggmg.account_entries (user_id, date);

-- クレカ明細：カードで使ったもの（口座はすぐには減らない）
create table if not exists ggmg.card_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card text not null default 'smbc',
  status text not null check (status in ('plan','confirmed')),
  date date not null,
  amount integer not null check (amount >= 0),
  "group" text not null default 'variable' check ("group" in ('variable','fixed','tatekae','installment','purchase')),
  category text,
  name text not null default '',
  shop text not null default '',
  memo text not null default '',
  tatekae integer not null default 0,
  source text not null default 'manual' check (source in ('manual','card_flash','card_statement','recurring','goal','migration')),
  source_ref text,
  merged_into uuid references ggmg.card_entries(id) on delete set null,
  not_dup uuid[] not null default '{}',
  locked boolean not null default false,
  recurring_id uuid,
  goal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_ref)
);
create index if not exists card_entries_user_date on ggmg.card_entries (user_id, date);

-- 目標マスタ：返済（リボ・分割を0にする）と積立
create table if not exists ggmg.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('repay','save')),
  name text not null,
  card text,
  balance integer not null default 0,
  as_of date,
  target integer not null default 0,
  monthly integer not null default 0,
  day integer not null default 27,
  start_month text,
  end_month text,
  lumps jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort integer not null default 0,
  source_ref text,
  created_at timestamptz not null default now(),
  unique (user_id, source_ref)
);

-- 定期マスタ：大費目と、どこから払うか（口座・財布・クレカ）
alter table ggmg.recurring add column if not exists "group" text;
alter table ggmg.recurring add column if not exists pay text not null default 'bank';

drop trigger if exists account_entries_updated on ggmg.account_entries;
create trigger account_entries_updated before update on ggmg.account_entries for each row execute function ggmg.set_updated_at();
drop trigger if exists card_entries_updated on ggmg.card_entries;
create trigger card_entries_updated before update on ggmg.card_entries for each row execute function ggmg.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['account_entries','card_entries','goals'] loop
    execute format('alter table ggmg.%I enable row level security', t);
    execute format('drop policy if exists own on ggmg.%I', t);
    execute format('create policy own on ggmg.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

grant all on all tables in schema ggmg to anon, authenticated, service_role;
