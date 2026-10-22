import { useMemo, useRef, useState, type ReactElement } from "react";
import { forecast, PLAN_KIND_LABEL, planBucket, reserveAt, reserveMoves, ymOf, type AccountEntry, type Forecast, type PlanKind } from "../engine";
import type { AppData } from "../data/store";
import { accountTitle, Chip, Empty, md, money, signed, ymLabel } from "./common";
import type { Open } from "./Sheets";

type Mode = "both" | "bank" | "real";
const KINDS: PlanKind[] = ["repay", "buy", "save"];

/** 計画の取引なら計画を、ほかは明細を開く */
export type OpenRow = (e: AccountEntry) => void;
export const openRowOf = (onOpen: (o: Open) => void, openPlan: (id: string) => void): OpenRow => (e) => {
  if (e.plan_id) openPlan(e.plan_id);
  else if (!e.id.startsWith("proj:")) onOpen({ type: "account", entry: e });
};

/**
 * 口座残高と実質残高の線グラフ（§5.5）。なぞる（ドラッグ・矢印キー）と、その日の額と動きが出る。
 * 長さ（1か月・3か月・全部）と ‹ › で見る範囲を変える
 */
export function FlowChart({ data, f, mini, onTap }: { data: AppData; f: Forecast; mini?: boolean; onTap?: () => void }) {
  const today = f.today;
  const days = f.days;
  const ti = Math.max(0, days.findIndex((x) => x.date === today));
  const [mode, setMode] = useState<Mode>("both");
  const [span, setSpan] = useState(92);
  const [from, setFrom] = useState(Math.max(0, ti - (mini ? 20 : 10)));
  const [cur, setCur] = useState(ti);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef(false);

  const n = span || days.length;
  const a = Math.max(0, Math.min(days.length - n, from)), z = Math.min(days.length - 1, a + n - 1);
  const c = Math.max(a, Math.min(z, cur));
  const show = { bank: mode !== "real", real: mode !== "bank" };
  const W = 380, H = mini ? 120 : 240, L = 34, R = 6, T = 12, B = 20;
  const vals = [0, ...(show.bank ? days.slice(a, z + 1).map((x) => x.bank) : []), ...(show.real ? days.slice(a, z + 1).map((x) => x.real) : [])];
  const step = span === 31 ? 50000 : 100000;
  const lo = Math.floor(Math.min(...vals) / step) * step;
  let hi = Math.ceil(Math.max(...vals) / step) * step; if (hi === lo) hi = lo + step;
  const x = (k: number) => L + ((W - L - R) * (k - a)) / Math.max(1, z - a);
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const path = (key: "bank" | "real", color: string, w: number) => {
    let past = "", fut = "";
    for (let k = a; k <= z; k++) {
      const p = `${x(k).toFixed(1)} ${y(days[k][key]).toFixed(1)}`;
      if (k <= ti) past += (past ? "L" : "M") + p;
      if (k >= ti) fut += (fut ? "L" : "M") + p;
    }
    return <>{past && <path d={past} fill="none" stroke={color} strokeWidth={w} />}{fut && <path d={fut} fill="none" stroke={color} strokeWidth={w} opacity={0.55} />}</>;
  };
  const pick = (clientX: number) => {
    const rc = svg.current!.getBoundingClientRect();
    const px = ((clientX - rc.left) / rc.width) * W;
    setCur(Math.max(a, Math.min(z, Math.round(a + ((px - L) / (W - L - R)) * (z - a)))));
  };
  const grid: ReactElement[] = [];
  for (let g = lo; g <= hi; g += step) grid.push(<g key={`g${g}`}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray={g ? "3 4" : undefined} strokeWidth={g ? 1 : 1.5} /><text x={L - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--mut)">{g / 10000}万</text></g>);
  const ticks: ReactElement[] = [];
  for (let k = a; k <= z; k++) {
    const d = days[k].date;
    if (d.slice(8) === "01") ticks.push(<g key={d}><line x1={x(k)} x2={x(k)} y1={T} y2={H - B} stroke="var(--line)" /><text x={x(k) + 3} y={H - 6} fontSize="9" fill="var(--mut)">{+d.slice(5, 7)}月</text></g>);
    else if (span === 31 && +d.slice(8) % 5 === 0) ticks.push(<text key={d} x={x(k)} y={H - 6} textAnchor="middle" fontSize="8" fill="var(--mut)">{+d.slice(8)}</text>);
  }
  const p = days[c];
  const todays = [...f.history, ...f.rows].filter((r) => r.date === p.date);
  const buckets = KINDS.map((k) => [k, data.plans.filter((q) => q.kind === k).reduce((s, q) => s + planBucket(data, q, p.date), 0)] as const).filter(([, v]) => v);
  const move = (dir: number) => { const k = Math.max(7, Math.floor(n / 2)); setFrom(a + dir * k); setCur(Math.max(0, Math.min(days.length - 1, c + dir * k))); };

  if (mini) {
    return (
      <svg className="chart mini" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="口座残高の動き。タップで見通しへ" onClick={onTap}>
        {grid}{ticks}
        {path("bank", "var(--accent)", 2)}
        <line x1={x(ti)} x2={x(ti)} y1={T} y2={H - B} stroke="var(--mut)" strokeDasharray="2 3" />
      </svg>
    );
  }
  return (
    <div className="panel">
      <div className="seg" role="group" aria-label="グラフに出す線">
        {([["both", "両方"], ["bank", "口座残高"], ["real", "実質残高"]] as [Mode, string][]).map(([k, l]) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      <div className="zoom">
        <div className="seg" role="group" aria-label="見る長さ">
          {([[31, "1か月"], [92, "3か月"], [0, "全部"]] as [number, string][]).map(([k, l]) => <button key={k} aria-pressed={span === k} onClick={() => { setSpan(k); setFrom(k ? c - Math.floor(k / 2) : 0); }}>{l}</button>)}
        </div>
        <div className="btns"><button className="iconbtn" aria-label="前へ" onClick={() => move(-1)}>‹</button><button className="iconbtn" aria-label="次へ" onClick={() => move(1)}>›</button></div>
      </div>
      <svg ref={svg} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="口座残高と実質残高の動き。なぞると、その日の額が出ます" tabIndex={0}
        onPointerDown={(e) => { drag.current = true; svg.current!.setPointerCapture(e.pointerId); pick(e.clientX); }}
        onPointerMove={(e) => { if (drag.current || e.pointerType === "mouse") pick(e.clientX); }}
        onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
        onKeyDown={(e) => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault(); const k = c + (e.key === "ArrowLeft" ? -1 : 1); setCur(k); if (k < a) setFrom(a - 1); if (k > z) setFrom(a + 1); }}>
        {grid}{ticks}
        {show.real && path("real", "var(--warn)", 2)}
        {show.bank && path("bank", "var(--accent)", 2.5)}
        {show.bank && f.eves.map((d) => { const k = days.findIndex((x) => x.date === d); return k >= a && k <= z ? <circle key={d} cx={x(k)} cy={y(days[k].bank)} r={3} fill="var(--surface)" stroke="var(--accent)" strokeWidth={1.5} /> : null; })}
        {ti >= a && ti <= z && <><line x1={x(ti)} x2={x(ti)} y1={T} y2={H - B} stroke="var(--mut)" strokeDasharray="2 3" /><text x={x(ti) + 3} y={T + 9} fontSize="9" fill="var(--mut)">今日</text></>}
        <line x1={x(c)} x2={x(c)} y1={T} y2={H - B} stroke="var(--ink)" strokeWidth={1.2} />
        {show.bank && <circle cx={x(c)} cy={y(p.bank)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />}
        {show.real && <circle cx={x(c)} cy={y(p.real)} r={4} fill="var(--warn)" stroke="var(--surface)" strokeWidth={1.5} />}
      </svg>
      <div className="readout" aria-live="polite">
        <div className="h">{p.date.slice(0, 4)}年{md(p.date)}{p.date === today ? "（今日）" : p.date > today ? "（見込み）" : ""}</div>
        {show.bank && <div className="kv"><span>口座残高</span><b className="num">{money(p.bank)}</b></div>}
        {show.real && <div className="kv"><span>実質残高</span><b className={`num ${p.real < 0 ? "neg" : ""}`}>{money(p.real)}</b></div>}
        {buckets.map(([k, v]) => <div className="kv" key={k}><span>　うち{PLAN_KIND_LABEL[k]}用</span><b className="num">{money(v)}</b></div>)}
        {todays.length > 0 && <div className="ev">{todays.map((r) => `${accountTitle(r.entry)} ${r.delta > 0 ? "＋" : ""}${signed(r.delta)}`).join("・")}</div>}
      </div>
      <div className="legend">
        {show.bank && <span><span className="sw line" style={{ background: "var(--accent)" }} />口座残高</span>}
        {show.real && <span><span className="sw line" style={{ background: "var(--warn)" }} />実質残高</span>}
        <span>○ 確保額</span>
      </div>
    </div>
  );
}

/** 給料日の前日から次の給料日の前日までの増減を、まとまりごとに */
function Moves({ data, f }: { data: AppData; f: Forecast }) {
  const groups = ["給与・固定費", "カード", "計画", "臨時の入出金"];
  const kind = (e: AccountEntry) => (e.plan_id ? 2 : e.group === "card" ? 1 : e.group === "salary" || e.group === "fixed" || e.recurring_id ? 0 : 3);
  const bank = (d: string) => f.days.find((x) => x.date === d)?.bank ?? 0;
  return (
    <details className="panel why">
      <summary>確保額の増減</summary>
      <div className="scroll">
        <table className="tbl">
          <tbody>
            {f.eves.slice(1).map((to, i) => {
              const from = f.eves[i], list = reserveMoves(f, from, to), diff = bank(to) - bank(from);
              return [
                <tr key={to} className="cyc"><td>{md(from)} → {md(to)}</td><td className="num">{money(bank(from))} → {money(bank(to))}</td><td className={`num ${diff < 0 ? "neg" : ""}`}>{diff > 0 ? "＋" : ""}{signed(diff)}</td></tr>,
                ...groups.flatMap((g, gi) => {
                  const rs = list.filter((r) => kind(r.entry) === gi);
                  return rs.length ? [<tr key={`${to}${g}`} className="grp"><td colSpan={3}>{g}</td></tr>, ...rs.map((r, j) => <tr key={`${to}${g}${j}`}><td className="memo">{md(r.date)} {accountTitle(r.entry)}</td><td /><td className="num">{r.delta > 0 ? "＋" : ""}{signed(r.delta)}</td></tr>)] : [];
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      {data.plans.length === 0 && <div className="note">計画を作ると、確保額の中に返済用・買い物用・貯蓄の分が出ます。</div>}
    </details>
  );
}

/** 口座の見通し（§5.5） */
export function FlowView({ data, today, openRow }: { data: AppData; today: string; openRow: OpenRow }) {
  const f = useMemo(() => forecast(data, today), [data, today]);
  if (!f) return <Empty>口座の残高を入れると出ます（メニュー → 口座と財布）</Empty>;
  const bank = (d: string) => f.days.find((x) => x.date === d)?.bank ?? 0;
  let mh = "";
  return (
    <>
      <section><FlowChart data={data} f={f} /></section>
      <section>
        <h2>給料日前日の残高 <small>確保額</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>給料日前日</th><th>口座残高</th><th>前の月から</th></tr></thead>
            <tbody>{f.eves.map((d, i) => {
              const r = reserveAt(data, f, d)!, df = i ? bank(d) - bank(f.eves[i - 1]) : 0;
              return <tr key={d}><td>{md(d)}{d > today && <span className="note"> 見込み</span>}</td><td className={`num ${r.total < 0 ? "neg" : ""}`}><b>{money(r.total)}</b></td><td className={`num ${df < 0 ? "neg" : df > 0 ? "pos" : ""}`}>{i ? `${df > 0 ? "＋" : ""}${signed(df)}` : "―"}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <Moves data={data} f={f} />
      </section>
      <section>
        <h2>これからの入出金 <small>{md(today)}〜{ymLabel(ymOf(f.end))}</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>日</th><th style={{ textAlign: "left" }}>内容</th><th>入出金</th><th>残高</th></tr></thead>
            <tbody>
              <tr><td className="num">{md(today)}</td><td className="memo">口座残高（いま）</td><td /><td className="num">{money(bank(today) - f.rows.filter((r) => r.date <= today).reduce((a, r) => a + r.delta, 0))}</td></tr>
              {f.rows.map((r, i) => {
                const head = ymOf(r.date) !== mh ? (mh = ymOf(r.date)) : null;
                return [
                  head && <tr key={`h${head}`} className="mh"><td colSpan={4}>{ymLabel(head)}</td></tr>,
                  <tr key={r.entry.id + i} className={r.virtual && !r.entry.id.startsWith("virtual:") ? "" : "tap"} onClick={() => openRow(r.entry)}>
                    <td className="num">{md(r.date)}</td>
                    <td className="memo">{accountTitle(r.entry)} {r.entry.id.startsWith("proj:") ? <Chip>見込み</Chip> : r.entry.group === "card" ? <Chip kind={r.entry.locked ? "ok" : "warn"}>{r.entry.locked ? "確定" : "見込み"}</Chip> : r.entry.status === "plan" ? <Chip kind="warn">{r.overdue ? "日付が過ぎた予定" : "予定"}</Chip> : null}</td>
                    <td className={`num ${r.delta < 0 ? "neg" : "pos"}`}>{r.delta > 0 ? "＋" : ""}{signed(r.delta)}</td>
                    <td className={`num ${r.balance < 0 ? "neg" : ""}`}>{money(r.balance)}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
        <div className="note">これからカードで使う分は、その月の残り予算を見込みにして、引落日に入れています。</div>
      </section>
    </>
  );
}

