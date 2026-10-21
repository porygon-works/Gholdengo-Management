-- 定期のお金に「お店の名前のヒント」を足す。
-- カードの明細のお店にこれが入っていれば、費目が違ってもその予定とまとめる（定期代の Suica が「交通」で入るときなど）。
-- 0001 を実行したあとに、SQL Editor で一度だけ実行する（何度実行しても壊れない）。
alter table ggmg.recurring add column if not exists shop text not null default '';
