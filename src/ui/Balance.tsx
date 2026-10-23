import { useState } from "react";
import { accountNow } from "../engine";
import { actions, actions5, type AppData, type Store } from "../data/store";
import { accountTitle, Field, md, NumInput, Sheet, signed, toast, yen } from "./common";

/** 口座：残高を直す・ATM・履歴。財布は管理しない（設計書 §3.6） */
export function BalanceSheet({ store, data, today, onClose }: { store: Store; data: AppData; today: string; onClose: () => void }) {
  const now = accountNow(data, today);
  const cur = { bank: now?.bank ?? 0, wallet: now?.wallet ?? 0 };
  const [bank, setBank] = useState<number | "">("");
  const [atm, setAtm] = useState<number | "">("");
  const [atmDate, setAtmDate] = useState(today);
  const fix = async (which: "bank" | "wallet", v: number | "") => {
    if (v === "") { toast("本当の残高を入れてください"); return; }
    if (await store.run(() => actions.fixBalance(today, cur, which, v))) { toast(which === "bank" ? "口座の残高を直しました" : "財布の残高を直しました"); setBank(""); }
  };
  const addAtm = async () => {
    if (!atm) { toast("引き出した額を入れてください"); return; }
    if (await store.run(() => actions5.addAtm(atmDate, atm))) { toast(`現金 ${yen(atm)}円を、使ったものとして入れました`); setAtm(""); }
  };
  const hist = [...data.balances].sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 10);
  return (
    <Sheet title="口座" onClose={onClose}>
      <div className="cards">
        <div className="kpi"><div className="lb">口座残高（いま）</div><div className="v num">{now ? yen(cur.bank) : "―"}<small>円</small></div></div>
      </div>
      <div className="note">{now ? `${md(now.base.date)}に入れた残高に、そのあとの確定した口座明細を足し引きした額です。クレカで使ったものは、引落日に「クレカ支払い」で口座から減ります。` : "まだ残高がありません。下で入れてください。"}</div>

      <h2>残高を直す <small>通帳やアプリを見て、本当の額を入れる</small></h2>
      <div className="grid2">
        <Field label="口座の本当の残高"><NumInput value={bank} onChange={setBank} /></Field>
        <div className="btns"><button className="btn sm" onClick={() => fix("bank", bank)}>口座を直す</button></div>
      </div>

      <h2>ATMで引き出した <small>引き出した額を、その日に使ったもの（費目「現金」）にする</small></h2>
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
              <td style={{ textAlign: "left" }}>口座 {yen(b.bank)}{b.memo && <div className="note">{b.memo}</div>}</td>
              <td><button className="btn sm danger" onClick={async () => { if (confirm("この記録を消しますか？")) await store.run(() => actions.deleteBalance(b.id)); }}>消す</button></td>
            </tr>
          ))}</tbody></table>
        </>
      )}
      <div className="btns"><button className="btn ghost" onClick={onClose}>閉じる</button></div>
    </Sheet>
  );
}
