import { useMemo, useState } from "react";
import { addDays, bankOn, budgetCats, budgetView, drawPlan, groupOfCat, isLive, lastDay, lowest, outlook, RESERVE, slackAt, slackOn, type Part } from "../engine";
import { actions, actions5, type AppData, type Store } from "../data/store";
import { Bar, cardOfPay, cardTitle, accountTitle, Chip, Field, md, money, NumInput, Select, toast, yen } from "./common";
import type { OpenPart } from "./Parts";
import type { Open } from "./Sheets";

// v5 のホーム（設計書 §4.2）：予算残額・費目別残額・最近の明細・余裕額・使ったものを入れる

type Pay5 = string;
// 払い方は設定のカード（あとから足せる）と PayPay・口座・現金（ATM で引き出した額。設計書 §3.6・§6.1）
const payOptions5 = (d: AppData): Pay5[] => [...d.settings.cards.map((c) => `card:${c.id}`), "paypay", "bank", "atm"];
const payLabels5 = (d: AppData): Record<Pay5, string> => ({ ...Object.fromEntries(d.settings.cards.map((c) => [`card:${c.id}`, c.name])), paypay: "PayPay", bank: "口座", atm: "現金" });

/** 使ったものを入れる。クレカはクレカ明細、PayPay・口座は口座明細、ATM は費目「現金」の口座の出金 */
function QuickForm5({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const s = data.settings;
  const cats = budgetCats(s).filter((c) => c !== RESERVE);
  const [cat, setCat] = useState(cats[0]);
  const [amount, setAmount] = useState<number | "">("");
  const [pay, setPay] = useState<Pay5>(payOptions5(data)[0]);
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [more, setMore] = useState(false);
  const add = async () => {
    if (!amount) { toast("金額を入れてください"); return; }
    const card = cardOfPay(pay);
    const group = groupOfCat(s, cat);
    const ok = await store.run(() => pay === "atm" ? actions5.addAtm(date, amount)
      : card ? actions.addCard({ card, status: "confirmed", date, amount, group, category: cat, name, shop: "" })
      : actions.addAccount({ account: "bank", direction: "out", status: "confirmed", group, category: cat, name: name || (pay === "paypay" ? "PayPayチャージ" : ""), date, amount }));
    if (ok) { toast(`${pay === "atm" ? "現金" : cat} ${yen(amount)}円を入力しました`); setAmount(""); setName(""); setDate(today); setMore(false); }
  };
  return (
    <div className="panel quick">
      <div className="grid2">
        {pay === "atm" ? <Field label="費目"><input value="現金" disabled /></Field> : <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>}
        <Field label="金額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
      </div>
      <div className="seg" role="group" aria-label="払い方">
        {payOptions5(data).map((k) => <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}>{payLabels5(data)[k]}</button>)}
      </div>
      {more && <div className="grid2"><Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} /></Field></div>}
      <div className="btns">
        <button className="btn" onClick={add}>入力</button>
        {!more && <button className="btn ghost" onClick={() => setMore(true)}>詳細</button>}
      </div>
    </div>
  );
}

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

