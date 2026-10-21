import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../engine";
import { planOps } from "./ops";
import type { AppData } from "./store";

// 値はすべて作り物
const d: AppData = {
  accounts: [{ id: "a1", account: "bank", direction: "out", status: "plan", group: "fixed", category: "奨学金", name: "奨学金", memo: "", date: "2026-11-27", amount: 30000, source: "recurring", source_ref: "rec:r1:2026-11", recurring_id: "r1", goal_id: null, card: null, pair_id: null, locked: false }],
  cards: [],
  balances: [],
  recurring: [{ id: "r1", name: "奨学金", kind: "expense", group: "fixed", category: "奨学金", amount: 30000, day: 27, shift: "next", pay: "bank", card: null, shop: "", every: 1, start_month: null, end_month: null, active: true }],
  goals: [{ id: "g1", kind: "repay", name: "リボ", card: "saison", balance: 50000, as_of: "2026-10-19", target: 0, monthly: 10000, day: 27, start_month: null, end_month: null, lumps: [], active: true, sort: 0 }],
  budgets: [{ month: "2026-10", category: "食料品", amount: 17000 }],
  rules: [{ id: "u1", pattern: "サンプル", category: "食料品" }],
  settings: DEFAULT_SETTINGS,
  review: [],
};
const ops = (list: unknown[]) => ({ format: "gholdengo-ops-v1", note: "テスト", ops: list });

describe("Claude との相談の取り込み（gholdengo-ops-v1）", () => {
  it("予算・目標・定期・明細を、足す・直す・消すに分けて出す", () => {
    const r = planOps(d, ops([
      { op: "set", table: "budgets", key: { month: "2026-11", category: "食料品" }, data: { amount: 18000 } },
      { op: "set", table: "goals", key: { name: "リボ" }, data: { monthly: 12000, lumps: [{ date: "2026-12-15", amount: 0, memo: "賞与から全額" }] } },
      { op: "set", table: "recurring", key: { name: "年払いのサービス" }, data: { kind: "expense", group: "fixed", category: "サブスク", amount: 2400, day: 10, pay: "card", every: 12, start_month: "2026-12" } },
      { op: "delete", table: "recurring", key: { name: "奨学金" } },
      { op: "set", table: "account_entries", key: { ref: "claude:bonus-2026-12" }, data: { direction: "in", group: "other", name: "賞与", date: "2026-12-10", amount: 100000 } },
      { op: "set", table: "settings", data: { safety: 10000 } },
    ]));
    expect(r.errors).toEqual([]);
    expect(r.changes.map((c) => [c.table, c.kind])).toEqual([["budgets", "add"], ["goals", "update"], ["recurring", "add"], ["recurring", "delete"], ["account_entries", "add"], ["settings", "update"]]);
    expect(r.changes[0].label).toBe("予算 2026-11 食料品：¥17,000 → ¥18,000"); // 引き継いでいる額から
    expect(r.changes[1].label).toContain("monthly：¥10,000 → ¥12,000");
  });
  it("書けない項目・見つからない行・足すのに足りない項目はエラーにして、何も変えない", () => {
    const r = planOps(d, ops([
      { op: "set", table: "goals", key: { name: "リボ" }, data: { user_id: "x" } },
      { op: "delete", table: "rules", key: { pattern: "ない店" } },
      { op: "set", table: "card_entries", key: { ref: "claude:x" }, data: { name: "日付がない" } },
      { op: "set", table: "budgets", key: { month: "11月", category: "食料品" }, data: { amount: 1 } },
      { op: "drop", table: "budgets" },
    ]));
    expect(r.errors).toHaveLength(5);
    expect(planOps(d, { format: "gholdengo-import-v1" }).errors).toHaveLength(1);
  });
});
