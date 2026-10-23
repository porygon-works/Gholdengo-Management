import { addMonths, dayOf, lastDay, shiftBusiness, ymOf } from "./dates";
import { isLive } from "./merge";
import { ofRows, sum, type Part, type PartRow } from "./breakdown";
import { cardOf, cardPayDate, closingFor } from "./schedule";
import type { CardEntry, Data, Loan, LoanBalance } from "./types";

// 借入（設計書 §3.4）。毎月の返済とまとめての返済は保存せず、借入残高の記録から毎回出す

/** その月の毎月の返済の日。カードならその引落日、なければ pay_day（土日祝は翌営業日） */
export function loanPayDate(d: Data, loan: Loan, ym: string): string {
  if (loan.card) return cardPayDate(closingFor(ym, d.settings, loan.card), d.settings, loan.card);
  return shiftBusiness(dayOf(ym, loan.pay_day || 27), "next");
}

/** その借入のカードでリボに回した明細（分割（購入）） */
export const revolvedOf = (d: Data, loan: Loan): CardEntry[] =>
  loan.card ? d.cards.filter((e) => isLive(e) && e.group === "purchase" && cardOf(d.settings, e.card).id === loan.card) : [];

const records = (d: Data, loan: Loan): LoanBalance[] =>
  d.v5.balances.filter((b) => b.loan_id === loan.id).sort((a, b) => a.date.localeCompare(b.date) || (a.at ?? "").localeCompare(b.at ?? ""));

type Ev =
  | { kind: "record"; date: string; rec: LoanBalance; before: number; after: number }
  | { kind: "purchase"; date: string; entry: CardEntry; after: number }
  | { kind: "pay" | "lump"; date: string; row: PartRow; after: number };

/**
 * 最初の記録から until までの借入残高の動き。同じ日は リボに回す → 返済 → まとめて返す → 記録 の順（記録はその日の動きのあとに見た額とする）
 */
function timeline(d: Data, loan: Loan, until: string): Ev[] {
  const recs = records(d, loan);
  if (!recs.length || recs[0].date > until) return [];
  const start = recs[0].date;
  const plan = loan.plan_id ? d.v5.plans.find((p) => p.id === loan.plan_id && p.kind === "repay" && !p.done && p.due_date) : undefined;
  type Raw = { date: string; order: number; run: (bal: number) => Ev };
  const raw: Raw[] = [];
  for (const e of revolvedOf(d, loan)) if (e.date > start && e.date <= until) raw.push({ date: e.date, order: 0, run: (b) => ({ kind: "purchase", date: e.date, entry: e, after: b + e.amount }) });
  for (let ym = ymOf(start); ym <= ymOf(until); ym = addMonths(ym, 1)) {
    const date = loanPayDate(d, loan, ym);
    if (date <= start || date > until || !loan.monthly) continue;
    raw.push({ date, order: 1, run: (b) => { const amount = Math.min(loan.monthly, b); return { kind: "pay", date, row: row(loan, date, amount, "pay"), after: b - amount }; } });
  }
  if (plan && plan.due_date! > start && plan.due_date! <= until) {
    const date = plan.due_date!;
    raw.push({ date, order: 2, run: (b) => ({ kind: "lump", date, row: row(loan, date, b, "lump"), after: 0 }) });
  }
  recs.forEach((rec, i) => { if (i > 0 && rec.date <= until) raw.push({ date: rec.date, order: 3, run: (b) => ({ kind: "record", date: rec.date, rec, before: b, after: rec.balance }) }); });
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let bal = recs[0].balance;
  const out: Ev[] = [{ kind: "record", date: start, rec: recs[0], before: bal, after: bal }];
  for (const r of raw) {
    const ev = r.run(bal);
    // 0 になったあとの返済の行は出さない
    if ((ev.kind === "pay" || ev.kind === "lump") && ev.row.amount <= 0) continue;
    out.push(ev);
    bal = ev.after;
  }
  return out;
}

const row = (loan: Loan, date: string, amount: number, kind: "pay" | "lump"): PartRow => ({
  date, name: kind === "pay" ? `${loan.name}の返済` : `${loan.name}をまとめて返す`, amount, plan: true, ref: { kind: "virtual", id: `loan:${loan.id}:${kind}:${date}` },
});

/** 返済の行（毎月の返済とまとめての返済）。from より後、to まで */
export function loanPayments(d: Data, loan: Loan, from: string, to: string): PartRow[] {
  return timeline(d, loan, to).flatMap((e) => (e.kind === "pay" || e.kind === "lump") && e.date > from ? [e.row] : []);
}

/** t の日の借入残高 ＝ 記録した残高 ＋ そのあとリボに回した分 − そのあと返した分 */
export function loanAt(d: Data, loan: Loan, t: string): Part {
  const evs = timeline(d, loan, t);
  const recIdx = evs.map((e) => e.kind).lastIndexOf("record");
  if (recIdx < 0) return { key: `loan:${loan.id}`, label: loan.name, amount: 0, sign: 1, parts: [] };
  const rec = evs[recIdx] as Extract<Ev, { kind: "record" }>;
  const after = evs.slice(recIdx + 1);
  const purchase = after.flatMap((e) => (e.kind === "purchase" ? [{ date: e.date, name: e.entry.name || e.entry.category || "リボに回した明細", amount: e.entry.amount, plan: false, ref: { kind: "card" as const, id: e.entry.id } }] : []));
  const paid = after.flatMap((e) => (e.kind === "pay" || e.kind === "lump" ? [e.row] : []));
  return sum(`loan:${loan.id}`, loan.name, [
    { key: "recorded", label: `記録した残高（${+rec.date.slice(5, 7)}/${+rec.date.slice(8)}）`, amount: rec.rec.balance, sign: 1, rows: [{ date: rec.date, name: "記録した残高", amount: rec.rec.balance, plan: false, ref: { kind: "virtual", id: `loanbal:${rec.rec.id}` } }] },
    ofRows("purchase", "リボに回した分", purchase),
    ofRows("paid", "返した分", paid, -1),
  ]);
}

/** 借入残高の修正：記録ごとの、1つ前の記録から計算した額との差 */
export function loanCorrections(d: Data, loan: Loan): PartRow[] {
  const last = records(d, loan).at(-1);
  if (!last) return [];
  return timeline(d, loan, last.date).flatMap((e, i) => (e.kind === "record" && i > 0 && e.after !== e.before
    ? [{ date: e.date, name: "借入残高の修正", amount: e.after - e.before, plan: false, ref: { kind: "virtual" as const, id: `loanbal:${e.rec.id}` } }] : []));
}

/** t の日の借入残高の合計（返す先ごと） */
export const loansAt = (d: Data, t: string): Part => sum("loans", "借入残高", d.v5.loans.map((l) => loanAt(d, l, t)));

/** その月の、借入の毎月の返済の見込みの行（まとめての返済は除く） */
export function loanMonthlyOf(d: Data, ym: string): PartRow[] {
  const end = dayOf(ym, lastDay(ym));
  return d.v5.loans.flatMap((l) => timeline(d, l, end).flatMap((e) => (e.kind === "pay" && ymOf(e.date) === ym ? [e.row] : [])));
}
