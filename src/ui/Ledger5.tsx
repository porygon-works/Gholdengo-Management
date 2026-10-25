import { useEffect, useState } from "react";
import { budgetView, isLive, ymOf, type AccountEntry, type CardEntry } from "../engine";
import type { AppData } from "../data/store";
import { ACCOUNT_GROUP_LABEL, CARD_GROUP_LABEL, Chip, Empty, md, money, ownCost, wday, yen } from "./common";
import { AccountRow, CardRow } from "./Rows";
import type { Open } from "./Sheets";

// v5 の明細（設計書 §4.1 の2・§4.2）：入力と同じ「出金｜入金」で切り替える。
// 出金はカード・口座・現金をまとめて並べ、払い方で絞れる。クレカの請求（引き落とし）の行は出さない（見通しで見る）

type Kind = "out" | "in";
type View = "cat" | "time";
type Row = { e: CardEntry; card: true } | { e: AccountEntry; card: false };
const store = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* なし */ } return null; };

/** 出金の行の払い方：カードはそのカード、口座の出金は「口座」、ATM で引き出した額（費目「現金」）は「現金」 */
const payOf = (r: Row) => (r.card ? `card:${r.e.card}` : r.e.category === "現金" ? "atm" : "bank");
const catOf = (r: Row) => {
  if (r.card) return r.e.group === "variable" || r.e.group === "fixed" || r.e.group === "purchase" ? r.e.category ?? "未分類" : CARD_GROUP_LABEL[r.e.group];
  return r.e.group === "variable" || r.e.group === "fixed" ? r.e.category ?? "未分類" : ACCOUNT_GROUP_LABEL[r.e.group];
};
const amountOf = (r: Row) => (r.card ? ownCost(r.e) : r.e.amount);

export function Ledger5({ data, month, today, focusCat, onOpen, onAdd }: { data: AppData; month: string; today: string; focusCat: string | null; onOpen: (o: Open) => void; onAdd: (k: Kind) => void }) {
  const [kind, setKind] = useState<Kind>(() => (store("gholdengo.ledger5.kind2") as Kind) || "out");
  const [view, setView] = useState<View>(() => (store("gholdengo.ledger5.view") as View) || "cat");
  const [pay, setPay] = useState("all");
  useEffect(() => { store("gholdengo.ledger5.kind2", kind); store("gholdengo.ledger5.view", view); }, [kind, view]);
  const [open, setOpen] = useState<string | null>(focusCat);
  useEffect(() => { setOpen(focusCat); if (focusCat) { setView("cat"); setKind("out"); setPay("all"); } }, [focusCat]);

  const v = budgetView(data, month, today);
  const s = data.settings;
  const outs: Row[] = [
    ...data.cards.filter((e) => isLive(e) && ymOf(e.date) === month).map((e) => ({ e, card: true as const })),
    ...data.accounts.filter((e) => e.account === "bank" && e.direction === "out" && e.group !== "card" && ymOf(e.date) === month).map((e) => ({ e, card: false as const })),
  ];
  const ins: Row[] = data.accounts.filter((e) => e.account === "bank" && e.direction === "in" && ymOf(e.date) === month).map((e) => ({ e, card: false as const }));
  const pays: [string, string][] = [["all", "全部"], ...s.cards.map((c) => [`card:${c.id}`, c.name] as [string, string]), ["bank", "口座"], ["atm", "現金"]];
  const rows = (kind === "out" ? outs.filter((r) => pay === "all" || payOf(r) === pay) : ins).sort((a, b) => b.e.date.localeCompare(a.e.date));
  const byCat = kind === "out" && view === "cat";
  const keyOf = (r: Row) => (byCat ? catOf(r) : r.e.date);
  const row = (r: Row) => (r.card ? <CardRow key={r.e.id} e={r.e} data={data} onOpen={onOpen} showCat={!byCat} /> : <AccountRow key={r.e.id} e={r.e} onOpen={onOpen} showCat={!byCat} />);

  const groups = [...new Set(rows.map(keyOf))];
  const catOrder = v.cats.map((c) => c.cat);
  if (byCat) groups.sort((a, b) => (catOrder.indexOf(a) + 1 || 999) - (catOrder.indexOf(b) + 1 || 999));

  return (
    <>
      <section>
        <div className="sec-h">
          <div className="seg" role="tablist" aria-label="出金か入金か">
            <button role="tab" aria-pressed={kind === "out"} onClick={() => setKind("out")}>出金</button>
            <button role="tab" aria-pressed={kind === "in"} onClick={() => setKind("in")}>入金</button>
          </div>
          <button className="btn sm" onClick={() => onAdd(kind)}>新規入力</button>
        </div>
        {kind === "out" && (
          <>
            <div className="seg" role="tablist" aria-label="並べ方">
              <button role="tab" aria-pressed={view === "cat"} onClick={() => setView("cat")}>費目別</button>
              <button role="tab" aria-pressed={view === "time"} onClick={() => setView("time")}>日付別</button>
            </div>
            <div className="seg" role="group" aria-label="払い方" style={{ marginTop: 8 }}>
              {pays.map(([k, l]) => <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}>{l}</button>)}
            </div>
          </>
        )}
      </section>
      {!rows.length ? <Empty>この月の{kind === "out" ? "出金" : "入金"}はまだありません</Empty> : groups.map((g) => {
        const items = rows.filter((r) => keyOf(r) === g);
        const cat = byCat && pay === "all" ? v.cats.find((c) => c.cat === g) : undefined;
        const isOpen = !byCat || open === g;
        const total = items.reduce((a, r) => a + amountOf(r), 0);
        return (
          <div className="panel" key={g} id={`cat-${g}`}>
            <button className="cathead" aria-expanded={isOpen} onClick={() => byCat && setOpen(isOpen ? null : g)}>
              <span className="n">{byCat ? g : `${md(g)}（${wday(g)}）`} {cat && <Chip kind={cat.over ? "bad" : "ok"}>{cat.over ? `超過 ${yen(-cat.left)}` : `残り ${yen(cat.left)}`}</Chip>}</span>
              <span className="s num">{kind === "in" ? "＋" : ""}{money(total)}{cat ? ` / 予算 ${money(cat.budget)}` : ""}</span>
            </button>
            {isOpen ? <div className="list">{items.map(row)}</div> : <div className="note">{items.length}件 ›</div>}
          </div>
        );
      })}
    </>
  );
}
