import { useEffect, useState } from "react";
import { computeMonth, INCOME_EXTRA, isLive, isSalary, ymOf, type Entry } from "../engine";
import type { AppData } from "../data/store";
import { Bar, Chip, Empty, entryTitle, md, METHOD_LABEL, ownCost, signed, StatusChip, yen } from "./common";

export function EntryRow({ e, onOpen, showCat }: { e: Entry; onOpen: (e: Entry) => void; showCat?: boolean }) {
  // 収入は費目ではなく、予算の扱い（給与／追加予算／予算に入れない）を出す
  const what = e.kind === "income" ? (isSalary(e) ? "給与" : e.category === INCOME_EXTRA ? "追加予算" : "予算に入れない") : e.category ?? "未分類";
  const sub = [e.item && e.shop ? e.shop : "", showCat || e.kind === "income" ? what : "", e.method !== "card" ? METHOD_LABEL[e.method] : ""].filter(Boolean).join("・");
  return (
    <button className={`row ${e.status === "plan" ? "plan" : ""}`} onClick={() => onOpen(e)}>
      <span className="d num">{md(e.date)}</span>
      <span className="t"><div>{entryTitle(e)} <StatusChip e={e} /></div>{sub && <div>{sub}</div>}</span>
      <span className="a num">{e.kind === "income" ? "＋" : ""}{yen(e.kind === "income" ? e.amount : ownCost(e))}{e.tatekae ? <small>立替 {yen(e.tatekae)} を除く</small> : null}</span>
    </button>
  );
}

type Mode = "cat" | "time";

const wday = (d: string) => "日月火水木金土"[new Date(d + "T00:00:00Z").getUTCDay()];

/** 時系列：その月の明細と予定を、日付ごとにまとめて新しい順に並べる */
function Timeline({ data, month, onOpen }: { data: AppData; month: string; onOpen: (e: Entry) => void }) {
  const xs = data.entries.filter((e) => isLive(e) && e.kind !== "transfer" && ymOf(e.date) === month).sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
  const days = [...new Set(xs.map((e) => e.date))];
  if (!xs.length) return <Empty>この月の明細はまだありません</Empty>;
  return (
    <section>
      {days.map((d) => {
        const ys = xs.filter((e) => e.date === d);
        const out = ys.filter((e) => e.kind === "expense").reduce((a, e) => a + ownCost(e), 0);
        const inc = ys.filter((e) => e.kind === "income").reduce((a, e) => a + e.amount, 0);
        return (
          <div className="panel" key={d}>
            <div className="cathead" style={{ cursor: "default" }}>
              <span className="n">{md(d)}（{wday(d)}）</span>
              <span className="s num">{out ? `支出 ${yen(out)}` : ""}{out && inc ? "・" : ""}{inc ? `収入 ${yen(inc)}` : ""}</span>
            </div>
            <div className="list">{ys.map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} showCat />)}</div>
          </div>
        );
      })}
    </section>
  );
}

export function Ledger({ data, month, today, focusCat, onOpen, onAdd }: { data: AppData; month: string; today: string; focusCat: string | null; onOpen: (e: Entry) => void; onAdd: () => void }) {
  const v = computeMonth(data, month, today);
  const [mode, setMode] = useState<Mode>(() => { try { return (localStorage.getItem("gholdengo.ledger") as Mode) || "cat"; } catch { return "cat"; } });
  useEffect(() => { try { localStorage.setItem("gholdengo.ledger", mode); } catch { /* なし */ } }, [mode]);
  const [open, setOpen] = useState<string | null>(focusCat);
  useEffect(() => { setOpen(focusCat); if (focusCat) setMode("cat"); }, [focusCat]);
  useEffect(() => {
    if (focusCat) document.getElementById(`cat-${focusCat}`)?.scrollIntoView({ block: "start" });
  }, [focusCat]);

  const empty = !v.cats.some((c) => c.entries.length || c.plans.length) && !v.outside.length && !v.incomes.length;
  const catPanel = (c: (typeof v.cats)[number]) => {
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
  };
  const shown = v.cats.filter((c) => c.budget || c.entries.length || c.plans.length);
  return (
    <>
      <section>
        <div className="seg" role="tablist" aria-label="表示">
          <button role="tab" aria-pressed={mode === "cat"} onClick={() => setMode("cat")}>費目ごと</button>
          <button role="tab" aria-pressed={mode === "time"} onClick={() => setMode("time")}>時系列</button>
        </div>
        <div className="btns"><button className="btn" onClick={onAdd}>＋ 明細・予定を追加</button></div>
      </section>
      {mode === "time" ? <Timeline data={data} month={month} onOpen={onOpen} /> : (
        <>
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
            <h2>変動費 <small>使った {yen(v.U)}・予定 {yen(v.P)}</small></h2>
            {shown.filter((c) => !c.fixed).map(catPanel)}
          </section>
          <section>
            <h2>固定費 <small>見込み {yen(v.base.fixed)}</small></h2>
            {shown.filter((c) => c.fixed).map(catPanel)}
          </section>
          {v.outside.length > 0 && (
            <section>
              <h2>予算に入れない支出 <small>返済・予算外・リボで買った物</small></h2>
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
      )}
    </>
  );
}
