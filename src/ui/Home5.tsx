import { useMemo } from "react";
import { addDays, bankOn, budgetView, isLive, lastDay, lowest, outlook, savingsTotal, slackAt, type Part } from "../engine";
import type { AppData } from "../data/store";
import { Bar, cardTitle, accountTitle, Chip, md, money, yen } from "./common";
import type { OpenPart } from "./Parts";
import type { Open } from "./Sheets";

// v5 のホーム（設計書 §4.2）：予算残額・余裕額・口座残高・費目別残額・最近の明細。入力は入力の画面（§4.4）

const MAIL = new Set(["card_flash", "card_statement"]);
const pct = (x: number, of: number) => (of > 0 ? Math.max(0, Math.min(100, (x / of) * 100)) : 0);

/** 余裕額の先の動き（小さい線。0 の線つき） */
function Spark({ days }: { days: { slack: number }[] }) {
  if (days.length < 2) return <svg className="spark" />;
  const W = 160, H = 34, vs = days.map((x) => x.slack), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs) || 1;
  const x = (k: number) => (W * k) / (days.length - 1), y = (v: number) => 3 + ((H - 6) * (hi - v)) / (hi - lo || 1);
  const d = vs.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke="var(--gold)" strokeWidth={2.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Home5({ data, today, reviews, openPart, onOpen, go }: {
  data: AppData; today: string; reviews: number; openPart: OpenPart; onOpen: (o: Open) => void;
  go: (to: "ledger" | "review" | "settings" | "plans" | "outlook", cat?: string) => void;
}) {
  const ym = today.slice(0, 7);
  const v = budgetView(data, ym, today);
  const slack = useMemo(() => slackAt(data, today, today), [data, today]);
  // 余裕額のうち、使う日のない貯蓄計画にたまっている分（設計書 §2.2）
  const savings = useMemo(() => savingsTotal(data, today), [data, today]);
  // 予算残額の内訳の「予算」から、目安額の式までたどれるようにする
  const leftPart: Part = { ...v.left, parts: v.left.parts!.map((p) => (p.key === "budget" ? { ...p, label: v.source === "decided" ? "予算（決定額）" : "予算（目安額）", parts: v.guide.parts } : p)) };
  const vars = v.cats.filter((c) => !c.fixed && (c.budget || c.used || c.planned));
  const varCats = v.cats.filter((c) => !c.fixed);
  const used = varCats.reduce((a, c) => a + c.used, 0), planned = varCats.reduce((a, c) => a + c.planned, 0);
  const daysLeft = lastDay(ym) - +today.slice(8) + 1;
  // 余裕額の先の動き（60日）と、返済の計画があれば返したあとの見込み
  const days = useMemo(() => (data.balances.length ? outlook(data, today, today, addDays(today, 60)) : []), [data, today]);
  const bankNow = useMemo(() => bankOn(data, today).amount, [data, today]);
  const low = useMemo(() => lowest(data, today, addDays(today, 60)), [data, today]);
  const ahead = days.length ? { label: "60日後", amount: days[days.length - 1].slack } : null;
  const recent = useMemo(() => [
    ...data.cards.filter((e) => isLive(e) && e.status === "confirmed" && e.date <= today).map((e) => ({ date: e.date, at: e.at ?? "", key: e.id, title: cardTitle(e), amount: -e.amount, mail: MAIL.has(e.source), open: () => onOpen({ type: "card", entry: e }) })),
    ...data.accounts.filter((e) => e.account === "bank" && e.status === "confirmed" && e.date <= today && e.group !== "card").map((e) => ({ date: e.date, at: e.at ?? "", key: e.id, title: accountTitle(e), amount: e.direction === "in" ? e.amount : -e.amount, mail: false, open: () => onOpen({ type: "account", entry: e }) })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)).slice(0, 8), [data, today, onOpen]);

  return (
    <>
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>要確認 {reviews} 件（重複の候補など）</button>}
      {data.missing.some((t) => t.startsWith("v5_")) && <div className="alert bad" style={{ marginBottom: 16 }}>Supabase の SQL Editor で supabase/migrations/0008_v5.sql を実行してください。</div>}

      <section className="hero">
        <button className={`tile ${v.left.amount < 0 ? "neg" : ""}`} onClick={() => openPart(leftPart)} aria-label="予算残額の内訳">
          <span className="lb">予算残額</span>
          <span className="v">{money(v.left.amount)}<span className="go">›</span></span>
          <span className={`meter ${v.left.amount < 0 ? "over" : ""}`}><i style={{ width: `${pct(used, v.budget)}%` }} /><i className="p" style={{ width: `${pct(planned, v.budget)}%` }} /></span>
          <span className="sub2"><span>予算 <b>{money(v.budget)}</b></span><span>残り{daysLeft}日{v.left.amount > 0 && daysLeft ? `・1日 ${money(Math.floor(v.left.amount / daysLeft))}` : ""}</span></span>
        </button>
        <button className={`tile slack ${slack.amount < 0 ? "neg" : ""}`} onClick={() => openPart(slack)} aria-label="余裕額の内訳">
          <span className="lb">余裕額</span>
          <span className="v">{money(slack.amount)}<span className="go">›</span></span>
          <Spark days={days} />
          <span className="sub2">{ahead ? <span>{ahead.label} <b className={ahead.amount < 0 ? "neg" : ""}>{money(ahead.amount)}</b></span> : <span />}{savings.amount > 0 && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); openPart(savings); }}>うち貯蓄 <b>{money(savings.amount)}</b><span className="go">›</span></span>}</span>
        </button>
      </section>
      {data.balances.length > 0 && (
        <button className={`pcard ${low.bank < 0 ? "lowbad" : ""}`} onClick={() => go("outlook")} style={{ marginTop: -12, marginBottom: 28 }}>
          <div className="top"><span className="nm">口座残高</span><span className="amt">{money(bankNow)}</span></div>
          <div className="meta">60日内の最低 <b className={low.bank < 0 ? "neg" : ""}>{md(low.date)} {money(low.bank)}</b>{low.bank < 0 ? "（残高不足）" : ""}</div>
        </button>
      )}

      <section>
        <div className="sec-h"><h2>費目別残額</h2><button className="btn sm ghost" onClick={() => go("ledger")}>明細</button></div>
        <div className="panel">
          {vars.map((r) => (
            <button key={r.cat} className="crow" onClick={() => go("ledger", r.cat)}>
              <span className="c">{r.cat}</span>
              <Bar budget={r.budget} used={r.used} planned={r.planned} />
              <span className={`nb num ${r.over ? "neg" : ""}`}>{money(r.left)}<small> / {yen(r.budget)}</small></span>
            </button>
          ))}
          <button className="crow" onClick={() => go("ledger")}>
            <span className="c">固定費</span>
            <Bar budget={v.fixed.budget} used={v.fixed.used} planned={0} />
            <span className={`nb num ${v.fixed.used > v.fixed.budget ? "neg" : ""}`}>{yen(v.fixed.used)}<small> / {yen(v.fixed.budget)}</small></span>
          </button>
        </div>
      </section>


      <section>
        <h2>最新明細</h2>
        <div className="panel"><div className="list">
          {recent.map((r) => (
            <button key={r.key} className="row" onClick={r.open}>
              <span className="d num">{md(r.date)}</span>
              <span className="t"><div>{r.title} {r.mail && <Chip kind="ok">メール</Chip>}</div></span>
              <span className={`a num ${r.amount > 0 ? "pos" : ""}`}>{r.amount > 0 ? "＋" : "−"}{yen(Math.abs(r.amount))}</span>
            </button>
          ))}
          {!recent.length && <div className="note">明細はまだありません</div>}
        </div></div>
      </section>
    </>
  );
}
