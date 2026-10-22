import { useState } from "react";
import { accountNow } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { accountTitle, Field, md, NumInput, Sheet, signed, toast, yen } from "./common";

/** 口座と財布：残高を直す・ATM・履歴 */
export function BalanceSheet({ store, data, today, onClose }: { store: Store; data: AppData; today: string; onClose: () => void }) {
  const now = accountNow(data, today);
  const cur = { bank: now?.bank ?? 0, wallet: now?.wallet ?? 0 };
  const [bank, setBank] = useState<number | "">("");
  const [wallet, setWallet] = useState<number | "">("");
  const [atm, setAtm] = useState<number | "">("");
  const [atmDate, setAtmDate] = useState(today);
  const fix = async (which: "bank" | "wallet", v: number | "") => {
    if (v === "") { toast("本当の残高を入れてください"); return; }
    if (await store.run(() => actions.fixBalance(today, cur, which, v))) { toast(which === "bank" ? "口座の残高を直しました" : "財布の残高を直しました"); if (which === "bank") setBank(""); else setWallet(""); }
  };
  const addAtm = async () => {
    if (!atm) { toast("引き出した額を入れてください"); return; }
    if (await store.run(() => actions.addAtm(atmDate, atm))) { toast(`口座から財布へ ${yen(atm)}円`); setAtm(""); }
  };
  const hist = [...data.balances].sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 10);
  return (
    <Sheet title="口座と財布" onClose={onClose}>
      <div className="cards">
        <div className="kpi"><div className="lb">口座（いま）</div><div className="v num">{now ? yen(cur.bank) : "―"}<small>円</small></div></div>
        <div className="kpi"><div className="lb">財布（いま）</div><div className="v num">{now ? yen(cur.wallet) : "―"}<small>円</small></div></div>
      </div>
      <div className="note">{now ? `${md(now.base.date)}に入れた残高に、そのあとの確定した口座明細を足し引きした額です。クレカで使ったものは、引落日に「クレカ支払い」で口座から減ります。` : "まだ残高がありません。下で入れてください。"}</div>

      <h2>残高を直す <small>通帳やアプリを見て、本当の額を入れる</small></h2>
      <div className="grid2">
        <Field label="口座の本当の残高"><NumInput value={bank} onChange={setBank} /></Field>
        <div className="btns"><button className="btn sm" onClick={() => fix("bank", bank)}>口座を直す</button></div>
        <Field label="財布の本当の残高"><NumInput value={wallet} onChange={setWallet} /></Field>
        <div className="btns"><button className="btn sm" onClick={() => fix("wallet", wallet)}>財布を直す</button></div>
      </div>

      <h2>ATMで引き出した <small>口座が減り、財布が増える</small></h2>
      <div className="grid2">
        <Field label="日付"><input type="date" value={atmDate} onChange={(e) => setAtmDate(e.target.value)} /></Field>
        <Field label="額"><NumInput value={atm} onChange={setAtm} /></Field>
      </div>
      <div className="btns"><button className="btn sm" onClick={addAtm}>入れる</button></div>

      {now && now.rows.length > 0 && (
        <>
          <h2>{md(now.base.date)}に入れてからの口座の動き</h2>
          <table className="tbl">
            <tbody>
              <tr><td className="num">{md(now.base.date)}</td><td style={{ textAlign: "left" }}>入れた残高</td><td /><td className="num">{yen(now.base.bank)}</td></tr>
              {now.rows.map((r) => <tr key={r.entry.id}><td className="num">{md(r.date)}</td><td style={{ textAlign: "left" }}>{accountTitle(r.entry)}</td><td className={`num ${r.delta < 0 ? "neg" : ""}`}>{r.delta > 0 ? "＋" : "−"}{yen(Math.abs(r.delta))}</td><td className="num">{signed(r.balance)}</td></tr>)}
            </tbody>
          </table>
        </>
      )}

      {hist.length > 0 && (
        <>
          <h2>残高を入れた・直した履歴</h2>
          <table className="tbl"><tbody>{hist.map((b) => (
            <tr key={b.id}>
              <td className="num">{md(b.date)}</td>
              <td style={{ textAlign: "left" }}>口座 {yen(b.bank)}・財布 {yen(b.cash)}{b.memo && <div className="note">{b.memo}</div>}</td>
              <td><button className="btn sm danger" onClick={async () => { if (confirm("この記録を消しますか？")) await store.run(() => actions.deleteBalance(b.id)); }}>消す</button></td>
            </tr>
          ))}</tbody></table>
        </>
      )}
      <div className="btns"><button className="btn ghost" onClick={onClose}>閉じる</button></div>
    </Sheet>
  );
}
