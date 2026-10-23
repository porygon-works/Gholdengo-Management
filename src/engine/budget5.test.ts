import { describe, expect, it } from "vitest";
import { acc, card, D, S } from "./fixture";
import { budgetView, guideOf, monthBudget, total } from "./index";

// v5 の月の予算（設計書 §3.2）。値はすべて作り物
const base = () => ({
  budgets: [{ month: "2026-11", category: "家賃", amount: 80000 }, { month: "2026-11", category: "食料品", amount: 30000 }],
  accounts: [acc({ direction: "in", group: "salary", date: "2026-11-16", amount: 250000, status: "plan" })],
});

describe("目安額", () => {
  it("給与の見込み − 固定費 − 借入の毎月の返済 − 計画の毎月の積立額", () => {
    const g = guideOf(D(base()), "2026-11");
    expect(g.amount).toBe(170000);
    expect(g.parts!.map((p) => p.key)).toEqual(["salary", "fixed", "loanMonthly", "planMonthly"]);
    expect(total(g.parts!)).toBe(170000);
  });
  it("その月に給与の入金がなければ、設定の給与の見込みを使う", () => {
    const g = guideOf(D({ ...base(), accounts: [], settings: { ...S, salaryEstimate: 240000 } }), "2026-11");
    expect(g.parts![0].amount).toBe(240000);
    expect(g.amount).toBe(160000);
  });
});

describe("月の予算", () => {
  it("決めた額があればその額、なければ目安額", () => {
    expect(monthBudget(D(base()), "2026-11")).toMatchObject({ amount: 170000, source: "live" });
    expect(monthBudget(D({ ...base(), v5: { months: [{ month: "2026-11", budget: 150000, source: "decided" }] } }), "2026-11")).toMatchObject({ amount: 150000, source: "decided" });
  });
  it("目安額で保存した月は、あとで給与の見込みが変わっても動かない", () => {
    const d = D({ ...base(), accounts: [acc({ direction: "in", group: "salary", date: "2026-11-16", amount: 260000, status: "plan" })], v5: { months: [{ month: "2026-11", budget: 170000, source: "guide" }] } });
    expect(monthBudget(d, "2026-11")).toMatchObject({ amount: 170000, source: "guide" });
  });
});

describe("予算残額と費目別残額", () => {
  it("費目の使いすぎは予備で埋めず、その費目をマイナスにする", () => {
    const d = D({ ...base(), cards: [card({ date: "2026-11-05", amount: 35000, category: "食料品" })] });
    const v = budgetView(d, "2026-11", "2026-11-20");
    const food = v.cats.find((c) => c.cat === "食料品")!;
    expect(food.left).toBe(-5000);
    expect(food.over).toBe(true);
    expect(v.cats.find((c) => c.cat === "予備")!.left).toBe(140000);
    expect(v.left.amount).toBe(135000);
  });
  it("まとめられた明細は数えない", () => {
    const d = D({ ...base(), cards: [card({ id: "keep", date: "2026-11-05", amount: 3000 }), card({ date: "2026-11-05", amount: 3000, merged_into: "keep" })] });
    expect(budgetView(d, "2026-11", "2026-11-20").left.amount).toBe(167000);
  });
  it("固定費が見込みをこえた分は予算残額から引く", () => {
    const d = D({ ...base(), cards: [card({ card: "saison", date: "2026-11-01", amount: 85000, group: "fixed", category: "家賃" })] });
    const v = budgetView(d, "2026-11", "2026-11-20");
    expect(v.left.parts!.find((p) => p.key === "fixedOver")!.amount).toBe(5000);
    expect(v.left.amount).toBe(165000);
    expect(v.fixed).toEqual({ budget: 80000, used: 85000 });
  });
  it("リボに回した明細（分割（購入））も、その費目で予算に数える", () => {
    const d = D({ ...base(), cards: [card({ card: "saison", date: "2026-11-01", amount: 80000, group: "purchase", category: "家賃" })] });
    expect(budgetView(d, "2026-11", "2026-11-20").fixed).toEqual({ budget: 80000, used: 80000 });
  });
  it("計画にひも付けた購入は予算に数えない", () => {
    const d = D({ ...base(), cards: [card({ id: "pc", date: "2026-11-05", amount: 60000 })], v5: { moves: [{ id: "m", plan_id: "p", kind: "spend", amount: 60000, date: "2026-11-05", bonus_entry_id: null, entry_kind: "card", entry_id: "pc", memo: "" }] } });
    expect(budgetView(d, "2026-11", "2026-11-20").left.amount).toBe(170000);
  });
});
