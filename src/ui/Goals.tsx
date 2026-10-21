import { useState } from "react";
import { addMonths, balanceTotal, cardPayDate, forecast, latestBalance, monthBase, passbook, paydayChecks, ymOf } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { Chip, Empty, Field, md, NumInput, Sheet, signed, toast, yen, ymLabel } from "./common";

export function Goals({ data, today }: { data: AppData; today: string }) {
  const s = data.settings;
  const debts = data.debts;
  const known = debts.filter((d) => !d.planned).reduce((a, d) => a + d.balance, 0);
  const fc = forecast(data, today, 3);
  const checks = paydayChecks(data, today, 3);
  const goal = monthBase(data, ymOf(today)).goal;
  const minPay = debts.filter((d) => !d.planned).reduce((a, d) => a + d.min_payment, 0);

  return (
    <>
      <section>
        <h2>① リボ・分割の残高を0にする <small>いま {yen(known)}円</small></h2>
        <div className="panel">
          {debts.length ? <div className="list">{debts.map((d) => (
            <div className="row" key={d.id} style={{ gridTemplateColumns: "1fr auto", cursor: "default" }}>
              <span className="t"><div>{d.name} {d.planned && <Chip kind="warn">予定</Chip>}</div><div>{d.note}</div></span>
              <span className="a num">{yen(d.balance)}</span>
            </div>))}</div> : <div className="note">借金は入っていません（設定→借金）</div>}
          {minPay > goal && <div className="alert">今月の目標用マイナス（{yen(goal)}円）が、最低返済額の合計（{yen(minPay)}円）より少ないです。</div>}
        </div>
      </section>
      <section>
        <h2>② 引落日に口座が足りない月を0にする <small>その月の予算を全部使った場合</small></h2>
        {fc ? (
          <div className="panel scroll">
            <table className="tbl">
              <thead><tr><th>予算の月</th><th>使える額</th><th>少ない日</th><th>判定</th></tr></thead>
              <tbody>{fc.map((f) => {
                const st = f.R < 0 ? (["bad", "足りない"] as const) : f.R < 10000 ? (["warn", "うすい"] as const) : (["ok", "OK"] as const);
                return <tr key={f.ym}><td>{+f.ym.slice(5)}月<div className="note">{md(f.from)}〜{md(f.to)}</div></td><td className={`num ${f.R < 0 ? "neg" : ""}`}>{signed(f.R)}</td><td className="num">{md(f.min.date)}</td><td><Chip kind={st[0]}>{st[1]}</Chip></td></tr>;
              })}</tbody>
            </table>
            <div className="note">それぞれの月の予算をカードで全部使い、その引落日から次の引落日まで口座が足りるかを見ています。前の月の分は引いてあります。まだ分からない現金の出費は入っていません。</div>
          </div>
        ) : <Empty>残高を入れると出ます</Empty>}
      </section>
      <section>
        <h2>③ 給料日前日に目標の残高を残す <small>目標 {yen(s.reserveGoal)}円</small></h2>
        <div className="panel">
          {checks.length ? checks.map((c) => {
            const r = Math.max(0, Math.min(100, (c.value / s.reserveGoal) * 100));
            return (
              <div key={c.date} style={{ display: "grid", gap: 4 }}>
                <div className="legend" style={{ justifyContent: "space-between" }}><span>{md(c.date)}</span><b className="num">{signed(c.value)}円（{Math.round(r)}%）</b></div>
                <div className="bar"><i className="u" style={{ width: `${r}%` }} /></div>
              </div>
            );
          }) : <div className="note">給与の定期のお金と残高を入れると出ます</div>}
        </div>
      </section>
    </>
  );
}

export function Passbook({ data, today }: { data: AppData; today: string }) {
  const to = cardPayDate(addMonths(ymOf(today), 1), data.settings);
  const pb = passbook(data, today, to);
  if (!pb) return <Empty>残高を入れると出ます</Empty>;
  return (
    <section>
      <h2>口座の動き <small>{md(pb.base.date)}の報告〜{md(to)}・予定を含む</small></h2>
      <div className="panel scroll">
        <table className="tbl">
          <thead><tr><th>日付</th><th>摘要</th><th>お支払</th><th>お預り</th><th>残高</th></tr></thead>
          <tbody>
            <tr><td className="num">{md(pb.base.date)}</td><td className="memo">残高（報告）</td><td /><td /><td className="num">{yen(balanceTotal(pb.base))}</td></tr>
            {pb.rows.map((r, i) => (
              <tr key={i}>
                <td className="num">{md(r.date)}</td>
                <td className="memo">{r.label}{r.count > 1 && <span className="note">（明細 {r.count}件）</span>}{r.entry?.status === "plan" && <> <Chip kind="warn">予定</Chip></>}{r.bill && <> <Chip kind="ok">請求額</Chip>{r.cardSum != null && r.cardSum !== -r.delta && <div className="note">明細の合計 {yen(r.cardSum)}円（差 {signed(-r.delta - r.cardSum)}円。入っていない明細があるかもしれません）</div>}</>}</td>
                <td className="num">{r.delta < 0 ? yen(-r.delta) : ""}</td>
                <td className="num pos">{r.delta > 0 ? yen(r.delta) : ""}</td>
                <td className={`num ${r.balance < 0 ? "neg" : ""}`}>{signed(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note">カードの明細は引落日にまとめて出ます。カードの請求額が届いた月は、明細の合計の代わりに請求額を使います。「残り予算」の分はここには入っていません。</div>
    </section>
  );
}

export function BalanceSheet({ store, data, today, onClose }: { store: Store; data: AppData; today: string; onClose: () => void }) {
  const last = latestBalance(data.balances);
  const [date, setDate] = useState(today);
  const [bank, setBank] = useState<number | "">("");
  const [cash, setCash] = useState<number | "">(last?.cash ?? "");
  const save = async () => {
    if (bank === "") { toast("口座の残高を入れてください"); return; }
    if (await store.run(() => actions.addBalance({ date, bank, cash: cash || 0, paypay: 0, memo: "" }))) { toast("残高を更新しました"); onClose(); }
  };
  const hist = [...data.balances].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return (
    <Sheet title="今の残高を入れる" onClose={onClose}>
      <Field label="日付" hint="この日の終わりの残高として扱います"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="口座"><NumInput value={bank} onChange={setBank} autoFocus /></Field>
      <Field label="現金（財布）"><NumInput value={cash} onChange={setCash} /></Field>
      <div className="note">PayPay と交通系は、チャージしたときに使ったものとして数えるので、残高は入れません。</div>
      <div className="btns"><button className="btn" onClick={save}>保存</button><button className="btn ghost" onClick={onClose}>やめる</button></div>
      {hist.length > 0 && (
        <table className="tbl"><tbody>{hist.map((b) => (
          <tr key={b.id}><td>{md(b.date)}</td><td className="num">口座 {yen(b.bank)}</td><td className="num">計 {yen(balanceTotal(b))}</td>
            <td><button className="btn sm danger" onClick={async () => { if (confirm("この報告を消しますか？")) await store.run(() => actions.deleteBalance(b.id)); }}>消す</button></td></tr>
        ))}</tbody></table>
      )}
      <div className="note">{ymLabel(ymOf(today))}：給料日など、口座を見たときに入れてください。</div>
    </Sheet>
  );
}
