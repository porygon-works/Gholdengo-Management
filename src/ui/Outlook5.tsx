import { useMemo, useRef, useState, type ReactElement } from "react";
import { addMonths, lastDay, outlook, projectedRows, ymOf } from "../engine";
import type { AppData } from "../data/store";
import { Chip, md, money, signed, ymLabel } from "./common";
import type { Open } from "./Sheets";

// v5 の見通し（設計書 §4.2）：口座残高と余裕額の線。今日より先は見込み（予算どおりに使う前提）

type Day = { date: string; bank: number; slack: number };

export function LineChart5({ days, today, mini, onTap }: { days: Day[]; today: string; mini?: boolean; onTap?: () => void }) {
  const ti = Math.max(0, days.findIndex((x) => x.date === today));
  const [span, setSpan] = useState(mini ? 45 : 92);
  const [from, setFrom] = useState(Math.max(0, ti - (mini ? 10 : 15)));
  const [cur, setCur] = useState(ti);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef(false);
  const n = span || days.length;
  const a = Math.max(0, Math.min(days.length - n, from)), z = Math.min(days.length - 1, a + n - 1);
  const c = Math.max(a, Math.min(z, cur));
  const W = 380, H = mini ? 120 : 220, L = 6, R = 6, T = 12, B = 20;
  const vals = [0, ...days.slice(a, z + 1).flatMap((x) => [x.bank, x.slack])];
  // 上下に少し余白（線が枠にふれないように）
  const vmin = Math.min(...vals), vmax = Math.max(...vals), pad = Math.max(10000, (vmax - vmin) * 0.08);
  const lo = vmin - pad, hi = vmax + pad;
  const x = (k: number) => L + ((W - L - R) * (k - a)) / Math.max(1, z - a);
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const line = (key: "bank" | "slack", color: string) => {
    let past = "", fut = "";
    for (let k = a; k <= z; k++) {
      const p = `${x(k).toFixed(1)} ${y(days[k][key]).toFixed(1)}`;
      if (k <= ti) past += (past ? "L" : "M") + p;
      if (k >= ti) fut += (fut ? "L" : "M") + p;
    }
    return <>{past && <path d={past} fill="none" stroke={color} strokeWidth={2} />}{fut && <path d={fut} fill="none" stroke={color} strokeWidth={2} opacity={0.5} strokeDasharray="5 3" />}</>;
  };
  const pick = (cx: number) => { const rc = svg.current!.getBoundingClientRect(); const px = ((cx - rc.left) / rc.width) * W; setCur(Math.max(a, Math.min(z, Math.round(a + ((px - L) / (W - L - R)) * (z - a))))); };
  const grid: ReactElement[] = [];
  // y 軸の目盛りの数字は出さない（0 の線だけ。額はなぞったときに出す。設計書 §4.1.1）
  grid.push(<line key="zero" x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--mut)" strokeWidth={1} opacity={0.5} />);
  const ticks: ReactElement[] = [];
  for (let k = a; k <= z; k++) if (days[k].date.endsWith("-01")) ticks.push(<text key={k} x={x(k)} y={H - 6} fontSize="9" textAnchor="middle" fill="var(--mut)">{+days[k].date.slice(5, 7)}月</text>);
  if (!days.length) return null;
  const d = days[c];
  return (
    <div className="chart" onClick={mini ? onTap : undefined}>
      {!mini && (
        <div className="btns">
          {[[31, "1か月"], [92, "3か月"], [0, "全期間"]].map(([v, l]) => <button key={l} className={`btn sm ${span === v ? "" : "ghost"}`} onClick={() => setSpan(v as number)}>{l}</button>)}
          <button className="btn sm ghost" onClick={() => setFrom(Math.max(0, a - 30))}>‹</button>
          <button className="btn sm ghost" onClick={() => setFrom(Math.min(days.length - n, a + 30))}>›</button>
        </div>
      )}
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="口座残高と余裕額の線グラフ"
        onPointerDown={(e) => { if (mini) return; drag.current = true; pick(e.clientX); }} onPointerMove={(e) => drag.current && pick(e.clientX)} onPointerUp={() => (drag.current = false)} onPointerLeave={() => (drag.current = false)}>
        {grid}{ticks}
        {ti >= a && ti <= z && <line x1={x(ti)} x2={x(ti)} y1={T} y2={H - B} stroke="var(--mut)" strokeWidth={1} />}
        {line("bank", "var(--mut)")}
        {line("slack", "var(--gold)")}
        {!mini && <line x1={x(c)} x2={x(c)} y1={T} y2={H - B} stroke="var(--ink)" strokeWidth={1} opacity={0.4} />}
      </svg>
      <div className="legend"><span><span className="sw line" style={{ background: "var(--mut)" }} />口座残高</span><span><span className="sw line" style={{ background: "var(--gold)" }} />余裕額</span>{!mini && <span>点線は見込</span>}</div>
      {!mini && d && (
        <div className="readout">
          <div className="h">{md(d.date)}{d.date > today ? "（見込）" : ""}</div>
          <div className="kv"><span>口座残高</span><b className={`num ${d.bank < 0 ? "neg" : ""}`}>{money(d.bank)}</b></div>
          <div className="kv"><span>余裕額</span><b className={`num ${d.slack < 0 ? "neg" : ""}`}>{money(d.slack)}</b></div>
        </div>
      )}
    </div>
  );
}

