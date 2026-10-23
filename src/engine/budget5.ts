import { ymOf } from "./dates";
import { isLive } from "./merge";
import { budgetsFor } from "./compute";
import { leaf, ofRows, sum, type Part, type PartRow } from "./breakdown";
import { loanMonthlyOf } from "./loan";
import { planMonthlyOf } from "./reserve";
import { spendTarget } from "./links";
import { ownCost } from "./schedule";
import { budgetCats, isFixedCat, RESERVE, type AccountEntry, type CardEntry, type Data } from "./types";

// v5 の月の予算（設計書 §3.1・§3.2）

/** その月の給与の入金（予定を含む）。なければ設定の給与の見込み */
export function salaryOf(d: Data, ym: string): { amount: number; rows: PartRow[] } {
  const rows = d.accounts.filter((e) => e.direction === "in" && e.group === "salary" && ymOf(e.date) === ym).map(accountRow);
  if (rows.length) return { amount: rows.reduce((a, r) => a + r.amount, 0), rows };
  return { amount: d.settings.salaryEstimate || 0, rows: [] };
}

/** 目安額 ＝ 給与の見込み − 固定費 − 借入の毎月の返済 − 計画の毎月の積立額 */
export function guideOf(d: Data, ym: string): Part {
  const salary = salaryOf(d, ym);
  const budgets = budgetsFor(d, ym);
  const fixed = d.settings.fixCats.reduce((a, c) => a + (budgets.get(c) || 0), 0);
  const loans = loanMonthlyOf(d, ym);
  return sum("guide", "目安額", [
    { key: "salary", label: "給与の見込み", amount: salary.amount, sign: 1, rows: salary.rows },
    leaf("fixed", "固定費", fixed, -1),
    ofRows("loanMonthly", "借入の毎月の返済", loans, -1),
    leaf("planMonthly", "計画の毎月の積立額", planMonthlyOf(d, ym), -1),
  ]);
}

/** その月の予算。決めた額か月の初めに保存した目安額（v5_months）、なければいまの目安額 */
export function monthBudget(d: Data, ym: string): { amount: number; source: "decided" | "guide" | "live"; guide: Part } {
  const guide = guideOf(d, ym);
  const m = d.v5.months.find((x) => x.month === ym);
  return m ? { amount: m.budget, source: m.source, guide } : { amount: guide.amount, source: "live", guide };
}

/** 予算に数える出費の1件 */
interface Spend5 { fixed: boolean; category: string | null; plan: boolean; own: number; row: PartRow }

export const accountRow = (e: AccountEntry): PartRow => ({ date: e.date, name: e.name || e.category || "", amount: e.amount, plan: e.status === "plan", ref: { kind: "account", id: e.id } });
export const cardRow = (e: CardEntry, amount = e.amount): PartRow => ({ date: e.date, name: e.name || e.shop || e.category || "クレカ", amount, plan: e.status === "plan", ref: { kind: "card", id: e.id } });

/** 計画にひも付けた購入の明細（予算に数えない） */
export const linkedSpends = (d: Data) => new Set(d.v5.moves.map((m) => spendTarget(d, m)).filter((x): x is string => !!x));

/**
 * その月の、予算に数える出費。クレカ明細の変動費・固定費・分割（購入）（リボに回した明細も、その費目で数える）と、口座明細の出金の変動費・固定費。
 * 計画にひも付けた購入と、v4 の計画の取引は数えない
 */
function spends(d: Data, ym: string): Spend5[] {
  const s = d.settings;
  const linked = linkedSpends(d);
  const out: Spend5[] = [];
  for (const e of d.cards) {
    if (!isLive(e) || ymOf(e.date) !== ym || linked.has(`card:${e.id}`)) continue;
    if (e.group !== "variable" && e.group !== "fixed" && e.group !== "purchase") continue;
    const fixed = e.group === "fixed" || (e.group === "purchase" && isFixedCat(s, e.category));
    out.push({ fixed, category: e.category, plan: e.status === "plan", own: ownCost(e), row: cardRow(e, ownCost(e)) });
  }
  for (const e of d.accounts) {
    if (e.direction !== "out" || ymOf(e.date) !== ym || (e.group !== "variable" && e.group !== "fixed") || e.plan_id || linked.has(`account:${e.id}`)) continue;
    out.push({ fixed: e.group === "fixed", category: e.category, plan: e.status === "plan", own: e.amount, row: accountRow(e) });
  }
  return out;
}

export interface CatLeft { cat: string; fixed: boolean; budget: number; used: number; planned: number; left: number; over: boolean; rows: PartRow[] }

export interface BudgetView {
  budget: number;
  source: "decided" | "guide" | "live";
  guide: Part;
  left: Part; // 予算残額 ＝ 予算 − 使った額 − 予定 − 固定費の超過
  cats: CatLeft[];
  fixed: { budget: number; used: number };
  fixedLeft: number; // 固定費の費目で、まだ使っていない予算の合計
}

export function budgetView(d: Data, ym: string, _today: string): BudgetView {
  const s = d.settings;
  const mb = monthBudget(d, ym);
  const budgets = budgetsFor(d, ym);
  const rows = new Map<string, CatLeft>();
  for (const c of budgetCats(s)) rows.set(c, { cat: c, fixed: isFixedCat(s, c), budget: budgets.get(c) || 0, used: 0, planned: 0, left: 0, over: false, rows: [] });
  const used: PartRow[] = [], planned: PartRow[] = [];
  for (const x of spends(d, ym)) {
    // 費目の一覧にない費目と未分類は、予備で数える
    const r = rows.get(x.category && rows.has(x.category) ? x.category : RESERVE)!;
    if (x.plan) r.planned += x.own; else r.used += x.own;
    r.rows.push(x.row);
    if (!r.fixed) (x.plan ? planned : used).push(x.row);
  }
  const reserve = rows.get(RESERVE)!;
  reserve.budget = mb.amount - [...rows.values()].filter((r) => !r.fixed && r.cat !== RESERVE).reduce((a, r) => a + r.budget, 0);
  let fixedOver = 0, fixedLeft = 0;
  for (const r of rows.values()) {
    r.left = r.budget - r.used - r.planned;
    r.over = r.left < 0;
    r.rows.sort((a, b) => b.date.localeCompare(a.date));
    if (r.fixed) { fixedOver += Math.max(0, -r.left); fixedLeft += Math.max(0, r.left); }
  }
  const fx = [...rows.values()].filter((r) => r.fixed);
  return {
    budget: mb.amount, source: mb.source, guide: mb.guide,
    left: sum("budgetLeft", "予算残額", [
      leaf("budget", "予算", mb.amount),
      ofRows("used", "使った額", used, -1),
      ofRows("planned", "予定", planned, -1),
      leaf("fixedOver", "固定費の超過", fixedOver, -1),
    ]),
    cats: [...rows.values()],
    fixed: { budget: fx.reduce((a, r) => a + r.budget, 0), used: fx.reduce((a, r) => a + r.used + r.planned, 0) },
    fixedLeft,
  };
}
