-- クレカを複数持てるようにする（三井住友・セゾンなど。カードの締め日・引落日は settings.data.cards）
-- card は settings.data.cards の id。null は1枚目のカード（カードのメールから入る明細はこれ）
alter table ggmg.entries add column if not exists card text;
alter table ggmg.recurring add column if not exists card text;
-- 請求額はカードごと。前からある行は1枚目のカード（三井住友）の請求
alter table ggmg.card_bills add column if not exists card text not null default 'smbc';
