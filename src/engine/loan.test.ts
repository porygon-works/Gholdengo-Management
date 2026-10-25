import { describe, expect, it } from "vitest";
import { card, D } from "./fixture";
import { guideOf, loanAt, loanCorrections, loanPayments, loansAt, type Loan, type LoanBalance, type V5Plan } from "./index";

// 借入（設計書 §3.4）。値はすべて作り物
const L: Loan = { id: "l1", plan_id: null, name: "セゾンのリボ", card: "saison", monthly: 10000, pay_day: null, sort: 0 };
const B = (date: string, balance: number, at?: string): LoanBalance => ({ id: `${date}${at ?? ""}`, loan_id: "l1", date, balance, at });
const repay = (due: string): V5Plan => ({ id: "p1", kind: "repay", name: "リボを返す", target: 0, due_date: due, monthly: 0, start_month: null, draw_order: 0, no_draw: false, done: false, sort: 0 });

describe("借入残高", () => {
  it("毎月の返済（カードの引落日）の分だけ減る", () => {
    const d = D({ v5: { loans: [L], balances: [B("2026-10-10", 200000)] } });
    expect(loanPayments(d, L, "2026-10-10", "2026-12-31").map((r) => [r.date, r.amount])).toEqual([["2026-11-04", 10000], ["2026-12-04", 10000]]);
    expect(loanAt(d, L, "2026-12-31").amount).toBe(180000);
  });
  it("リボに回した明細（そのカードの分割（購入））の分だけ増える", () => {
    const d = D({ cards: [card({ card: "saison", date: "2026-11-20", amount: 80000, group: "purchase", category: "家賃" })], v5: { loans: [L], balances: [B("2026-10-10", 200000)] } });
    const p = loanAt(d, L, "2026-11-30");
    expect(p.amount).toBe(270000);
    expect(p.parts!.map((x) => [x.key, x.amount])).toEqual([["recorded", 200000], ["purchase", 80000], ["paid", 10000]]);
  });
  it("期日にまとめて返す計画があれば、その日に残りを全部返し、あとは0", () => {
    const d = D({ v5: { plans: [repay("2026-12-27")], loans: [{ ...L, plan_id: "p1" }], balances: [B("2026-10-10", 50000)] } });
    const rows = loanPayments(d, d.v5.loans[0], "2026-10-10", "2027-02-28");
    expect(rows.at(-1)).toMatchObject({ date: "2026-12-27", amount: 30000 });
    expect(rows.length).toBe(3);
    expect(loanAt(d, d.v5.loans[0], "2027-02-28").amount).toBe(0);
  });
  it("同じ日に2回直したら、あとから入れたほうを使う。修正は1回分ずつ出る", () => {
    const d = D({ v5: { loans: [L], balances: [B("2026-10-10", 200000), B("2026-11-10", 260000, "2026-11-10T10:00:00Z"), B("2026-11-10", 255000, "2026-11-10T11:00:00Z")] } });
    expect(loanAt(d, L, "2026-11-10").amount).toBe(255000);
    // 10/10 の 20万から 11/4 の返済 1万で 19万 → 26万（+7万）→ 25.5万（−5千）
    expect(loanCorrections(d, L).map((r) => r.amount)).toEqual([70000, -5000]);
  });
  it("引落日が土日祝なら翌営業日に返す", () => {
    // 2027-09-04 は土曜
    const d = D({ v5: { loans: [L], balances: [B("2027-08-10", 50000)] } });
    expect(loanPayments(d, L, "2027-08-10", "2027-09-30")[0].date).toBe("2027-09-06");
  });
  it("返す先ごとの合計と、目安額に入る毎月の返済", () => {
    const L2: Loan = { ...L, id: "l2", name: "口座から返す", card: null, pay_day: 27, monthly: 5000 };
    const d = D({ v5: { loans: [L, L2], balances: [B("2026-10-10", 200000), { ...B("2026-10-10", 30000), id: "x", loan_id: "l2" }] } });
    expect(loansAt(d, "2026-10-31").amount).toBe(225000);
    expect(guideOf(d, "2026-11").parts!.find((p) => p.key === "loanMonthly")!.amount).toBe(15000);
  });
});
