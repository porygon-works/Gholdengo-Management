import { useEffect, useState } from "react";
import { computeMonth, type Entry } from "../engine";
import type { AppData } from "../data/store";
import { Bar, Chip, Empty, entryTitle, md, METHOD_LABEL, ownCost, signed, StatusChip, yen } from "./common";

export function EntryRow({ e, onOpen, showCat }: { e: Entry; onOpen: (e: Entry) => void; showCat?: boolean }) {
  const sub = [e.item && e.shop ? e.shop : "", showCat ? e.category ?? "未分類" : "", e.method !== "card" ? METHOD_LABEL[e.method] : ""].filter(Boolean).join("・");
  return (
    <button className={`row ${e.status === "plan" ? "plan" : ""}`} onClick={() => onOpen(e)}>
      <span className="d num">{md(e.date)}</span>
      <span className="t"><div>{entryTitle(e)} <StatusChip e={e} /></div>{sub && <div>{sub}</div>}</span>
      <span className="a num">{e.kind === "income" ? "＋" : ""}{yen(e.kind === "income" ? e.amount : ownCost(e))}{e.tatekae ? <small>立替 {yen(e.tatekae)} を除く</small> : null}</span>
    </button>
  );
}

export function Ledger({ data, month, today, focusCat, onOpen, onAdd }: { data: AppData; month: string; today: string; focusCat: string | null; onOpen: (e: Entry) => void; onAdd: () => void }) {
  const v = computeMonth(data, month, today);
  const [open, setOpen] = useState<string | null>(focusCat);
  useEffect(() => setOpen(focusCat), [focusCat]);
  useEffect(() => {
    if (focusCat) document.getElementById(`cat-${focusCat}`)?.scrollIntoView({ block: "start" });
  }, [focusCat]);

  const empty = !v.cats.some((c) => c.entries.length || c.plans.length) && !v.outside.length && !v.incomes.length;
  return (
    <>
      <section><div className="btns"><button className="btn" onClick={onAdd}>＋ 明細・予定を追加</button></div></section>
      {empty && <Empty>この月の明細はまだありません</Empty>}
      {v.unclassified.length > 0 && (
        <section>
          <div className="panel unc">
            <div className="cathead" style={{ cursor: "default" }}><span className="n">未分類 {v.unclassified.length}件</span><span className="s num">{yen(v.unclassified.reduce((a, e) => a + ownCost(e), 0))}円（予備で数えています）</span></div>
            <div className="note">タップして費目を入れてください。お店の名前があれば、次から同じお店は自動で分けます。</div>
            <div className="list">{v.unclassified.map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} />)}</div>
          </div>
        </section>
      )}
      <section>
        <h2>費目ごと <small>使った {yen(v.U)}・予定 {yen(v.P)}</small></h2>
        {v.cats.filter((c) => c.budget || c.entries.length || c.plans.length).map((c) => {
          const isOpen = open === c.cat;
          const st = c.rem < 0 ? "bad" : c.budget && c.rem < c.budget * 0.15 ? "warn" : "ok";
          return (
            <div className="panel" key={c.cat} id={`cat-${c.cat}`}>
              <button className="cathead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.cat)}>
                <span className="n">{c.cat} <Chip kind={st}>{c.rem < 0 ? `超過 ${yen(-c.rem)}` : `残り ${yen(c.rem)}`}</Chip></span>
                <span className="s num">{yen(c.used)}{c.planned ? `＋予定${yen(c.planned)}` : ""} / {yen(c.budget)}</span>
              </button>
              <Bar budget={c.budget} used={c.used} planned={c.planned} />
              {isOpen ? (
                c.entries.length || c.plans.length
                  ? <div className="list">{c.plans.map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} />)}{c.entries.map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} />)}</div>
                  : <div className="note">この月の明細はありません</div>
              ) : <div className="note">明細 {c.entries.length}件{c.plans.length ? `・予定 ${c.plans.length}件` : ""}・タップで開く</div>}
            </div>
          );
        })}
      </section>
      {v.outside.length > 0 && (
        <section>
          <h2>自由に使えるお金に入れない支出 <small>固定引落・返済・予算外・リボで買った物</small></h2>
          <div className="panel"><div className="list">{v.outside.sort((a, b) => b.date.localeCompare(a.date)).map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} showCat />)}</div></div>
        </section>
      )}
      {v.incomes.length > 0 && (
        <section>
          <h2>収入 <small>計 {signed(v.incomes.reduce((a, e) => a + e.amount, 0))}円</small></h2>
          <div className="panel"><div className="list">{v.incomes.sort((a, b) => a.date.localeCompare(b.date)).map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} />)}</div></div>
        </section>
      )}
    </>
  );
}
