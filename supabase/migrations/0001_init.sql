-- Gholdengo 家計簿のテーブル定義
-- Supabase の SQL Editor にこのファイルの中身を貼って実行する（何度実行しても壊れない）。
-- Supabase プロジェクト porygon-works には複数のアプリの DB をまとめているので、
-- この家計簿の表はすべて ggmg スキーマに置く。
-- 実行したあと、Project Settings → Data API → Exposed schemas に ggmg を足す（アプリと GAS から使うため）。
-- すべての表は user_id で持ち主を決め、ログインした本人だけが読み書きできる（RLS）。
-- GAS はサーバーキー（service_role）で書くため RLS を通らないが、user_id は自分で入れる。

create schema if not exists ggmg;

create or replace function ggmg.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- すべての入出金（予定・速報・確定・手入力・収入・移動）
create table if not exists ggmg.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('expense','income','transfer')),
  status text not null check (status in ('plan','flash','confirmed')),
  date date not null,
  amount integer not null check (amount >= 0),
  method text not null check (method in ('card','cash','paypay','ic','point','bank','revo')),
  category text,
  shop text not null default '',
  item text not null default '',
  memo text not null default '',
  tatekae integer not null default 0,
  source text not null check (source in ('manual','card_flash','card_statement','recurring','migration')),
  source_ref text,
  merged_into uuid references ggmg.entries(id) on delete set null,
  recurring_id uuid,
  not_dup uuid[] not null default '{}',
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_ref)
);
create index if not exists entries_user_date on ggmg.entries (user_id, date);

-- 残高の報告（口座・現金・PayPay）
create table if not exists ggmg.balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  bank integer not null default 0,
  cash integer not null default 0,
  paypay integer not null default 0,
  memo text not null default '',
  created_at timestamptz not null default now()
);

-- カード請求額（「お支払い金額のお知らせ」から）
create table if not exists ggmg.card_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pay_date date not null,
  amount integer not null,
  source_ref text,
  created_at timestamptz not null default now(),
  unique (user_id, pay_date)
);

-- 定期のお金
create table if not exists ggmg.recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('expense','income')),
  category text,
  amount integer not null,
  day integer not null check (day between 1 and 31),
  shift text not null default 'next' check (shift in ('next','prev','none')),
  method text not null default 'bank',
  start_month text,
  end_month text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 費目予算
create table if not exists ggmg.budgets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null,
  category text not null,
  amount integer not null,
  primary key (user_id, month, category)
);

-- お店→費目のルール
create table if not exists ggmg.rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pattern text not null,
  category text not null,
  created_at timestamptz not null default now(),
  unique (user_id, pattern)
);

-- リボ・分割
create table if not exists ggmg.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  balance integer not null default 0,
  as_of date,
  rate text not null default '',
  min_payment integer not null default 0,
  note text not null default '',
  planned boolean not null default false,
  sort integer not null default 0
);

-- 設定（1人1行）
create table if not exists ggmg.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 要確認（GAS が読めなかったメールなど）
create table if not exists ggmg.review (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  title text not null default '',
  body text not null default '',
  source_ref text,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, source_ref)
);

drop trigger if exists entries_updated on ggmg.entries;
create trigger entries_updated before update on ggmg.entries for each row execute function ggmg.set_updated_at();
drop trigger if exists settings_updated on ggmg.settings;
create trigger settings_updated before update on ggmg.settings for each row execute function ggmg.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['entries','balances','card_bills','recurring','budgets','rules','debts','settings','review'] loop
    execute format('alter table ggmg.%I enable row level security', t);
    execute format('drop policy if exists own on ggmg.%I', t);
    execute format('create policy own on ggmg.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Data API（アプリ・GAS）から ggmg を使えるようにする権限。行は上の RLS で本人のものだけに絞られる
grant usage on schema ggmg to anon, authenticated, service_role;
grant all on all tables in schema ggmg to anon, authenticated, service_role;
grant all on all routines in schema ggmg to anon, authenticated, service_role;
grant all on all sequences in schema ggmg to anon, authenticated, service_role;
alter default privileges for role postgres in schema ggmg grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema ggmg grant all on routines to anon, authenticated, service_role;
alter default privileges for role postgres in schema ggmg grant all on sequences to anon, authenticated, service_role;
