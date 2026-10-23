import { describe, expect, it } from "vitest";
import { ACCOUNT_GROUP_LABEL, DEFAULT_SETTINGS, IN_GROUPS } from "../engine";
import type { Raw } from "./backend";
import { toData } from "./store";

// v5 の表の読み込み（値はすべて作り物）
const empty = (): Raw => ({
  account_entries: [], card_entries: [], goals: [], entries: [], balances: [], card_bills: [], recurring: [], budgets: [], rules: [], debts: [], settings: [], review: [],
  plans: [], plan_debts: [], plan_funds: [], months: [],
} as unknown as Raw);

describe("v5 の表を読む", () => {
  it("v5 の表がなければ、全部空として読む", () => {
    expect(toData(empty()).v5).toEqual({ plans: [], loans: [], balances: [], moves: [], months: [] });
  });

  it("v5 の表の数値の列は number にする", () => {
    const raw = {
      ...empty(),
      v5_plans: [{ id: "p1", kind: "save", name: "生活費1か月分", target: "300000", due_date: null, monthly: "50000", start_month: "2026-11", draw_order: 1, no_draw: false, done: false, sort: 0 }],
      v5_loans: [{ id: "l1", plan_id: null, name: "セゾンのリボ", card: "saison", monthly: "10000", pay_day: null, sort: 0 }],
      v5_loan_balances: [{ id: "b1", loan_id: "l1", date: "2026-10-01", balance: "200000", created_at: "2026-10-01T10:00:00Z" }],
      v5_moves: [{ id: "m1", plan_id: "p1", kind: "manual", amount: "20000", date: "2026-11-05", bonus_entry_id: null, entry_kind: null, entry_id: null, memo: "" }],
      v5_months: [{ month: "2026-11", budget: "170000", source: "decided" }],
    } as unknown as Raw;
    const v5 = toData(raw).v5;
    expect(v5.plans[0]).toMatchObject({ kind: "save", target: 300000, monthly: 50000, start_month: "2026-11", draw_order: 1, no_draw: false });
    expect(v5.loans[0]).toMatchObject({ card: "saison", monthly: 10000, pay_day: null });
    expect(v5.balances[0]).toMatchObject({ loan_id: "l1", date: "2026-10-01", balance: 200000 });
    expect(v5.moves[0]).toMatchObject({ kind: "manual", amount: 20000 });
    expect(v5.months[0]).toEqual({ month: "2026-11", budget: 170000, source: "decided" });
  });

  it("口座明細の大費目に賞与がある", () => {
    expect(IN_GROUPS).toContain("bonus");
    expect(ACCOUNT_GROUP_LABEL.bonus).toBe("賞与");
    const raw = { ...empty(), account_entries: [{ id: "a1", account: "bank", direction: "in", status: "plan", group: "bonus", name: "賞与", date: "2026-12-10", amount: "300000" }] } as unknown as Raw;
    expect(toData(raw).accounts[0].group).toBe("bonus");
  });

  it("変動費の費目に「現金」がある（ATM の引き出し）", () => {
    expect(DEFAULT_SETTINGS.varCats).toContain("現金");
  });
});
