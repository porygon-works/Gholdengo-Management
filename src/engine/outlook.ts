import { addDays, addMonths, ymOf } from "./dates";
import { sum, leaf, type Part, type PartRow } from "./breakdown";
import { loanAt, loanPayments } from "./loan";
import { bankOn, bills5, budgetToSpend, estimatePending, estimateRow, slackAt } from "./slack";
import type { Data, V5Plan } from "./types";

// 見通し（設計書 §4.2）：先の日の口座残高と余裕額の見込み。予算は予算どおりに使う前提

/** これからの口座の動き1行（入金 +・出金 −） */
export interface FlowRow5 { date: string; name: string; amount: number; kind: "entry" | "bill" | "loan" | "salary"; virtual: boolean; ref: PartRow["ref"] }

/** 予算どおりに使う見込み：いつものカード（1枚目）の、今月以降の締め月の請求に、その月の予算残額を足す */
const assumed = (d: Data, today: string) => {
  const cur = ymOf(today);
  const main = d.settings.cards[0]?.id;
  const memo = new Map<string, number>();
  return (card: string, closingYm: string) => {
    if (card !== main || closingYm < cur) return 0;
    if (!memo.has(closingYm)) memo.set(closingYm, budgetToSpend(d, closingYm, today));
    return memo.get(closingYm)!;
  };
};

/** 今日より後〜to の口座の動き。予定のまま日付が過ぎた予定は今日に数える */
export function projectedRows(d: Data, today: string, to: string): FlowRow5[] {
  const cur = ymOf(today), last = ymOf(to);
  const rows: FlowRow5[] = [];
  for (const e of d.accounts) {
    if (e.account !== "bank" || e.group === "card" || e.plan_id) continue;
    const later = e.date > today && e.date <= to, overdue = e.status === "plan" && e.date <= today;
    if (!later && !overdue) continue;
    rows.push({ date: later ? e.date : today, name: e.name || e.category || "", amount: e.direction === "in" ? e.amount : -e.amount, kind: "entry", virtual: false, ref: { kind: "account", id: e.id } });
  }
  for (let ym = cur; ym <= last; ym = addMonths(ym, 1)) {
    if (d.accounts.some((e) => e.direction === "in" && e.group === "salary" && ymOf(e.date) === ym)) continue;
    const r = estimateRow(d, ym);
    if (!r.amount || r.date > to) continue;
    // 給料日を過ぎても給料日以後の残高をまだ入れていなければ、今日に入ったとする
    if (r.date > today) rows.push({ date: r.date, name: r.name, amount: r.amount, kind: "salary", virtual: true, ref: r.ref });
    else if (estimatePending(d, ym, today)) rows.push({ date: today, name: r.name, amount: r.amount, kind: "salary", virtual: true, ref: r.ref });
  }
  const extra = assumed(d, today);
  for (let ym = addMonths(cur, -1); ym <= addMonths(last, 1); ym = addMonths(ym, 1)) {
    for (const b of bills5(d, ym)) {
      if (b.date <= today || b.date > to) continue;
      const amount = b.amount + (b.row?.locked ? 0 : extra(b.card.id, b.closingYm));
      if (amount > 0) rows.push({ date: b.date, name: `${b.card.name} ${+b.closingYm.slice(5)}月分`, amount: -amount, kind: "bill", virtual: !b.row, ref: b.row ? { kind: "account", id: b.row.id } : { kind: "virtual", id: `bill:${b.card.id}:${b.date}` } });
    }
  }
  for (const l of d.v5.loans) for (const r of loanPayments(d, l, today, to)) rows.push({ date: r.date, name: r.name, amount: -r.amount, kind: "loan", virtual: true, ref: r.ref });
  return rows.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}

/** t の日の終わりの口座残高（t が今日より後なら見込み） */
export function bankAhead(d: Data, t: string, today: string, rows = projectedRows(d, today, t)): { amount: number; rows: PartRow[] } {
  const now = bankOn(d, today);
  if (t <= today) return bankOn(d, t);
  const ahead = rows.filter((r) => r.date <= t);
  return { amount: ahead.reduce((a, r) => a + r.amount, now.amount), rows: [...now.rows, ...ahead.map((r) => ({ date: r.date, name: r.name, amount: r.amount, plan: true, ref: r.ref }))] };
}

/** t の日の余裕額（今日より後なら見込み） */
export function slackOn(d: Data, t: string, today: string, rows?: FlowRow5[]): Part {
  if (t <= today) return slackAt(d, t, today);
  const extra = assumed(d, today), ym = ymOf(t);
  return slackAt(d, t, today, { bank: bankAhead(d, t, today, rows), projected: true, extraBill: (b) => (b.closingYm < ym && !b.row?.locked ? extra(b.card.id, b.closingYm) : 0) });
}

/** from〜to の日ごとの口座残高と余裕額。過去は記録から計算し直す */
export function outlook(d: Data, today: string, from: string, to: string): { date: string; bank: number; slack: number }[] {
  const rows = projectedRows(d, today, to);
  const out: { date: string; bank: number; slack: number }[] = [];
  for (let t = from; t <= to; t = addDays(t, 1)) out.push({ date: t, bank: bankAhead(d, t, today, rows).amount, slack: slackOn(d, t, today, rows).amount });
  return out;
}

/** 返済の計画の3つ：返す額の見込み・その日の口座残高の見込み（返す前）と返せるか・返した後の余裕額 */
export function repayView(d: Data, p: V5Plan, today: string): { due: Part; bankThen: Part; ok: boolean; slackAfter: Part } | null {
  if (p.kind !== "repay" || !p.due_date) return null;
  const date = p.due_date;
  const loans = d.v5.loans.filter((l) => l.plan_id === p.id);
  const due = sum("repayDue", "返す額の見込み", loans.map((l) => loanAt(d, l, addDays(date, -1))));
  const rows = projectedRows(d, today, date);
  const lump = rows.filter((r) => r.kind === "loan" && r.date === date && r.ref.id.includes(":lump:")).reduce((a, r) => a - r.amount, 0);
  const bank = bankAhead(d, date, today, rows);
  const bankThen = leaf("bankThen", `${+date.slice(5, 7)}/${+date.slice(8)}の口座残高の見込み（返す前）`, bank.amount + lump);
  return { due, bankThen: { ...bankThen, rows: bank.rows }, ok: bankThen.amount >= due.amount, slackAfter: slackOn(d, date, today, rows) };
}

/** 今日〜to で口座残高が一番少なくなる日と額 */
export function lowest(d: Data, today: string, to: string): { date: string; bank: number } {
  let bank = bankOn(d, today).amount;
  let best = { date: today, bank };
  for (const r of projectedRows(d, today, to)) {
    bank += r.amount;
    if (bank < best.bank) best = { date: r.date, bank };
  }
  return best;
}

