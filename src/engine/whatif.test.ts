import { describe, expect, it } from "vitest";
import { acc, bal, D, example } from "./fixture";
import { applyChange, compare, type Data, type V5Plan } from "./index";

// 予定を入れる前の比べ（設計書 §4.3・§3.5）。値はすべて作り物
const P = (id: string, saved: number, p: Partial<V5Plan> = {}) => ({
  plan: { id, kind: "save" as const, name: id, target: 0, due_date: null, monthly: 0, start_month: null, draw_order: 0, no_draw: false, done: false, sort: 0, ...p },
  move: { id: `m${id}`, plan_id: id, kind: "manual" as const, amount: saved, date: "2026-11-01", bonus_entry_id: null, entry_kind: null, entry_id: null, memo: "" },
});

describe("予定を入れる前の比べ", () => {
  it("来月の予備に 3万の予定を入れると、来月の予算残額が足りない分が出る。予算に足すと今日の余裕額が減る", () => {
    const d = example();
    const wedding = { account: "bank" as const, direction: "out" as const, status: "plan" as const, group: "variable" as const, category: null, name: "結婚式", memo: "", date: "2026-12-12", amount: 30000, source: "manual" as const, source_ref: null, recurring_id: null, goal_id: null, card: null, pair_id: null, locked: true };
    // 12月の予算 17万のうち、15万はもう予定がある
    const busy: Data = { ...d, accounts: [...d.accounts, acc({ status: "plan", date: "2026-12-05", amount: 150000, name: "旅行" })] };
    const c = compare(busy, { kind: "addAccount", entry: wedding }, "2026-11-01");
    expect(c.budget).toEqual({ month: "2026-12", before: 20000, after: -10000 });
    expect(c.shortBudget).toBe(10000);
    const add = compare(busy, { kind: "decideBudget", month: "2026-12", amount: 180000 }, "2026-11-01");
    expect(add.slack[0] - add.slack[1]).toBe(10000);
  });

  it("余裕額が 0 以上からマイナスになるときだけ、マイナスの分を取崩順に差し引く", () => {
    const a = P("A", 20000, { draw_order: 1 }), b = P("B", 90000, { draw_order: 2, no_draw: true });
    const d = D({ balances: [bal("2026-11-01", 115000)], v5: { plans: [a.plan, b.plan], moves: [a.move, b.move] } });
    // 余裕額 ＝ 11.5万 − 確保額 11万 ＝ 5千。2026-12 の予算を 1万 決める（目安額 0）と −5千
    const c = compare(d, { kind: "decideBudget", month: "2026-12", amount: 10000 }, "2026-11-05");
    expect(c.slack).toEqual([5000, -5000]);
    expect(c.draw!.map((x) => [x.plan.id, x.amount])).toEqual([["A", 5000]]);
    expect(c.warnOnly).toBe(false);
  });

  it("もとからマイナスなら確認は出さず、注意だけ", () => {
    const d = D({ balances: [bal("2026-11-01", 0)], v5: { loans: [{ id: "l", plan_id: null, name: "リボ", card: null, monthly: 0, pay_day: 27, sort: 0 }], balances: [{ id: "x", loan_id: "l", date: "2026-11-01", balance: 200000 }] } });
    const c = compare(d, { kind: "decideBudget", month: "2026-12", amount: 10000 }, "2026-11-05");
    expect(c.slack).toEqual([-200000, -210000]);
    expect(c.draw).toBeNull();
    expect(c.warnOnly).toBe(true);
  });

  it("元のデータは変えない", () => {
    const d = example();
    const before = JSON.stringify(d);
    applyChange(d, { kind: "decideBudget", month: "2026-12", amount: 1 });
    expect(JSON.stringify(d)).toBe(before);
  });
});
