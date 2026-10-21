import { useEffect, useState } from "react";
import { computeMonth, isLive, ymOf, type AccountEntry, type CardEntry, type Spend } from "../engine";
import type { AppData } from "../data/store";
import { ACCOUNT_GROUP_LABEL, accountTitle, Bar, CARD_GROUP_LABEL, cardTitle, Empty, md, money, ownCost, signed, StatusChip, wday, yen } from "./common";
import type { Open } from "./Sheets";

type OnOpen = (o: Open) => void;

export function CardRow({ e, data, onOpen, showCat }: { e: CardEntry; data: AppData; onOpen: OnOpen; showCat?: boolean }) {
  const card = data.settings.cards.find((c) => c.id === e.card)?.name ?? "クレカ";
  const what = e.group === "variable" || e.group === "fixed" ? e.category ?? "未分類" : CARD_GROUP_LABEL[e.group];
  const sub = [card, e.name && e.shop ? e.shop : "", showCat || (e.group !== "variable" && e.group !== "fixed") ? what : ""].filter(Boolean).join("・");
  return (
    <button className={`row ${e.status === "plan" ? "plan" : ""}`} onClick={() => onOpen({ type: "card", entry: e })}>
      <span className="d num">{md(e.date)}</span>
      <span className="t"><div>{cardTitle(e)} {e.status === "plan" && <StatusChip status="plan" />}</div>{sub && <div>{sub}</div>}</span>
      <span className="a num">{yen(ownCost(e))}{e.tatekae ? <small>立替 {yen(e.tatekae)} を除く</small> : null}</span>
    </button>
  );
}

export function AccountRow({ e, onOpen, showCat }: { e: AccountEntry; onOpen: OnOpen; showCat?: boolean }) {
  const what = e.direction === "out" && (e.group === "variable" || e.group === "fixed") ? e.category ?? "未分類" : ACCOUNT_GROUP_LABEL[e.group];
  const sub = [e.account === "wallet" ? "財布" : "口座", showCat || e.group === "card" || e.direction === "in" ? what : ""].filter(Boolean).join("・");
  return (
    <button className={`row ${e.status === "plan" ? "plan" : ""}`} onClick={() => onOpen({ type: "account", entry: e })}>
      <span className="d num">{md(e.date)}</span>
      <span className="t"><div>{accountTitle(e)} {e.status === "plan" && <StatusChip status="plan" />}</div><div>{sub}</div></span>
      <span className="a num">{e.direction === "in" ? "＋" : ""}{yen(e.amount)}</span>
    </button>
  );
}

const SpendRow = ({ x, data, onOpen }: { x: Spend; data: AppData; onOpen: OnOpen }) => (x.card ? <CardRow e={x.card} data={data} onOpen={onOpen} /> : <AccountRow e={x.account!} onOpen={onOpen} />);

type Mode = "cat" | "time";

