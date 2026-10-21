-- 明細を消したときの印と、定期マスタの「何か月ごと」（docs/SPEC.md §3）
-- 消した明細は行を残して deleted にする（メールの取り込みや定期・目標の予定づくりで、また作られないように）
-- 何度実行しても壊れない
alter table ggmg.account_entries add column if not exists deleted boolean not null default false;
alter table ggmg.card_entries add column if not exists deleted boolean not null default false;
-- 1 = 毎月、2 = 2か月ごと、12 = 毎年。start_month の月から数える
alter table ggmg.recurring add column if not exists every integer not null default 1 check (every between 1 and 12);
