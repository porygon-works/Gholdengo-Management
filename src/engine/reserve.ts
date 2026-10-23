import { addDays, addMonths, ymOf } from "./dates";
import { ofRows, sum, type Part, type PartRow } from "./breakdown";
import type { Data, V5Plan } from "./types";

// 計画（購入・貯蓄）の積立額と確保額（設計書 §3.3）。返済の計画は積立額を持たない

const holds = (p: V5Plan) => p.kind !== "repay" && !p.done;

/** 毎月の積立額が入る月か（購入は期日の月まで） */
const monthlyRuns = (p: V5Plan, ym: string) => !!p.monthly && !!p.start_month && p.start_month <= ym && (p.kind !== "buy" || !p.due_date || ym <= ymOf(p.due_date));

const vrow = (id: string, date: string, name: string, amount: number, plan = false): PartRow => ({ date, name, amount, plan, ref: { kind: "virtual", id } });

/**
 * t の日の積立額 ＝ 毎月の積立額 ＋ 余裕額から入れた分 ＋ 賞与からの配分 − 取り崩し − ひも付けた購入。
 * 目標額をこえては積まない。0 より小さくしない。賞与からの配分は賞与が確定してから（projected なら、賞与の日が来たら）入る
 */
export function savedAt(d: Data, p: V5Plan, t: string, projected = false): Part {
  const key = `plan:${p.id}`;
  if (!holds(p)) return sum(key, p.name, []);
  type Ev = { date: string; kind: "monthly" | "manual" | "bonus" | "draw" | "spend"; amount: number; id: string; name: string };
  const evs: Ev[] = [];
  if (p.start_month) for (let ym = p.start_month; `${ym}-01` <= t; ym = addMonths(ym, 1)) if (monthlyRuns(p, ym)) evs.push({ date: `${ym}-01`, kind: "monthly", amount: p.monthly, id: `monthly:${p.id}:${ym}`, name: `${+ym.slice(5)}月の積立` });
  for (const m of d.v5.moves) {
    if (m.plan_id !== p.id || m.date > t) continue;
    if (m.kind === "bonus") {
      const e = d.accounts.find((x) => x.id === m.bonus_entry_id);
      if (!e || e.date > t || (e.status !== "confirmed" && !projected)) continue;
      evs.push({ date: e.date, kind: "bonus", amount: m.amount, id: m.id, name: `${e.name || "賞与"}から` });
    } else evs.push({ date: m.date, kind: m.kind, amount: m.amount, id: m.id, name: m.memo || { manual: "余裕額から", draw: "取り崩し", spend: "購入" }[m.kind] });
  }
  const order = { monthly: 0, manual: 1, bonus: 1, draw: 2, spend: 2 };
  evs.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
  let bal = 0;
  const rows: Record<Ev["kind"], PartRow[]> = { monthly: [], manual: [], bonus: [], draw: [], spend: [] };
  for (const e of evs) {
    const amount = e.kind === "draw" || e.kind === "spend" ? Math.min(e.amount, bal) : p.target ? Math.min(e.amount, Math.max(0, p.target - bal)) : e.amount;
    if (!amount) continue;
    bal += e.kind === "draw" || e.kind === "spend" ? -amount : amount;
    rows[e.kind].push(vrow(e.id, e.date, e.name, amount));
  }
  return sum(key, p.name, [
    ofRows("monthly", "毎月の積立額", rows.monthly),
    ofRows("manual", "余裕額から入れた分", rows.manual),
    ofRows("bonus", "賞与からの配分", rows.bonus),
    ofRows("draw", "取り崩し", rows.draw, -1),
    ofRows("spend", "購入", rows.spend, -1),
  ]);
}

/** まだ入っていない（予定の）賞与からの配分 */
export function plannedBonus(d: Data, p: V5Plan): PartRow[] {
  return d.v5.moves.filter((m) => m.plan_id === p.id && m.kind === "bonus").flatMap((m) => {
    const e = d.accounts.find((x) => x.id === m.bonus_entry_id);
    return e && e.status === "plan" ? [vrow(m.id, e.date, `${e.name || "賞与"}から（予定）`, m.amount, true)] : [];
  });
}

/** その月の、購入・貯蓄の計画の毎月の積立額の合計（目標額に届いた計画は0） */
export function planMonthlyOf(d: Data, ym: string): number {
  return d.v5.plans.filter((p) => holds(p) && monthlyRuns(p, ym)).reduce((a, p) => {
    if (!p.target) return a + p.monthly;
    const before = savedAt(d, p, addDays(`${ym}-01`, -1), true).amount;
    return a + Math.min(p.monthly, Math.max(0, p.target - before));
  }, 0);
}

/** t の日の確保額（購入・貯蓄の計画の積立額の合計） */
export function reserveTotal(d: Data, t: string, projected = false): Part {
  return sum("reserve", "確保額", d.v5.plans.filter(holds).map((p) => savedAt(d, p, t, projected)));
}

/** 余裕額のマイナスを埋めるために、取崩順に差し引く計画と額（取崩不可は除く。足りなければあるだけ） */
export function drawPlan(d: Data, need: number, t: string): { plan: V5Plan; amount: number }[] {
  const out: { plan: V5Plan; amount: number }[] = [];
  let left = need;
  for (const p of d.v5.plans.filter((x) => holds(x) && !x.no_draw).sort((a, b) => a.draw_order - b.draw_order || a.sort - b.sort)) {
    if (left <= 0) break;
    const amount = Math.min(left, savedAt(d, p, t).amount);
    if (amount > 0) { out.push({ plan: p, amount }); left -= amount; }
  }
  return out;
}
