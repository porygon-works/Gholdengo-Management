import { describe, expect, it } from "vitest";
import { acc, bal, card, D, S } from "./fixture";
import { budgetView, guideOf, outlook, planMonthlyOf, plannedBonus, savedAt, savingsTotal, slackAt, slackValue, type PlanMove, type V5Plan } from "./index";

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
  it("使う日のある貯蓄計画に余裕額から入れると、その分だけ余裕額が減る（確保額）", () => {
    const base = { balances: [bal("2026-11-01", 100000)] };
    const plan = P({ kind: "buy", due_date: "2027-03-31", monthly: 0 });
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

describe("使う日のない貯蓄計画", () => {
  it("入れても余裕額は変わらない。たまった額は「うち貯蓄」に出て、確保額には入らない", () => {
    const base = { balances: [bal("2026-11-01", 100000)] };
    const plan = P({ monthly: 0 });
    const before = slackValue(D({ ...base, v5: { plans: [plan] } }), "2026-11-05", "2026-11-05");
    const d = D({ ...base, v5: { plans: [plan], moves: [M({ amount: 20000 })] } });
    expect(slackValue(d, "2026-11-05", "2026-11-05")).toBe(before);
    expect(slackAt(d, "2026-11-05", "2026-11-05").parts!.find((p) => p.key === "reserve")!.amount).toBe(0);
    expect(savingsTotal(d, "2026-11-05").amount).toBe(20000);
  });
  it("予算を使い切っても、毎月の積立額の分だけ余裕額が月ごとに上がる", () => {
    const d = D({ balances: [bal("2026-10-31", 100000)], settings: { ...S, salaryEstimate: 200000 }, v5: { plans: [P({ monthly: 20000, target: 0, start_month: "2026-11" })] } });
    const days = outlook(d, "2026-11-01", "2026-11-01", "2027-02-28");
    const slack = (t: string) => days.find((x) => x.date === t)!.slack;
    expect(slack("2027-01-02") - slack("2026-12-02")).toBe(20000);
    expect(slack("2027-02-02") - slack("2027-01-02")).toBe(20000);
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
