import { useEffect, useState } from "react";
import { budgetView, isLive, ymOf, type AccountEntry, type CardEntry } from "../engine";
import type { AppData } from "../data/store";
import { ACCOUNT_GROUP_LABEL, CARD_GROUP_LABEL, Chip, Empty, md, money, ownCost, wday, yen } from "./common";
import { AccountRow, CardRow } from "./Rows";
import type { Open } from "./Sheets";

// v5 の明細（設計書 §4.2）：「クレカ明細｜口座明細」を切り替える。両方を同じ表に並べない

type Kind = "card" | "account";
type View = "cat" | "time";
const store = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* なし */ } return null; };

const cardKey = (e: CardEntry) => (e.group === "variable" || e.group === "fixed" || e.group === "purchase" ? e.category ?? "未分類" : CARD_GROUP_LABEL[e.group]);
const accountKey = (e: AccountEntry) => (e.direction === "out" && (e.group === "variable" || e.group === "fixed") ? e.category ?? "未分類" : `${e.direction === "in" ? "入金" : "出金"}・${ACCOUNT_GROUP_LABEL[e.group]}`);

export function Ledger5({ data, month, today, focusCat, onOpen, onAdd }: { data: AppData; month: string; today: string; focusCat: string | null; onOpen: (o: Open) => void; onAdd: () => void }) {
  const [kind, setKind] = useState<Kind>(() => (store("gholdengo.ledger5.kind") as Kind) || "card");
  const [view, setView] = useState<View>(() => (store("gholdengo.ledger5.view") as View) || "cat");
  useEffect(() => { store("gholdengo.ledger5.kind", kind); store("gholdengo.ledger5.view", view); }, [kind, view]);
  const [open, setOpen] = useState<string | null>(focusCat);
  useEffect(() => { setOpen(focusCat); if (focusCat) setView("cat"); }, [focusCat]);

  const v = budgetView(data, month, today);
  const cards = data.cards.filter((e) => isLive(e) && ymOf(e.date) === month).sort((a, b) => b.date.localeCompare(a.date));
  const accounts = data.accounts.filter((e) => e.account === "bank" && ymOf(e.date) === month).sort((a, b) => b.date.localeCompare(a.date));
  const rows = kind === "card" ? cards : accounts;
  const keyOf = (e: CardEntry | AccountEntry) => (kind === "card" ? cardKey(e as CardEntry) : accountKey(e as AccountEntry));
  const amountOf = (e: CardEntry | AccountEntry) => (kind === "card" ? ownCost(e as CardEntry) : (e as AccountEntry).direction === "in" ? e.amount : -e.amount);
  const row = (e: CardEntry | AccountEntry) => (kind === "card" ? <CardRow key={e.id} e={e as CardEntry} data={data} onOpen={onOpen} showCat={view === "time"} /> : <AccountRow key={e.id} e={e as AccountEntry} onOpen={onOpen} showCat={view === "time"} />);

  const groups = view === "cat" ? [...new Set(rows.map(keyOf))] : [...new Set(rows.map((e) => e.date))];
  const catOrder = v.cats.map((c) => c.cat);
  if (view === "cat") groups.sort((a, b) => (catOrder.indexOf(a) + 1 || 999) - (catOrder.indexOf(b) + 1 || 999));

  return (
    <>
      <section>
        <div className="seg" role="tablist" aria-label="どの明細か">
          <button role="tab" aria-pressed={kind === "card"} onClick={() => setKind("card")}>クレカ明細</button>
          <button role="tab" aria-pressed={kind === "account"} onClick={() => setKind("account")}>口座明細</button>
        </div>
        <div className="sec-h">
          <div className="seg" role="tablist" aria-label="並べ方">
            <button role="tab" aria-pressed={view === "cat"} onClick={() => setView("cat")}>費目別</button>
            <button role="tab" aria-pressed={view === "time"} onClick={() => setView("time")}>日付別</button>
          </div>
          <button className="btn sm" onClick={onAdd}>新規入力</button>
        </div>
      </section>
      {!rows.length ? <Empty>この月の{kind === "card" ? "クレカ明細" : "口座明細"}はまだありません</Empty> : groups.map((g) => {
        const items = rows.filter((e) => (view === "cat" ? keyOf(e) : e.date) === g);
        const cat = view === "cat" ? v.cats.find((c) => c.cat === g) : undefined;
        const isOpen = view === "time" || open === g;
        return (
          <div className="panel" key={g} id={`cat-${g}`}>
            <button className="cathead" aria-expanded={isOpen} onClick={() => view === "cat" && setOpen(isOpen ? null : g)}>
              <span className="n">{view === "cat" ? g : `${md(g)}（${wday(g)}）`} {cat && <Chip kind={cat.over ? "bad" : "ok"}>{cat.over ? `超過 ${yen(-cat.left)}` : `残り ${yen(cat.left)}`}</Chip>}</span>
              <span className="s num">{money(items.reduce((a, e) => a + amountOf(e), 0))}{cat ? ` / 予算 ${money(cat.budget)}` : ""}</span>
            </button>
            {isOpen ? <div className="list">{items.map(row)}</div> : <div className="note">{items.length}件 ›</div>}
          </div>
        );
      })}
    </>
  );
}
