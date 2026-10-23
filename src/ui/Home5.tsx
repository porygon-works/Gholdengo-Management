import { useMemo, useState } from "react";
import { budgetCats, budgetView, drawPlan, groupOfCat, isLive, RESERVE, slackAt, type Part } from "../engine";
import { actions, actions5, type AppData, type Store } from "../data/store";
import { Bar, cardOfPay, cardTitle, accountTitle, Chip, Field, md, money, NumInput, Select, toast, yen } from "./common";
import { PartNum, type OpenPart } from "./Parts";
import type { Open } from "./Sheets";

// v5 のホーム（設計書 §4.2）：予算残額・費目別残額・最近の明細・余裕額・使ったものを入れる

type Pay5 = string;
const payOptions5 = (d: AppData): Pay5[] => [...d.settings.cards.map((c) => `card:${c.id}`), "paypay", "bank", "atm"];
const payLabels5 = (d: AppData): Record<Pay5, string> => ({ ...Object.fromEntries(d.settings.cards.map((c) => [`card:${c.id}`, `クレカ（${c.name}）`])), paypay: "PayPay", bank: "口座", atm: "ATM で引き出した" });

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
    if (ok) { toast(pay === "atm" ? `現金 ${yen(amount)}円を入れました` : `${cat} ${yen(amount)}円を入れました`); setAmount(""); setName(""); setDate(today); setMore(false); }
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
        <button className="btn" onClick={add}>入れる</button>
        {!more && <button className="btn ghost" onClick={() => setMore(true)}>日付・名称も入れる</button>}
      </div>
    </div>
  );
}

const MAIL = new Set(["card_flash", "card_statement"]);

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
  const budgetPart: Part = { key: "budget", label: "今月の予算", amount: v.budget, sign: 1, parts: [v.guide] };
  const vars = v.cats.filter((c) => !c.fixed && (c.budget || c.used || c.planned));
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
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>確認してほしいことが {reviews} 件あります（重複の候補など）。タップで開く</button>}
      {data.missing.some((t) => t.startsWith("v5_")) && <div className="alert bad" style={{ marginBottom: 16 }}>Supabase の SQL Editor で supabase/migrations/0008_v5.sql を実行してください。</div>}

      <section>
        <div className="cards">
          <div className={`kpi ${v.left.amount < 0 ? "bad" : "main"}`}>
            <div className="lb">今月の予算残額</div>
            <div className="v"><PartNum part={v.left} open={openPart} big /></div>
            <div className="note" style={{ color: "inherit", opacity: .85 }}>予算 <PartNum part={budgetPart} open={openPart} /></div>
          </div>
          <div className={`kpi ${slack.amount < 0 ? "bad" : ""}`}>
            <div className="lb">余裕額</div>
            <div className="v"><PartNum part={slack} open={openPart} /></div>
            {over > 0 && draws.length > 0 && <button className="btn sm" onClick={applyDraw}>確保額から差し引く（{draws.map((x) => `${x.plan.name} ${money(x.amount)}`).join("・")}）</button>}
          </div>
        </div>
      </section>

      <section>
        <h2>費目別残額 <button className="lnk" onClick={() => go("ledger")}>明細</button></h2>
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
        <h2>使ったものを入れる</h2>
        <QuickForm5 store={store} data={data} today={today} />
      </section>

      <section>
        <h2>最近の明細</h2>
        <div className="panel"><div className="list">
          {recent.map((r) => (
            <button key={r.key} className="row" onClick={r.open}>
              <span className="d num">{md(r.date)}</span>
              <span className="t"><div>{r.title} {r.mail && <Chip kind="ok">メール</Chip>}</div></span>
              <span className={`a num ${r.amount > 0 ? "pos" : ""}`}>{r.amount > 0 ? "＋" : ""}{yen(Math.abs(r.amount))}</span>
            </button>
          ))}
          {!recent.length && <div className="note">明細はまだありません</div>}
        </div></div>
      </section>
    </>
  );
}
