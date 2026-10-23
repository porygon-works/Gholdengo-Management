import { describe, expect, it } from "vitest";
import { acc, bal, card, D } from "./fixture";
import { budgetView, drawPlan, guideOf, planMonthlyOf, plannedBonus, savedAt, slackValue, type PlanMove, type V5Plan } from "./index";

// 計画（設計書 §3.3）。値はすべて作り物
const P = (p: Partial<V5Plan>): V5Plan => ({ id: p.id ?? "p1", kind: "save", name: "生活費1か月分", target: 300000, due_date: null, monthly: 50000, start_month: "2026-11", draw_order: 0, no_draw: false, done: false, sort: 0, ...p });
const M = (p: Partial<PlanMove>): PlanMove => ({ id: p.id ?? "m1", plan_id: "p1", kind: "manual", amount: 0, date: "2026-11-05", bonus_entry_id: null, entry_kind: null, entry_id: null, memo: "", ...p });
const bonus = (status: "plan" | "confirmed", amount = 300000) => acc({ id: "bn", direction: "in", group: "bonus", name: "賞与", date: "2026-12-10", amount, status });

describe("積立額", () => {
  it("毎月の積立額は月の初めに入り、目標額で止まる", () => {
    const d = D({ v5: { plans: [P({})] } });
    expect(savedAt(d, d.v5.plans[0], "2026-12-15").amount).toBe(100000);
    expect(savedAt(d, d.v5.plans[0], "2027-06-01").amount).toBe(300000);
    expect(planMonthlyOf(d, "2027-04")).toBe(50000);
    expect(planMonthlyOf(d, "2027-05")).toBe(0);
    expect(guideOf(d, "2026-11").parts!.find((p) => p.key === "planMonthly")!.amount).toBe(50000);
  });
  it("余裕額から入れると、その分だけ余裕額が減る", () => {
    const base = { balances: [bal("2026-11-01", 100000)] };
    const plan = P({ monthly: 0 });
    const before = slackValue(D({ ...base, v5: { plans: [plan] } }), "2026-11-05", "2026-11-05");
    const after = slackValue(D({ ...base, v5: { plans: [plan], moves: [M({ amount: 20000 })] } }), "2026-11-05", "2026-11-05");
    expect(before - after).toBe(20000);
  });
  it("賞与からの配分は、賞与が確定してから積立額に入る。賞与の額を直しても配分は変わらない", () => {
    const plan = P({ monthly: 0 });
    const move = M({ kind: "bonus", amount: 250000, date: "2026-12-10", bonus_entry_id: "bn" });
    const planned = D({ accounts: [bonus("plan")], v5: { plans: [plan], moves: [move] } });
    expect(savedAt(planned, plan, "2026-12-11").amount).toBe(0);
    expect(savedAt(planned, plan, "2026-12-11", true).amount).toBe(250000);
    expect(plannedBonus(planned, plan).map((r) => r.amount)).toEqual([250000]);
    const done = D({ accounts: [bonus("confirmed", 280000)], v5: { plans: [plan], moves: [move] } });
    expect(savedAt(done, plan, "2026-12-11").amount).toBe(250000);
  });
  it("終わった計画の積立額は0（余裕額に戻る）", () => {
    const d = D({ v5: { plans: [P({ done: true })] } });
    expect(savedAt(d, d.v5.plans[0], "2026-12-15").amount).toBe(0);
    expect(planMonthlyOf(d, "2026-12")).toBe(0);
  });
});

describe("取崩順", () => {
  it("取崩順に、取崩不可を除いて差し引く", () => {
    const d = D({ v5: {
      plans: [P({ id: "A", monthly: 0, draw_order: 1 }), P({ id: "B", monthly: 0, draw_order: 2, no_draw: true }), P({ id: "C", monthly: 0, draw_order: 3 })],
      moves: [M({ id: "1", plan_id: "A", amount: 20000 }), M({ id: "2", plan_id: "B", amount: 90000 }), M({ id: "3", plan_id: "C", amount: 50000 })],
    } });
    expect(drawPlan(d, 30000, "2026-11-10").map((x) => [x.plan.id, x.amount])).toEqual([["A", 20000], ["C", 10000]]);
  });
});

describe("計画にひも付けた購入", () => {
  it("予算に数えず積立額から払う。足りない分は余裕額が受ける", () => {
    const plan = P({ kind: "buy", target: 60000, monthly: 0, due_date: "2026-11-20" });
    const base = { balances: [bal("2026-11-01", 200000)], cards: [card({ id: "pc", date: "2026-11-20", amount: 65000 })] };
    const moves = [M({ amount: 60000, date: "2026-11-02" })];
    const unlinked = D({ ...base, v5: { plans: [plan], moves } });
    const linked = D({ ...base, v5: { plans: [plan], moves: [...moves, M({ id: "s", kind: "spend", amount: 65000, date: "2026-11-20", entry_kind: "card", entry_id: "pc" })] } });
    expect(budgetView(linked, "2026-11", "2026-11-21").left.amount).toBe(budgetView(unlinked, "2026-11", "2026-11-21").left.amount + 65000);
    expect(savedAt(linked, plan, "2026-11-21").amount).toBe(0);
    // ひも付ける前：積立 6万は確保額、6.5万は予算から（予算が0なので予算残額は0のまま）。ひも付けたあと：確保額 0、予算に数えない
    expect(slackValue(linked, "2026-11-21", "2026-11-21") - slackValue(unlinked, "2026-11-21", "2026-11-21")).toBe(60000);
  });
});
