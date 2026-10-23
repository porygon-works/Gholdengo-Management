-- v5：余裕額を中心にした家計簿（docs/superpowers/specs/2026-10-23-v5-yoyuugaku-design.md）
-- v5 だけが使う表は v5_ を付けて新しく作る（切り替えまで v4 の plans・plan_debts・plan_funds・months は触らない）
-- 何度実行しても壊れない

-- 計画（返済・購入・貯蓄）。返済の計画は積立額を持たない（借入残高がすでに支払予定額に入っているため）
create table if not exists ggmg.v5_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('repay','buy','save')),
  name text not null default '',
  target integer not null default 0 check (target >= 0),  -- 目標額（購入・貯蓄）
  due_date date,                                            -- 期日（貯蓄はなし）
  monthly integer not null default 0 check (monthly >= 0),  -- 毎月の積立額（購入・貯蓄）
  start_month text,                                         -- 毎月の積立額を始める月（YYYY-MM）
  draw_order integer not null default 0,                    -- 取崩順（小さいほど先に差し引く）
  no_draw boolean not null default false,                   -- 取崩不可
  done boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 借入（返す先ごと）。毎月の返済は保存せず、毎回ここから出す
create table if not exists ggmg.v5_loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid references ggmg.v5_plans(id) on delete set null,  -- まとめて返す返済の計画
  name text not null default '',
  card text,                                                -- カードの請求と一緒に返すなら、そのカード（settings.cards の id）
  monthly integer not null default 0 check (monthly >= 0),  -- 毎月の返済額
  pay_day integer,                                          -- カードでないときの返済日
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 借入残高の記録（カードのサイトで見た額）。前の記録から計算した額との差が「借入残高の修正」
create table if not exists ggmg.v5_loan_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  loan_id uuid not null references ggmg.v5_loans(id) on delete cascade,
  date date not null,
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 計画のお金の出し入れ（余裕額から入れる・賞与からの配分・取り崩し・ひも付けた購入）。毎月の積立額は保存せず計算する
create table if not exists ggmg.v5_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null references ggmg.v5_plans(id) on delete cascade,
  kind text not null check (kind in ('manual','bonus','draw','spend')),
  amount integer not null default 0 check (amount >= 0),    -- いつもプラス。draw・spend は積立額を減らす
  date date not null,
  bonus_entry_id uuid references ggmg.account_entries(id) on delete cascade,  -- 賞与からの配分：どの賞与か
  entry_kind text check (entry_kind in ('card','account')),                  -- ひも付けた購入：どの明細か
  entry_id uuid,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 月の予算（決めた額か、月の初めに保存した目安額）
create table if not exists ggmg.v5_months (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null,
  budget integer not null default 0,
  source text not null default 'decided' check (source in ('guide','decided')),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

create index if not exists v5_loan_balances_loan on ggmg.v5_loan_balances (loan_id);
create index if not exists v5_moves_plan on ggmg.v5_moves (plan_id);

-- 口座明細の大費目に「賞与」を足す
alter table ggmg.account_entries drop constraint if exists account_entries_group_check;
alter table ggmg.account_entries add constraint account_entries_group_check
  check ("group" in ('variable','fixed','tatekae','card','other','salary','extra','refund','bonus'));

do $$
declare t text;
begin
  foreach t in array array['v5_plans','v5_loans','v5_loan_balances','v5_moves','v5_months'] loop
    execute format('alter table ggmg.%I enable row level security', t);
    execute format('drop policy if exists own on ggmg.%I', t);
    execute format('create policy own on ggmg.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop trigger if exists %I on ggmg.%I', t || '_updated', t);
    execute format('create trigger %I before update on ggmg.%I for each row execute function ggmg.set_updated_at()', t || '_updated', t);
  end loop;
end $$;

grant all on all tables in schema ggmg to anon, authenticated, service_role;
