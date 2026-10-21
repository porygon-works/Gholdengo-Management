import { isLive, ymOf, type Entry } from "../engine";
import type { AppData } from "../data/store";
import { Empty, signed, yen, ymLabel } from "./common";
import { EntryRow } from "./Ledger";

/** 予定の画面。ヘッダーの月で切り替える。今月を見ているときは、日付が過ぎた予定も上に出す */
export function Plans({ data, month, today, onOpen, onAdd }: { data: AppData; month: string; today: string; onOpen: (e: Entry) => void; onAdd: (kind: "income" | "expense") => void }) {
  const plans = data.entries.filter((e) => isLive(e) && e.status === "plan").sort((a, b) => a.date.localeCompare(b.date));
  const current = month === ymOf(today);
  const overdue = current ? plans.filter((e) => e.date < today) : [];
  const xs = plans.filter((e) => ymOf(e.date) === month && !(current && e.date < today));
  const inc = xs.filter((e) => e.kind === "income"), exp = xs.filter((e) => e.kind !== "income");
  const st = data.settings;
  const fixed = exp.filter((e) => e.category && st.fixCats.includes(e.category));
  const variable = exp.filter((e) => !fixed.includes(e) && (!e.category || st.varCats.includes(e.category)));
  const other = exp.filter((e) => !fixed.includes(e) && !variable.includes(e));
  const box = (title: string, ys: Entry[]) => ys.length > 0 && (
    <div className="panel">
      <div className="cathead" style={{ cursor: "default" }}><span className="n">{title}</span><span className="s num">{yen(total(ys))}円</span></div>
      <div className="list">{ys.map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} showCat />)}</div>
    </div>
  );
  const total = (ys: Entry[]) => ys.reduce((a, e) => a + e.amount, 0);

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
      <section>
        <h2>{ymLabel(month)}{current ? "（今日から）" : ""} <small>入金 {yen(total(inc))}・出費 {yen(total(exp))}・差 {signed(total(inc) - total(exp))}</small></h2>
        {xs.length ? (
          <>
            {box("入金", inc)}
            {box("出費：固定費", fixed)}
            {box("出費：変動費", variable)}
            {box("出費：そのほか（返済・予算外など）", other)}
          </>
        ) : <Empty>この月の予定はありません</Empty>}
      </section>
    </>
  );
}
