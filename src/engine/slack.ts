import { addMonths, dayOf, lastDay, shiftBusiness, ymOf } from "./dates";
import { billName, billsFor, latestBalance, type Bill } from "./compute";
import { leaf, ofRows, sum, type Part, type PartRow } from "./breakdown";
import { accountRow, budgetView, guideOf, monthBudget, salaryOf } from "./budget5";
import { loanPayments, loansAt } from "./loan";
import { reserveTotal } from "./reserve";
import type { AccountEntry, Balance, Data } from "./types";

// 余裕額（設計書 §2.2）
// 余裕額 ＝ 口座残高 ＋ 未入金給与 ＋ 未回収立替 − 支払予定額 − 確保額

const monthEnd = (ym: string) => dayOf(ym, lastDay(ym));
const signed = (e: AccountEntry) => (e.direction === "in" ? e.amount : -e.amount);

/** 残高の記録 base のあとに起きたことか。同じ日なら、記録のあとに入れたもの */
const afterBase = (e: { date: string; at?: string }, base: Balance) => e.date > base.date || (e.date === base.date && !!e.at && !!base.at && e.at > base.at);

/** t の日の終わりの口座残高（記録から）。財布は数えない */
export function bankOn(d: Data, t: string): { amount: number; base: Balance | null; rows: PartRow[] } {
  const base = latestBalance(d.balances.filter((b) => b.date <= t));
  if (!base) return { amount: 0, base: null, rows: [] };
  const done = d.accounts.filter((e) => e.account === "bank" && e.status === "confirmed" && e.date <= t && afterBase(e, base));
  return { amount: done.reduce((a, e) => a + signed(e), base.bank || 0), base, rows: done.map((e) => ({ ...accountRow(e), amount: signed(e) })) };
}

/** まだ口座で動いていない予定か（t より後、または予定のまま日付が過ぎたもの）。見通しでは、日付が過ぎた予定は今日に動いたとする */
const pending = (e: AccountEntry, t: string, projected = false) => e.date > t || (!projected && e.status === "plan" && e.date <= t);

/** 給与の入金がない月の、設定の給与の見込みの日（給料日。土日祝は翌営業日） */
export const estimatePayday = (d: Data, ym: string) => shiftBusiness(dayOf(ym, d.settings.payday), "next");

/** v5 の請求。確定の額（本人やメールが入れた額）には、そのカードで一緒に引き落とされる借入の返済が入っているので、それを引く */
export function bills5(d: Data, payYm: string): Bill[] {
  return billsFor(d, payYm).map((b) => {
    if (!b.row || !(b.row.status === "confirmed" || b.row.locked)) return b;
    const loanPay = d.v5.loans.filter((l) => l.card === b.card.id).flatMap((l) => loanPayments(d, l, "0000-00-00", b.date)).filter((r) => r.date === b.date).reduce((a, r) => a + r.amount, 0);
    return { ...b, amount: Math.max(0, (b.row.billTotal ?? b.row.amount) - loanPay) };
  });
}

const billRow = (b: Bill, amount = b.amount): PartRow => ({ date: b.date, name: billName(b), amount, plan: !(b.row && (b.row.status === "confirmed" || b.row.locked)), ref: b.row && !b.row.id.startsWith("virtual:") ? { kind: "account", id: b.row.id } : { kind: "virtual", id: `bill:${b.card.id}:${b.date}` } });

