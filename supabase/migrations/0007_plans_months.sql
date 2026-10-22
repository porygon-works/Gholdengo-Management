-- v4：計画（返済・買い物・貯蓄）と、月ごとに決める予算（docs/SPEC.md）
-- 計画の支払いと「まとめて払う」は口座明細（account_entries）の予定の行として持ち、plan_id で計画とつなぐ
-- 確保額に入れる分（予算から・賞与から・予備から）は口座のお金が動かないので plan_funds に持つ
-- 前の版の目標マスタ（goals）は消さない（アプリはもう使わない）
-- 何度実行しても壊れない

-- 計画
create table if not exists ggmg.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('repay','buy','save')),
  name text not null default '',
  use_date date,                       -- まとめて払う日・使う日（貯蓄はなし）
  target integer not null default 0,   -- 買い物の金額・貯蓄の目標額（返済は残高から計算）
  done boolean not null default false, -- 終わった計画（一覧の下に回す）
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 返済の計画の残高（カードのサイトで見た額）
create table if not exists ggmg.plan_debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null references ggmg.plans(id) on delete cascade,
  name text not null default '',
  balance integer not null default 0,
  as_of date not null default current_date,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 確保額に入れる分
create table if not exists ggmg.plan_funds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null references ggmg.plans(id) on delete cascade,
  source text not null check (source in ('budget','bonus','spare')),
  name text not null default '',
  date date not null,                  -- 確保額に入る日（予算からは、その月のカードが引き落とされる日）
  budget_month text,                   -- 予算から入れるときの、予算を減らす月（YYYY-MM）
  amount integer not null default 0 check (amount >= 0),
  status text not null default 'plan' check (status in ('plan','confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 月ごとに決める予算（空なら、給与 − 固定費 − 計画の分 をそのまま使う）
create table if not exists ggmg.months (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null,
  budget integer,
  memo text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

-- 口座明細と計画のつながり
alter table ggmg.account_entries add column if not exists plan_id uuid references ggmg.plans(id) on delete set null;
alter table ggmg.account_entries add column if not exists debt_id uuid references ggmg.plan_debts(id) on delete set null;
alter table ggmg.account_entries add column if not exists plan_role text check (plan_role in ('pay','lump'));
alter table ggmg.account_entries add column if not exists budget_month text;
alter table ggmg.account_entries drop constraint if exists account_entries_source_check;
alter table ggmg.account_entries add constraint account_entries_source_check
  check (source in ('manual','recurring','card_bill','goal','plan','migration'));
create index if not exists account_entries_plan on ggmg.account_entries (plan_id);

do $$
declare t text;
begin
  foreach t in array array['plans','plan_debts','plan_funds','months'] loop
    execute format('alter table ggmg.%I enable row level security', t);
    execute format('drop policy if exists own on ggmg.%I', t);
    execute format('create policy own on ggmg.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop trigger if exists %I on ggmg.%I', t || '_updated', t);
    execute format('create trigger %I before update on ggmg.%I for each row execute function ggmg.set_updated_at()', t || '_updated', t);
  end loop;
end $$;

grant all on all tables in schema ggmg to anon, authenticated, service_role;