export function Home5({ store, data, today, reviews, openPart, onOpen, go }: {
  store: Store; data: AppData; today: string; reviews: number; openPart: OpenPart; onOpen: (o: Open) => void;
  go: (to: "ledger" | "review" | "settings" | "plans" | "outlook", cat?: string) => void;
}) {
  const ym = today.slice(0, 7);
  const v = budgetView(data, ym, today);
  const slack = useMemo(() => slackAt(data, today, today), [data, today]);
  const loans = slack.parts!.find((p) => p.key === "due")!.parts!.find((p) => p.key === "loans")!.amount;
  // 使いすぎで余裕額がマイナスになった分（借入残高のせいのマイナスは崩さない。設計書 §3.5）
  const over = Math.max(0, -(slack.amount + loans));
  const draws = over ? drawPlan(data, over, today) : [];
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
  const repay = data.v5.plans.filter((p) => p.kind === "repay" && !p.done && p.due_date && p.due_date >= today).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
  const ahead = useMemo(() => (repay ? { label: `返済後（${md(repay.due_date!)}）`, amount: slackOn(data, repay.due_date!, today).amount } : days.length ? { label: "60日後", amount: days[days.length - 1].slack } : null), [data, today, repay, days]);
  const recent = useMemo(() => [
    ...data.cards.filter((e) => isLive(e) && e.status === "confirmed" && e.date <= today).map((e) => ({ date: e.date, at: e.at ?? "", key: e.id, title: cardTitle(e), amount: -e.amount, mail: MAIL.has(e.source), open: () => onOpen({ type: "card", entry: e }) })),
    ...data.accounts.filter((e) => e.account === "bank" && e.status === "confirmed" && e.date <= today && e.group !== "card").map((e) => ({ date: e.date, at: e.at ?? "", key: e.id, title: accountTitle(e), amount: e.direction === "in" ? e.amount : -e.amount, mail: false, open: () => onOpen({ type: "account", entry: e }) })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)).slice(0, 8), [data, today, onOpen]);

  const applyDraw = async () => {
    if (!draws.length) return;
    const ok = await store.run(async () => { for (const x of draws) await actions5.addMove({ plan_id: x.plan.id, kind: "draw", amount: x.amount, date: today, bonus_entry_id: null, entry_kind: null, entry_id: null, memo: "余裕額のマイナスを埋める" }); });
    if (ok) toast("確保額から差し引きました");
  };

  return (
    <>
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>要確認 {reviews} 件（重複の候補など）</button>}
      {data.missing.some((t) => t.startsWith("v5_")) && <div className="alert bad" style={{ marginBottom: 16 }}>Supabase の SQL Editor で supabase/migrations/0008_v5.sql を実行してください。</div>}

      <section className="hero">
        <button className={`tile ${v.left.amount < 0 ? "neg" : ""}`} onClick={() => openPart(leftPart)} aria-label="予算残額の内訳">
          <span className="lb">予算残額</span>
          <span className="v">{money(v.left.amount)}</span>
          <span className={`meter ${v.left.amount < 0 ? "over" : ""}`}><i style={{ width: `${pct(used, v.budget)}%` }} /><i className="p" style={{ width: `${pct(planned, v.budget)}%` }} /></span>
          <span className="sub2"><span>予算 <b>{money(v.budget)}</b></span><span>残り{daysLeft}日{v.left.amount > 0 && daysLeft ? `・1日 ${money(Math.floor(v.left.amount / daysLeft))}` : ""}</span></span>
        </button>
        <button className={`tile slack ${slack.amount < 0 ? "neg" : ""}`} onClick={() => openPart(slack)} aria-label="余裕額の内訳">
          <span className="lb">余裕額</span>
          <span className="v">{money(slack.amount)}</span>
          <Spark days={days} />
          <span className="sub2">{ahead ? <span>{ahead.label} <b className={ahead.amount < 0 ? "neg" : ""}>{money(ahead.amount)}</b></span> : <span />}</span>
        </button>
      </section>
      {data.balances.length > 0 && (
        <button className={`pcard ${low.bank < 0 ? "lowbad" : ""}`} onClick={() => go("outlook")} style={{ marginTop: -12, marginBottom: 28 }}>
          <div className="top"><span className="nm">口座残高</span><span className="amt">{money(bankNow)}</span></div>
          <div className="meta">60日内の最低 <b className={low.bank < 0 ? "neg" : ""}>{md(low.date)} {money(low.bank)}</b>{low.bank < 0 ? "（残高不足）" : ""}</div>
        </button>
      )}
      {over > 0 && draws.length > 0 && <div className="alert">使いすぎで余裕額がマイナスです。<button className="btn sm" onClick={applyDraw}>確保額から取崩（{draws.map((x) => `${x.plan.name} ${money(x.amount)}`).join("・")}）</button></div>}

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
        <h2>支出入力</h2>
        <QuickForm5 store={store} data={data} today={today} />
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
