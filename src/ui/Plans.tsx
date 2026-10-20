import { isLive, ymOf, type Entry } from "../engine";
import type { AppData } from "../data/store";
import { Empty, signed, yen } from "./common";
import { EntryRow } from "./Ledger";

export function Plans({ data, today, onOpen, onAdd }: { data: AppData; today: string; onOpen: (e: Entry) => void; onAdd: (kind: "income" | "expense") => void }) {
  const plans = data.entries.filter((e) => isLive(e) && e.status === "plan").sort((a, b) => a.date.localeCompare(b.date));
  const overdue = plans.filter((e) => e.date < today);
  const coming = plans.filter((e) => e.date >= today);
  const months = [...new Set(coming.map((e) => ymOf(e.date)))];
  const sum = (xs: Entry[]) => xs.reduce((a, e) => a + (e.kind === "income" ? e.amount : -e.amount), 0);

  return (
    <>
      <section>
        <div className="btns">
          <button className="btn" onClick={() => onAdd("income")}>＋ 入金の予定</button>
          <button className="btn ghost" onClick={() => onAdd("expense")}>＋ 出費の予定</button>
        </div>
        <div className="note">給与・賞与・急な入金や、決まっている大きな出費を入れます。入金や支払いがあったら、タップして「確定にする」を押します。カードの出費はメールが来ると自動で予定と照合します。</div>
      </section>
      {overdue.length > 0 && (
        <section>
          <h2>日付が過ぎた予定 <small>確定にするか、消してください</small></h2>
          <div className="panel"><div className="list">{overdue.map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} showCat />)}</div></div>
        </section>
      )}
      {!plans.length && <Empty>予定はありません</Empty>}
      {months.map((ym) => {
        const xs = coming.filter((e) => ymOf(e.date) === ym);
        const inc = xs.filter((e) => e.kind === "income"), exp = xs.filter((e) => e.kind !== "income");
        return (
          <section key={ym}>
            <h2>{+ym.slice(5)}月 <small>入金 {yen(inc.reduce((a, e) => a + e.amount, 0))}・出費 {yen(exp.reduce((a, e) => a + e.amount, 0))}・差 {signed(sum(xs))}</small></h2>
            <div className="panel"><div className="list">{xs.map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} showCat />)}</div></div>
          </section>
        );
      })}
    </>
  );
}