/** ① 未払いのクレカ請求：締め月が ym(t) 以前で、引落日が t より後の請求 */
function unpaidCards(d: Data, t: string, extra: (b: Bill) => number = () => 0): PartRow[] {
  const ym = ymOf(t);
  const rows: PartRow[] = [];
  for (let k = -3; k <= 3; k++) {
    for (const b of bills5(d, addMonths(ym, k))) {
      if (b.closingYm > ym || b.date <= t) continue;
      const amount = b.amount + extra(b);
      if (amount > 0) rows.push(billRow(b, amount));
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** ⑤ 先の月の追加予算：ym より先の月で、決めた予算が目安額をこえている分 */
export function aheadOf(d: Data, ym: string): PartRow[] {
  return d.v5.months.filter((m) => m.source === "decided" && m.month > ym).flatMap((m) => {
    const over = m.budget - guideOf(d, m.month).amount;
    return over > 0 ? [{ date: `${m.month}-01`, name: `${+m.month.slice(5)}月の予算（目安額より多い分）`, amount: over, plan: true, ref: { kind: "virtual" as const, id: `ahead:${m.month}` } }] : [];
  });
}

/** 予算どおりに使う見込みの額（予算残額と、まだ明細のない固定費の予算） */
export function budgetToSpend(d: Data, ym: string, today: string): number {
  const v = budgetView(d, ym, today);
  return Math.max(0, v.left.amount) + v.fixedLeft;
}

export interface SlackOpts {
  /** t の日の口座残高（先の日の見込みは見通しで出す） */
  bank?: { amount: number; rows: PartRow[] };
  /** 請求に足す「予算どおりに使う」見込み（先の日の見込みのとき） */
  extraBill?: (b: Bill) => number;
  projected?: boolean;
}

/** t の日の余裕額と、その内訳 */
export function slackAt(d: Data, t: string, today: string, o: SlackOpts = {}): Part {
  if (t > today && !o.bank) throw new Error("先の日の余裕額は outlook で出す");
  const ym = ymOf(t), end = monthEnd(ym);
  const pr = o.projected ?? false;
  const bank = o.bank ?? bankOn(d, t);
  const salaryEntries = d.accounts.filter((e) => e.direction === "in" && e.group === "salary" && ymOf(e.date) === ym);
  const salary: PartRow[] = salaryEntries.length
    ? salaryEntries.filter((e) => pending(e, t, pr)).map(accountRow)
    : salaryOf(d, ym).amount && estimatePayday(d, ym) > t ? [estimateRow(d, ym)] : [];
  const refund = d.accounts.filter((e) => e.direction === "in" && e.group === "refund" && pending(e, t, pr)).map(accountRow);
  const planned = d.accounts.filter((e) => e.account === "bank" && e.direction === "out" && e.group !== "card" && !e.plan_id && pending(e, t, pr) && e.date <= end).map(accountRow);
  const bv = budgetView(d, ym, today);
  const mb = monthBudget(d, ym);
  return sum("slack", "余裕額", [
    { key: "bank", label: "口座残高", amount: bank.amount, sign: 1, rows: bank.rows },
    ofRows("salary", "未入金給与", salary),
    ofRows("refund", "未回収立替", refund),
    sum("due", "支払予定額", [
      ofRows("card", "未払いのクレカ請求", unpaidCards(d, t, o.extraBill)),
      ofRows("planned", "今月の口座の予定", planned),
      sum("budget", "今月の予算残額", [{ ...bv.left, amount: Math.max(0, bv.left.amount), label: `予算残額（予算 ¥${mb.amount.toLocaleString("ja-JP")}）` }, leaf("fixedLeft", "固定費の予算のうち、まだ明細のない分", bv.fixedLeft)]),
      { ...loansAt(d, t), sign: 1 },
      ofRows("ahead", "先の月の追加予算", aheadOf(d, ym)),
    ], -1),
    { ...reserveTotal(d, t, pr), sign: -1 },
  ]);
}

/** 給与の入金がない月の、設定の給与の見込みの行 */
export const estimateRow = (d: Data, ym: string): PartRow => ({ date: estimatePayday(d, ym), name: "給与の見込み（設定）", amount: salaryOf(d, ym).amount, plan: true, ref: { kind: "virtual", id: `salary:${ym}` } });

export const slackValue = (d: Data, t: string, today: string, o?: SlackOpts) => slackAt(d, t, today, o).amount;