/** 日付ごと：その月のクレカ明細と口座明細を、日付ごとに新しい順に並べる */
function Timeline({ data, month, onOpen }: { data: AppData; month: string; onOpen: OnOpen }) {
  const cards = data.cards.filter((e) => isLive(e) && ymOf(e.date) === month);
  const accounts = data.accounts.filter((e) => ymOf(e.date) === month);
  const days = [...new Set([...cards, ...accounts].map((e) => e.date))].sort().reverse();
  if (!days.length) return <Empty>この月の明細はまだありません</Empty>;
  return (
    <section>
      {days.map((d) => {
        const cs = cards.filter((e) => e.date === d), as = accounts.filter((e) => e.date === d);
        const out = cs.reduce((a, e) => a + ownCost(e), 0) + as.filter((e) => e.direction === "out").reduce((a, e) => a + e.amount, 0);
        const inc = as.filter((e) => e.direction === "in").reduce((a, e) => a + e.amount, 0);
        return (
          <div className="panel" key={d}>
            <div className="cathead" style={{ cursor: "default" }}>
              <span className="n">{md(d)}（{wday(d)}）</span>
              <span className="s num">{out ? `出 ${yen(out)}` : ""}{out && inc ? "・" : ""}{inc ? `入 ${yen(inc)}` : ""}</span>
            </div>
            <div className="list">
              {cs.map((e) => <CardRow key={e.id} e={e} data={data} onOpen={onOpen} showCat />)}
              {as.map((e) => <AccountRow key={e.id} e={e} onOpen={onOpen} showCat />)}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function Ledger({ data, month, today, focusCat, onOpen, onAdd }: { data: AppData; month: string; today: string; focusCat: string | null; onOpen: OnOpen; onAdd: () => void }) {
  const v = computeMonth(data, month, today);
  const [mode, setMode] = useState<Mode>(() => { try { return (localStorage.getItem("gholdengo.ledger") as Mode) || "cat"; } catch { return "cat"; } });
  useEffect(() => { try { localStorage.setItem("gholdengo.ledger", mode); } catch { /* なし */ } }, [mode]);
  const [open, setOpen] = useState<string | null>(focusCat);
  useEffect(() => { setOpen(focusCat); if (focusCat) setMode("cat"); }, [focusCat]);
  useEffect(() => { if (focusCat) document.getElementById(`cat-${focusCat}`)?.scrollIntoView({ block: "start" }); }, [focusCat]);

  const empty = !v.cats.some((c) => c.items.length || c.plans.length) && !v.outsideCards.length && !v.outsideAccounts.length && !v.incomes.length;
  const catPanel = (c: (typeof v.cats)[number]) => {
    const isOpen = open === c.cat;
    const st = c.rem < 0 ? "bad" : c.budget && c.rem < c.budget * 0.15 ? "warn" : "ok";
    // 固定費は、見込みのうちまだ使っていない額（ダッシュボードの「これから」と同じ）
    const left = c.rem < 0 ? -c.rem : c.fixed ? Math.max(0, c.budget - c.used) : c.rem;
    return (
      <div className="panel" key={c.cat} id={`cat-${c.cat}`}>
        <button className="cathead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.cat)}>
          <span className="n">{c.cat}</span>
          <span className={`rem num ${st}`}><small>{c.rem < 0 ? "超過" : c.fixed ? "これから" : "残り"}</small>{money(left)}</span>
        </button>
        <div className="catnums num">
          <span>{c.fixed ? "見込み" : "予算"} {money(c.budget)}</span>
          <span>使った {money(c.used)}</span>
          {c.planned ? <span>予定 {money(c.planned)}</span> : null}
        </div>
        <Bar budget={c.budget} used={c.used} planned={c.planned} />
        {isOpen ? (
          c.items.length || c.plans.length
            ? <div className="list">{c.plans.map((x) => <SpendRow key={x.id} x={x} data={data} onOpen={onOpen} />)}{c.items.map((x) => <SpendRow key={x.id} x={x} data={data} onOpen={onOpen} />)}</div>
            : <div className="note">この月の明細はありません</div>
        ) : <div className="note">明細 {c.items.length}件{c.plans.length ? `・予定 ${c.plans.length}件` : ""}・タップで開く</div>}
      </div>
    );
  };
  const shown = v.cats.filter((c) => c.budget || c.items.length || c.plans.length);
  return (
    <>
      <section>
        <div className="seg" role="tablist" aria-label="表示">
          <button role="tab" aria-pressed={mode === "cat"} onClick={() => setMode("cat")}>費目ごと</button>
          <button role="tab" aria-pressed={mode === "time"} onClick={() => setMode("time")}>日付ごと</button>
        </div>
        <div className="btns"><button className="btn" onClick={onAdd}>追加</button></div>
      </section>
      {mode === "time" ? <Timeline data={data} month={month} onOpen={onOpen} /> : (
        <>
          {empty && <Empty>この月の明細はまだありません</Empty>}
          {v.unclassified.length > 0 && (
            <section>
              <div className="panel unc">
                <div className="cathead" style={{ cursor: "default" }}><span className="n">未分類 {v.unclassified.length}件</span><span className="s num">{yen(v.unclassified.reduce((a, x) => a + x.own, 0))}円（予備で数えています）</span></div>
                <div className="note">タップして費目を入れてください。店の名前があれば、次から同じ店は自動で分けます。</div>
                <div className="list">{v.unclassified.map((x) => <SpendRow key={x.id} x={x} data={data} onOpen={onOpen} />)}</div>
              </div>
            </section>
          )}
          <section>
            <h2>{ACCOUNT_GROUP_LABEL.variable} <small>使った {money(v.U)}・予定 {money(v.P)}</small></h2>
            {shown.filter((c) => !c.fixed).map(catPanel)}
          </section>
          <section>
            <h2>{ACCOUNT_GROUP_LABEL.fixed} <small>見込み {money(v.base.fixed)}</small></h2>
            {shown.filter((c) => c.fixed).map(catPanel)}
          </section>
          {(v.outsideCards.length > 0 || v.outsideAccounts.length > 0) && (
            <section>
              <h2>予算に入れない出費 <small>立替・分割・クレカ支払い・その他</small></h2>
              <div className="panel"><div className="list">
                {v.outsideCards.map((e) => <CardRow key={e.id} e={e} data={data} onOpen={onOpen} showCat />)}
                {v.outsideAccounts.map((e) => <AccountRow key={e.id} e={e} onOpen={onOpen} showCat />)}
              </div></div>
            </section>
          )}
          {v.incomes.length > 0 && (
            <section>
              <h2>入金 <small>計 {signed(v.incomes.reduce((a, e) => a + e.amount, 0))}円</small></h2>
              <div className="panel"><div className="list">{v.incomes.map((e) => <AccountRow key={e.id} e={e} onOpen={onOpen} />)}</div></div>
            </section>
          )}
        </>
      )}
    </>
  );
}
