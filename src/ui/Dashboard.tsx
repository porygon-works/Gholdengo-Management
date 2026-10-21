import { useState } from "react";
import { budgetCats, computeMonth, dipBefore, latestBalance, balanceTotal, RESERVE, type Method } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { Bar, Chip, Field, md, METHOD_LABEL, NumInput, QUICK_METHODS, Select, signed, toast, yen } from "./common";

interface Props {
  store: Store;
  data: AppData;
  month: string;
  today: string;
  reviews: number;
  go: (to: "ledger" | "review" | "passbook" | "balance" | "settings", cat?: string) => void;
}

function QuickForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const cats = budgetCats(data.settings).filter((c) => c !== RESERVE);
  const [cat, setCat] = useState(cats[0]);
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<Method>("cash");
  const [more, setMore] = useState(false);
  const [date, setDate] = useState(today);
  const [item, setItem] = useState("");
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!amount) { toast("金額を入れてください"); return; }
    setBusy(true);
    const ok = await store.run(() => actions.addEntry({ kind: "expense", status: "confirmed", date, amount, method, category: cat, item, shop }));
    setBusy(false);
    if (ok) {
      toast(method === "card" ? `${cat} ${yen(amount)}円を入れました。カードのメールが来たら自動でまとめます` : `${cat} ${yen(amount)}円を入れました`);
      setAmount(""); setItem(""); setShop(""); setDate(today); setMore(false);
    }
  };

  return (
    <div className="panel quick">
      <div className="grid2">
        <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>
        <Field label="金額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
      </div>
      <div className="seg" role="group" aria-label="金種">
        {QUICK_METHODS.map((m) => <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>)}
      </div>
      {more && (
        <>
          <div className="grid2">
            <Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="お店"><input value={shop} onChange={(e) => setShop(e.target.value)} /></Field>
          </div>
          <Field label="買ったもの"><input value={item} onChange={(e) => setItem(e.target.value)} /></Field>
        </>
      )}
      <div className="btns">
        <button className="btn" onClick={add} disabled={busy}>入れる</button>
        {!more && <button className="btn ghost" onClick={() => setMore(true)}>日付・お店も入れる</button>}
      </div>
    </div>
  );
}

export function Dashboard({ store, data, month, today, reviews, go }: Props) {
  const v = computeMonth(data, month, today);
  const b = v.base;
  const bal = latestBalance(data.balances);
  const rows = v.cats.filter((c) => c.budget || c.used || c.planned);
  // 口座の残高から見た「出金の予定に対して足りなくなる日」だけを警告に使う（口座からの計算はいったんここまで）
  const dip = v.when === "current" ? dipBefore(data, today) : null;
  const label = v.when === "past" ? "この月の予算" : v.when === "future" ? `${+month.slice(5)}月の予算` : "今月の予算";

  return (
    <>
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>確認してほしいことが {reviews} 件あります（重複の候補など）。タップで開く</button>}

      <section>
        <div className="cards">
          <div className="kpi">
            <div className="lb">{label}</div>
            <div className="v num">{signed(v.T)}<small>円</small></div>
            <div className="note">使った {yen(v.U)}・予定 {yen(v.P)}</div>
          </div>
          <div className={`kpi ${v.R < 0 || dip ? "bad" : "main"}`}>
            <div className="lb">自由に使える残り</div>
            <div className="v num">{signed(v.R)}<small>円</small></div>
            <div className="note" style={{ color: "inherit", opacity: .85 }}>{dip ? `${md(dip.date)}に口座が足りません。先に入金が必要です` : v.R < 0 ? "予算をこえています" : v.daysLeft ? `残り${v.daysLeft}日・1日 ${yen(Math.max(0, Math.floor(v.R / v.daysLeft)))}円` : ""}</div>
          </div>
        </div>
        {v.T > 0 && <Bar budget={v.T} used={v.U} planned={v.P} />}
        <button className="panel" onClick={() => go("settings")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
          <div className="legend" style={{ justifyContent: "space-between" }}><span>給与</span><b className="num">{yen(b.salary)}</b></div>
          {b.extra !== 0 && <div className="legend" style={{ justifyContent: "space-between" }}><span>＋ 追加予算</span><b className="num">{yen(b.extra)}</b></div>}
          <div className="legend" style={{ justifyContent: "space-between" }}><span>− 固定費（家賃・奨学金など）</span><b className="num">{yen(b.fixed)}</b></div>
          <div className="legend" style={{ justifyContent: "space-between" }}><span>− 目標用マイナス（リボの返済・貯金）</span><b className="num">{yen(b.goal)}</b></div>
          <div className="note">タップすると設定で直せます</div>
        </button>
        {dip && <div className="alert bad">{md(dip.date)}に口座が {signed(dip.value)}円 になる見込みです。出金の予定に対して {yen(data.settings.safety - dip.value)}円 足りません。それまでに入金するか、引落の予定を確かめてください。</div>}
        {v.overAllocated && <div className="alert">費目の予算の合計が、今月の予算を {yen(-v.reserveBudget)}円 こえています。「設定」の予算を見直してください。</div>}
      </section>

      {v.when !== "past" && (
        <section>
          <h2>使ったものを入れる <small>カードはメールから自動で入ります</small></h2>
          <QuickForm store={store} data={data} today={today} />
        </section>
      )}

      <section>
        <h2>費目ごとの予算 <small>タップで明細</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>費目</th><th>予算</th><th>使った＋予定</th><th>残り</th>{v.when !== "past" && <th>1日あたり</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cat} className="tap" onClick={() => go("ledger", r.cat)}>
                  <td>{r.cat}{r.unclassified > 0 && <> <Chip kind="warn">未分類 {yen(r.unclassified)}</Chip></>}</td>
                  <td className="num">{yen(r.budget)}</td>
                  <td className="num">{yen(r.used)}{r.planned ? <span className="note">＋{yen(r.planned)}</span> : null}</td>
                  <td className={`num ${r.rem < 0 ? "neg" : ""}`}>{signed(r.rem)}</td>
                  {v.when !== "past" && <td className="num"><b>{r.daily == null ? "―" : yen(r.daily)}</b></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v.unclassified.length > 0 && <button className="alert" onClick={() => go("ledger")}>未分類の明細が {v.unclassified.length} 件あります（予備で数えています）。タップして費目を入れてください。</button>}
      </section>

      {v.when !== "past" && (
        <section>
          <h2>口座 <button className="btn ghost sm" onClick={() => go("passbook")}>口座の見通し</button></h2>
          <div className="panel">
            {bal ? (
              <div className="legend" style={{ justifyContent: "space-between" }}>
                <span>いまの残高（{md(bal.date)}に報告・口座＋現金）</span>
                <b className="num">{yen(balanceTotal(bal))}円</b>
              </div>
            ) : <div className="note">残高を入れると、出金の予定に対して口座が足りなくなる日を知らせます。</div>}
            <div className="btns"><button className="btn ghost sm" onClick={() => go("balance")}>今の残高を入れる</button></div>
          </div>
        </section>
      )}
    </>
  );
}
