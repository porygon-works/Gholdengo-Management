-- Claude が読むための書き出し（docs/OPS.md）。アプリが開くたびに、計算したまとめと元のデータを入れる（1人1行）
-- GAS が1時間に1回、これを Google ドライブに置く
-- 何度実行しても壊れない
create table if not exists ggmg.snapshots (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
drop trigger if exists snapshots_updated on ggmg.snapshots;
create trigger snapshots_updated before update on ggmg.snapshots for each row execute function ggmg.set_updated_at();
alter table ggmg.snapshots enable row level security;
drop policy if exists own on ggmg.snapshots;
create policy own on ggmg.snapshots for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on ggmg.snapshots to anon, authenticated, service_role;
