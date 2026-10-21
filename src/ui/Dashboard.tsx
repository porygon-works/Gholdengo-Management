import { useState } from "react";
import { budgetCats, cashLimit, computeMonth, dipBefore, latestBalance, balanceTotal, RESERVE, type Method } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { Bar, Chip, Field, md, METHOD_LABEL, NumInput, QUICK_METHODS, Select, signed, toast, yen } from "./common";

interface Props {
  store: Store;
  data: AppData;
  month: string;
  today: string;
  reviews: number;
  go: (to: "ledger" | "review" | "passbook" | "balance", cat?: string) => void;
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
  const bal = latestBalance(data.balances);
  const s = data.settings;
  const usedPlanned = v.U + v.P;
  const rows = v.cats.filter((c) => c.budget || c.used || c.planned);
  const cash = v.when === "current" ? cashLimit(data, today) : null;
  const dip = v.when === "current" ? dipBefore(data, today) : null;

  return (
    <>
      {v.noBalance && (
        <button className="alert bad" onClick={() => go("balance")}>口座の残高がまだ入っていません。タップして今の残高を入れると、使える額が出ます。</button>
      )}
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>確認してほしいことが {reviews} 件あります（重複の候補など）。タップで開く</button>}

      <section>
        <div className="cards">
          <div className="kpi">
            <div className="lb">{v.when === "past" ? "この月の予算" : v.when === "future" ? `${+month.slice(5)}月に使える予算` : "今月使える予算"}</div>
            <div className="v num">{v.T == null ? "―" : signed(v.T)}<small>円</small></div>
            <div className="note">使った {yen(v.U)}・予定 {yen(v.P)}</div>
          </div>
          <div className={`kpi ${v.R != null && v.R < 0 ? "bad" : "main"}`}>
            <div className="lb">残り予算<span>{v.when === "past" ? "" : `残り${v.daysLeft}日`}</span></div>
            <div className="v num">{v.when === "past" ? signed((v.T ?? 0) - usedPlanned) : v.R == null ? "―" : signed(v.R)}<small>円</small></div>
            <div className="note" style={{ color: "inherit", opacity: .85 }}>{v.R != null && v.R < 0 ? "このままだと引落日に口座が足りません" : v.R != null && v.daysLeft ? `1日あたり ${yen(Math.max(0, Math.floor(v.R / v.daysLeft)))}円` : ""}</div>
          </div>
        </div>
        {v.T != null && v.T > 0 && <Bar budget={v.T} used={v.U} planned={v.P} />}
        {dip && <div className="alert bad">{md(dip.date)}に口座が {signed(dip.value)}円 になる見込みです（カードの引落日より前。これから使う額に関係なく足りません）。入金の予定や引落を確かめてください。</div>}
        {cash && v.R != null && cash.value < v.R && <div className="alert">現金・PayPay で使うなら {signed(Math.max(0, cash.value))}円 までです（すぐ口座から出るため。{md(cash.date)}がいちばん少ない日）。</div>}
        {v.overAllocated && <div className="alert">費目の予算の合計が、使える予算を {yen(-v.reserveBudget)}円 こえています。「設定」の予算を見直してください。</div>}
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
          <h2>口座の見通し <button className="btn ghost sm" onClick={() => go("passbook")}>通帳の形で見る</button></h2>
          <div className="panel">
            {bal ? (
              <>
                <div className="legend" style={{ justifyContent: "space-between" }}>
                  <span>いまの資産（{md(bal.date)}に報告）</span>
                  <b className="num">{yen(balanceTotal(bal))}円</b>
                </div>
                {v.min && (
                  <div className="legend" style={{ justifyContent: "space-between" }}>
                    <span>この月のカード引落（{md(v.payDate)}）のあと、いちばん少ない日 {md(v.min.date)}</span>
                    <b className={`num ${v.min.value < s.safety ? "neg" : ""}`}>{signed(v.min.value)}円</b>
                  </div>
                )}
                <div className="note">残り予算は「残りをカードで使っても、{md(v.payDate)}の引落から次の引落までの間、口座が安全残高（{yen(s.safety)}円）を下回らない額」です。使った分だけ減ります。</div>
              </>
            ) : <div className="note">残高がまだありません。</div>}
            <div className="btns"><button className="btn ghost sm" onClick={() => go("balance")}>今の残高を入れる</button></div>
          </div>
        </section>
      )}
    </>
  );
}
