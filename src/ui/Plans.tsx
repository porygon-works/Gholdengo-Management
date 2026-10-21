import { isLive, ymOf, type AccountEntry, type CardEntry } from "../engine";
import type { AppData } from "../data/store";
import { Empty, ownCost, signed, yen, ymLabel } from "./common";
import { AccountRow, CardRow } from "./Ledger";
import type { Open } from "./Sheets";

/** 予定の画面。ヘッダーの月で切り替える。今月を見ているときは、日付が過ぎた手入力の予定も上に出す */
export function Plans({ data, month, today, onOpen, onAdd }: { data: AppData; month: string; today: string; onOpen: (o: Open) => void; onAdd: () => void }) {
  const current = month === ymOf(today);
  const acc = data.accounts.filter((e) => e.status === "plan" && e.group !== "card").sort((a, b) => a.date.localeCompare(b.date));
  const cards = data.cards.filter((e) => isLive(e) && e.status === "plan").sort((a, b) => a.date.localeCompare(b.date));
  const overdue = current ? acc.filter((e) => e.date < today && e.source === "manual") : [];
  const inM = (e: { date: string }) => ymOf(e.date) === month && !(current && e.date < today);
  const a = acc.filter(inM), c = cards.filter(inM);
  const inc = a.filter((e) => e.direction === "in");
  const fixed = { a: a.filter((e) => e.direction === "out" && e.group === "fixed"), c: c.filter((e) => e.group === "fixed") };
  const variable = { a: a.filter((e) => e.direction === "out" && e.group === "variable"), c: c.filter((e) => e.group === "variable") };
  const other = { a: a.filter((e) => e.direction === "out" && e.group !== "fixed" && e.group !== "variable"), c: c.filter((e) => e.group !== "fixed" && e.group !== "variable") };
  const sum = (x: { a: AccountEntry[]; c: CardEntry[] }) => x.a.reduce((s, e) => s + e.amount, 0) + x.c.reduce((s, e) => s + ownCost(e), 0);
  const box = (title: string, x: { a: AccountEntry[]; c: CardEntry[] }) => (x.a.length + x.c.length > 0) && (
    <div className="panel">
      <div className="cathead" style={{ cursor: "default" }}><span className="n">{title}</span><span className="s num">{yen(sum(x))}円</span></div>
      <div className="list">{x.c.map((e) => <CardRow key={e.id} e={e} data={data} onOpen={onOpen} showCat />)}{x.a.map((e) => <AccountRow key={e.id} e={e} onOpen={onOpen} showCat />)}</div>
    </div>
  );
  const out = sum(fixed) + sum(variable) + sum(other), income = inc.reduce((s, e) => s + e.amount, 0);

  return (
    <>
      <section>
        <div className="btns"><button className="btn" onClick={onAdd}>追加</button></div>
        <div className="note">給与・賞与・急な入金や、決まっている大きな出費を入れます。定期マスタと目標マスタから作った予定は、計上日が来たら自動で確定になります（三井の予定は、メールの明細とまとまります）。</div>
      </section>
      {overdue.length > 0 && (
        <section>
          <h2>日付が過ぎた予定 <small>確定にするか、消してください</small></h2>
          <div className="panel"><div className="list">{overdue.map((e) => <AccountRow key={e.id} e={e} onOpen={onOpen} showCat />)}</div></div>
        </section>
      )}
      <section>
        <h2>{ymLabel(month)}{current ? "（今日から）" : ""} <small>入金 {yen(income)}・出費 {yen(out)}・差 {signed(income - out)}</small></h2>
        {a.length + c.length ? (
          <>
            {box("入金", { a: inc, c: [] })}
            {box("出費：固定費", fixed)}
            {box("出費：変動費", variable)}
            {box("出費：そのほか（立替・分割・その他）", other)}
          </>
        ) : <Empty>この月の予定はありません</Empty>}
      </section>
    </>
  );
}
