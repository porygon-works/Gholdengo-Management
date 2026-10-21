import { useState } from "react";
import { accountFlow, accountNow, addMonths, cardPayDate, goalOutlook, ymOf } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { accountTitle, Chip, Empty, Field, md, NumInput, Sheet, signed, toast, yen, ymLabel } from "./common";
import type { Open } from "./Sheets";

/** 目標の見通し（§5.7）。目標マスタは設定で直す */
export function GoalsView({ data, today }: { data: AppData; today: string }) {
  const out = goalOutlook(data, ymOf(today), 36);
  if (!out.length) return <Empty>目標がありません。設定→目標で入れてください</Empty>;
  return (
    <>
      {out.map((o) => (
        <section key={o.goal.id}>
          <h2>{o.goal.name} <small>{o.goal.kind === "repay" ? `残高 ${yen(o.goal.balance)}円` : `目標 ${yen(o.goal.target)}円`}・毎月 {yen(o.goal.monthly)}円</small></h2>
          <div className="panel scroll">
            <div className="legend" style={{ justifyContent: "space-between" }}><span>{o.goal.kind === "repay" ? "0 になる月" : "目標額に届く月"}</span><b>{o.doneYm ? ymLabel(o.doneYm) : "36か月では届かない"}</b></div>
            <table className="tbl">
              <thead><tr><th>月</th><th>毎月</th><th>臨時</th><th>{o.goal.kind === "repay" ? "残り" : "たまった額"}</th></tr></thead>
              <tbody>{o.months.filter((m, i) => i < 13 || m.pay || m.lump).slice(0, 18).map((m) => (
                <tr key={m.ym}><td>{m.ym.slice(2, 4)}/{+m.ym.slice(5)}</td><td className="num">{m.pay ? yen(m.pay) : "―"}</td><td className="num">{m.lump ? yen(m.lump) : "―"}</td><td className="num">{yen(m.left)}</td></tr>
              ))}</tbody>
            </table>
            <div className="note">利息・手数料は入れていません。</div>
          </div>
        </section>
      ))}
    </>
  );
}

/** 口座の見通し（通帳の形）：いまの口座残高から、来月の引落日のあとまで */
export function Passbook({ data, today, onOpen }: { data: AppData; today: string; onOpen: (o: Open) => void }) {
  const to = cardPayDate(addMonths(ymOf(today), 1), data.settings);
  const f = accountFlow(data, today, to);
  if (!f) return <Empty>残高を入れると出ます</Empty>;
  return (
    <section>
      <h2>口座の動き <small>今日〜{md(to)}の前日・予定を含む</small></h2>
      <div className="panel scroll">
        <table className="tbl">
          <thead><tr><th>日付</th><th style={{ textAlign: "left" }}>摘要</th><th>お支払</th><th>お預り</th><th>残高</th></tr></thead>
          <tbody>
            <tr><td className="num">{md(today)}</td><td className="memo">口座残高（いま）</td><td /><td /><td className="num">{yen(f.now.bank)}</td></tr>
            {f.rows.map((r) => (
              <tr key={r.entry.id} className="tap" onClick={() => onOpen({ type: "account", entry: r.entry })}>
                <td className="num">{md(r.date)}</td>
                <td className="memo">{accountTitle(r.entry)}{r.entry.status === "plan" && <> <Chip kind="warn">{r.entry.group === "card" ? "見込み" : "予定"}</Chip></>}</td>
                <td className="num">{r.delta < 0 ? yen(-r.delta) : ""}</td>
                <td className="num pos">{r.delta > 0 ? yen(r.delta) : ""}</td>
                <td className={`num ${r.balance < 0 ? "neg" : ""}`}>{signed(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
