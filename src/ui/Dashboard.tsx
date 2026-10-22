import { useMemo, useState } from "react";
import { budgetCats, computeMonth, forecast, groupOfCat, RESERVE } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { accountTitle, Bar, cardOfPay, Chip, Field, md, money, NumInput, payLabels, payOptions, Select, signed, toast, yen, type Pay } from "./common";
import { FlowChart, type OpenRow } from "./Flow";
import { KindChip, statusText } from "./PlansView";

interface Props {
  store: Store;
  data: AppData;
  month: string;
  today: string;
  reviews: number;
  go: (to: "ledger" | "review" | "flow" | "plans" | "balance" | "settings", cat?: string) => void;
  openRow: OpenRow;
  openPlan: (id: string) => void;
}

/** 使ったものを入れる。クレカはクレカ明細、現金は財布、PayPay・口座は口座の口座明細 */
function QuickForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const s = data.settings;
  const cats = budgetCats(s).filter((c) => c !== RESERVE);
  const [cat, setCat] = useState(cats[0]);
  const [amount, setAmount] = useState<number | "">("");
  const [pay, setPay] = useState<Pay>(payOptions(s)[0]);
  const [more, setMore] = useState(false);
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!amount) { toast("金額を入れてください"); return; }
    setBusy(true);
    const card = cardOfPay(pay);
    const group = groupOfCat(s, cat);
    const ok = await store.run(() => card
      ? actions.addCard({ card, status: "confirmed", date, amount, group, category: cat, name, shop })
      : actions.addAccount({ account: pay === "wallet" ? "wallet" : "bank", direction: "out", status: "confirmed", group, category: cat, name: name || (pay === "paypay" ? "PayPayチャージ" : shop), date, amount }));
    setBusy(false);
    if (ok) {
      toast(card === s.cards[0].id ? `${cat} ${yen(amount)}円を入れました。カードのメールが来たら自動でまとめます` : `${cat} ${yen(amount)}円を入れました`);
      setAmount(""); setName(""); setShop(""); setDate(today); setMore(false);
    }
  };

  return (
    <div className="panel quick">
      <div className="grid2">
        <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>
        <Field label="金額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
      </div>
      <div className="seg" role="group" aria-label="払い方">
        {payOptions(s).map((k) => <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}>{payLabels(s)[k]}</button>)}
      </div>
      {more && (
        <>
          <div className="grid2">
            <Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="店"><input value={shop} onChange={(e) => setShop(e.target.value)} /></Field>
          </div>
          <Field label="名称（買ったもの）"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </>
      )}
      <div className="btns">
        <button className="btn" onClick={add} disabled={busy}>入れる</button>
        {!more && <button className="btn ghost" onClick={() => setMore(true)}>日付・店も入れる</button>}
      </div>
    </div>
  );
}

