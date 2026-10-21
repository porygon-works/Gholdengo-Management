import { useMemo, useState } from "react";
import { addMonths, monthlyFor, planGoals, ymOf } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { Field, NumInput, signed, toast, yen, ymLabel } from "./common";

type Mode = "monthly" | "by";

/** 計画をつくる：リボ・分割を返し終えて、給料日前日に目標の額を残すまでの、毎月の目標用マイナスを決める */
export function Planner({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const s = data.settings;
  const from = ymOf(today);
  const debt = data.debts.reduce((a, x) => a + x.balance, 0);
  const [mode, setMode] = useState<Mode>("monthly");
  const [monthly, setMonthly] = useState<number | "">(s.savingMonthly || 20000);
  const [by, setBy] = useState(addMonths(from, 12));
  const [useBonus, setUseBonus] = useState(true);
  const [saved, setSaved] = useState<number | "">(0);
  const [target, setTarget] = useState<number | "">(s.reserveGoal || s.salaryEstimate || 0);

  const base = { from, useBonus, saved: Number(saved) || 0, target: Number(target) || 0 };
  const need = useMemo(() => (mode === "by" ? monthlyFor(data, base, by) : null), [mode, by, useBonus, saved, target, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = mode === "by" ? need ?? 0 : Number(monthly) || 0;
  const r = useMemo(() => planGoals(data, { ...base, monthly: m }), [m, useBonus, saved, target, data]); // eslint-disable-line react-hooks/exhaustive-deps
  // 表は、目標に届いた月まで（届かなければ24か月）
  const last = r.reachYm ?? addMonths(from, 23);
  const rows = r.rows.filter((x) => x.ym <= last);

  const apply = async () => {
    if (!confirm(`${ymLabel(from)}〜${ymLabel(last)}の目標用マイナスを、この計画の額にしますか？（手で直した月も上書きします）`)) return;
    const ok = await store.run(async () => {
      for (const x of rows) await actions.saveBase(x.ym, "goal", x.put);
      // 計画のあとの月も、同じ額を毎月の貯金として続ける
      await actions.saveSettings({ ...s, savingMonthly: m, savingStart: addMonths(last, 1), reserveGoal: Number(target) || s.reserveGoal });
    });
    if (ok) toast("計画を目標用マイナスに入れました");
  };

  return (
    <>
      <section>
        <h2>目標</h2>
        <div className="panel">
          <div className="legend" style={{ justifyContent: "space-between" }}><span>① リボ・分割を 0 にする（予定のものも含む）</span><b className="num">いま {yen(debt)}円</b></div>
          <Field label="② 給料日前日に残したい額（手取り1か月分など）"><NumInput value={target} onChange={setTarget} /></Field>
          <Field label="今の貯金（目標に数える、もう残してあるお金）"><NumInput value={saved} onChange={setSaved} /></Field>
          <label className="check"><input type="checkbox" checked={useBonus} onChange={(e) => setUseBonus(e.target.checked)} />予定に入っている賞与を、全額リボの返済と貯金に回す</label>
        </div>
      </section>
      <section>
        <h2>決め方</h2>
        <div className="seg" role="tablist">
          <button role="tab" aria-pressed={mode === "monthly"} onClick={() => setMode("monthly")}>毎月の額から</button>
          <button role="tab" aria-pressed={mode === "by"} onClick={() => setMode("by")}>達成したい月から</button>
        </div>
        <div className="panel">
          {mode === "monthly" ? (
            <Field label="毎月回す額（目標用マイナス）" hint="リボの返済の予定がこれより多い月は、その額にします"><NumInput value={monthly} onChange={setMonthly} /></Field>
          ) : (
            <>
              <Field label="達成したい月（②の額が貯まる月）"><input type="month" value={by} min={from} onChange={(e) => setBy(e.target.value || by)} /></Field>
              <div className="legend" style={{ justifyContent: "space-between" }}><span>そのために毎月回す額</span><b className="num">{need == null ? "36か月以内には届きません" : `${yen(need)}円`}</b></div>
            </>
          )}
        </div>
      </section>
      <section>
        <h2>結果 <small>利息・手数料は入れていません</small></h2>
        <div className="panel">
          <div className="legend" style={{ justifyContent: "space-between" }}><span>リボ・分割が 0 になる</span><b>{r.payoffYm ? ymLabel(r.payoffYm) : "36か月では0にならない"}</b></div>
          <div className="legend" style={{ justifyContent: "space-between" }}><span>② の額に届く</span><b>{r.reachYm ? ymLabel(r.reachYm) : "36か月では届かない"}</b></div>
          <div className="legend" style={{ justifyContent: "space-between" }}><span>その間の自由に使えるお金（いちばん少ない月）</span><b className={`num ${r.minFree < 0 ? "neg" : ""}`}>{signed(r.minFree)}円</b></div>
          {r.minFree < 0 && <div className="alert bad">自由に使えるお金がマイナスになる月があります。毎月回す額を減らすか、達成したい月を遅くしてください。</div>}
          <div className="scroll">
            <table className="tbl">
              <thead><tr><th>月</th><th>回す</th><th>賞与</th><th>リボの残り</th><th>貯金</th><th>自由に使える</th></tr></thead>
              <tbody>{rows.map((x) => (
                <tr key={x.ym}><td>{x.ym.slice(2, 4)}/{+x.ym.slice(5)}</td><td className="num">{yen(x.put)}</td><td className="num">{x.bonus ? yen(x.bonus) : "―"}</td><td className="num">{yen(x.debtLeft)}</td><td className="num">{yen(x.saved)}</td><td className={`num ${x.free < 0 ? "neg" : ""}`}>{signed(x.free)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="note">自由に使えるお金は、給与 ＋ 追加予算 − 固定費の見込み − 回す額 です。給与の予定がまだない先の月は、設定の給与の見込み額で数えています。</div>
          <div className="btns"><button className="btn" onClick={apply}>この計画にする</button></div>
          <div className="note">押すと、{ymLabel(from)}〜{ymLabel(last)}の各月の目標用マイナスが、表の「回す」の額になります。あとから設定の予算で月ごとに直せます。</div>
        </div>
      </section>
    </>
  );
}