export function Outlook5({ data, today, onOpen }: { data: AppData; today: string; onOpen: (o: Open) => void }) {
  const cur = ymOf(today);
  // 最初に口座残高を入れた日より前は描かない（記録がない日は 0 に見えてしまうため）
  const first = data.balances.map((b) => b.date).sort()[0];
  const from = first && first > `${addMonths(cur, -1)}-01` ? first : `${addMonths(cur, -1)}-01`;
  const endYm = addMonths(cur, 6);
  const to = `${endYm}-${String(lastDay(endYm)).padStart(2, "0")}`;
  const days = useMemo(() => (data.balances.length ? outlook(data, today, from, to) : []), [data, today, from, to]);
  const rows = useMemo(() => projectedRows(data, today, to), [data, today, to]);
  if (!data.balances.length) return <div className="empty">口座残高を入力すると見通しが出ます（メニューの「口座残高」）</div>;
  let bank = days.find((x) => x.date === today)?.bank ?? 0;
  const withBal = rows.map((r) => ({ ...r, balance: (bank += r.amount) }));
  const months = [...new Set(withBal.map((r) => ymOf(r.date)))];
  const open = (id: string, kind: string) => {
    if (kind !== "account") return;
    const e = data.accounts.find((x) => x.id === id);
    if (e) onOpen({ type: "account", entry: e });
  };
  return (
    <>
      <section><div className="panel"><LineChart5 days={days} today={today} /></div></section>
      <section>
        <h2>入出金予定</h2>
        {months.map((m) => (
          <div className="panel" key={m}>
            <div className="cathead" style={{ cursor: "default" }}><span className="n">{ymLabel(m)}</span></div>
            <div className="list">
              {withBal.filter((r) => ymOf(r.date) === m).map((r, i) => (
                <button key={r.ref.id + i} className={`row ${r.virtual ? "plan" : ""}`} style={r.virtual ? { border: "1px dashed var(--line)" } : undefined} disabled={r.ref.kind !== "account"} onClick={() => open(r.ref.id, r.ref.kind)}>
                  <span className="d num">{md(r.date)}</span>
                  <span className="t"><div>{r.name} {r.virtual && <Chip kind="warn">見込</Chip>}</div><div className="num">残高 {money(r.balance)}</div></span>
                  <span className={`a num ${r.amount > 0 ? "pos" : ""}`}>{r.amount > 0 ? "＋" : ""}{signed(r.amount)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!months.length && <div className="note">これからの入出金はありません</div>}
      </section>
    </>
  );
}