/** ダッシュボード：今月の予算・費目ごとの使った額・使ったものの入力・口座・近い予定・計画 */
export function Dashboard({ store, data, month, today, reviews, go, openRow, openPlan }: Props) {
  const v = computeMonth(data, month, today);
  const f = useMemo(() => forecast(data, today), [data, today]);
  const label = v.when === "past" ? "この月の予算" : v.when === "future" ? `${+month.slice(5)}月の予算` : "今月の予算";
  const vars = v.cats.filter((c) => !c.fixed && (c.budget || c.used || c.planned));
  const fixed = v.cats.filter((c) => c.fixed);
  const fx = { budget: fixed.reduce((a, c) => a + c.budget, 0), used: fixed.reduce((a, c) => a + c.used + c.planned, 0) };
  const ti = f?.days.findIndex((x) => x.date === today) ?? -1;
  const eve = f?.eves.find((d) => d > today);
  const soon = f ? f.rows.filter((r) => r.date > today && !r.entry.id.startsWith("proj:")).slice(0, 5) : [];
  const plans = data.plans.filter((p) => !p.done);

  return (
    <>
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>確認してほしいことが {reviews} 件あります（重複の候補など）。タップで開く</button>}
      {data.missing.length > 0 && <div className="alert bad" style={{ marginBottom: 16 }}>計画と月の予算を使うには、Supabase の SQL Editor で supabase/migrations/0007_plans_months.sql を実行してください。</div>}

      <section>
        <div className="cards">
          <button className="kpi" onClick={() => go("settings")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
            <div className="lb">{label}</div>
            <div className="v num">{money(v.T)}</div>
            <div className="note">使った {money(v.U)}{v.P ? `・予定 ${money(v.P)}` : ""}</div>
          </button>
          <div className={`kpi ${v.R < 0 ? "bad" : "main"}`}>
            <div className="lb">残り予算</div>
            <div className="v num">{money(v.R)}</div>
            <div className="note" style={{ color: "inherit", opacity: .85 }}>{v.R < 0 ? "予算をこえています" : v.daysLeft ? `残り${v.daysLeft}日・1日 ${yen(Math.max(0, Math.floor(v.R / v.daysLeft)))}円` : ""}</div>
          </div>
        </div>
        {v.overAllocated && <div className="alert">費目の予算の合計が、今月の予算を {yen(-v.reserveBudget)}円 こえています。「設定」の予算を見直してください。</div>}
      </section>

      <section>
        <h2>費目ごと <button className="lnk" onClick={() => go("ledger")}>明細</button></h2>
        <div className="panel">
          {vars.map((r) => (
            <button key={r.cat} className="crow" onClick={() => go("ledger", r.cat)}>
              <span className="c">{r.cat}{r.unclassified > 0 && <> <Chip kind="warn">未分類</Chip></>}</span>
              <Bar budget={r.budget} used={r.used} planned={r.planned} />
              <span className={`nb num ${r.rem < 0 ? "neg" : ""}`}>{yen(r.used + r.planned)}<small> / {yen(r.budget)}</small></span>
            </button>
          ))}
          <button className="crow" onClick={() => go("ledger")}>
            <span className="c">固定費</span>
            <Bar budget={fx.budget} used={fx.used} planned={0} />
            <span className={`nb num ${fx.used > fx.budget ? "neg" : ""}`}>{yen(fx.used)}<small> / {yen(fx.budget)}</small></span>
          </button>
        </div>
        {v.unclassified.length > 0 && <button className="alert" onClick={() => go("ledger")}>未分類の明細が {v.unclassified.length} 件あります（予備で数えています）。タップして費目を入れてください。</button>}
      </section>

      {v.when !== "past" && (
        <section>
          <h2>使ったものを入れる</h2>
          <QuickForm store={store} data={data} today={today} />
        </section>
      )}

      <section>
        <h2>口座 <button className="lnk" onClick={() => go("flow")}>見通し</button></h2>
        {f ? (
          <div className="panel">
            <button className="kv tapkv" onClick={() => go("balance")}><span>口座残高</span><b className="num">{money(f.days[ti]?.bank ?? 0)}</b></button>
            <div className="kv"><span>実質残高</span><b className={`num ${(f.days[ti]?.real ?? 0) < 0 ? "neg" : ""}`}>{money(f.days[ti]?.real ?? 0)}</b></div>
            {eve && <div className="kv"><span>{md(eve)}（給料日前日）の見込み</span><b className={`num ${(f.days.find((x) => x.date === eve)?.bank ?? 0) < 0 ? "neg" : ""}`}>{money(f.days.find((x) => x.date === eve)?.bank ?? 0)}</b></div>}
            <FlowChart data={data} f={f} mini onTap={() => go("flow")} />
          </div>
        ) : <button className="panel" onClick={() => go("balance")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", width: "100%" }}><div className="note">口座の残高を入れると、口座の見通しが出ます。タップで入れる</div></button>}
      </section>

      {soon.length > 0 && (
        <section>
          <h2>近い予定</h2>
          <div className="panel"><div className="list">
            {soon.map((r, i) => (
              <button key={r.entry.id + i} className="row" onClick={() => openRow(r.entry)}>
                <span className="d num">{md(r.date)}</span>
                <span className="t"><div>{accountTitle(r.entry)} {r.entry.group === "card" ? <Chip kind={r.entry.locked ? "ok" : "warn"}>{r.entry.locked ? "確定" : "見込み"}</Chip> : r.entry.status === "plan" ? <Chip kind="warn">予定</Chip> : null}</div></span>
                <span className={`a num ${r.delta > 0 ? "pos" : ""}`}>{r.delta > 0 ? "＋" : ""}{signed(r.delta)}</span>
              </button>
            ))}
          </div></div>
        </section>
      )}

      <section>
        <h2>計画 <button className="lnk" onClick={() => go("plans")}>計画</button></h2>
        {plans.length ? (
          <div className="panel"><div className="list">
            {plans.map((p) => { const s = statusText(data, p, f); return (
              <button key={p.id} className="row" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => openPlan(p.id)}>
                <span className="t"><div><KindChip k={p.kind} />{p.name}</div>{p.use_date && <div>{md(p.use_date)}に{p.kind === "repay" ? "返す" : "使う"}</div>}</span>
                <span className={`a num ${s.cls}`}>{yen(s.got)}<small>/ {yen(s.st.need)}</small></span>
              </button>
            ); })}
          </div></div>
        ) : <button className="panel" onClick={() => go("plans")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", width: "100%" }}><div className="note">リボをまとめて返す・大きい買い物・貯金の計画を作れます。タップで計画へ</div></button>}
      </section>
    </>
  );
}
