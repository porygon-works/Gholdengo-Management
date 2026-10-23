import { describe, expect, it } from "vitest";
import { acc, bal, card, D, S } from "./fixture";
import { slackAt, slackValue, type Data, type Loan, type Part, type V5Plan } from "./index";

// 最後のレビューで見つかった、余裕額が跳ねる場面（値はすべて作り物）
const part = (p: Part, ...keys: string[]): Part => keys.reduce((x, k) => x.parts!.find((y) => y.key === k)!, p);
const loan = (p: Partial<Loan>): Loan => ({ id: "l1", plan_id: null, name: "リボ", card: null, monthly: 20000, pay_day: 27, sort: 0, ...p });
const lb = (date: string, balance: number, loan_id = "l1") => ({ id: `${loan_id}${date}`, loan_id, date, balance });
const plan = (p: Partial<V5Plan>): V5Plan => ({ id: "p1", kind: "buy", name: "買い物", target: 60000, due_date: "2026-11-30", monthly: 0, start_month: null, draw_order: 1, no_draw: false, done: false, sort: 0, ...p });
const budget = [{ month: "2026-11", category: "食料品", amount: 50000 }];
const salary = (date: string) => acc({ direction: "in", group: "salary", date, amount: 200000, status: "plan" });

describe("C-1：借入の返済の日に余裕額が跳ねない", () => {
  it("口座から返す借入：返済の日（今日）の前後で同じ", () => {
    const d = D({ balances: [bal("2026-11-01", 400000)], v5: { loans: [loan({})], balances: [lb("2026-10-10", 150000)] } });
    expect(slackValue(d, "2026-11-27", "2026-11-27")).toBe(slackValue(d, "2026-11-26", "2026-11-26"));
  });
  it("期日にまとめて返す日：前後で同じ", () => {
    const d = D({ balances: [bal("2026-12-01", 500000)], v5: { plans: [plan({ id: "rp", kind: "repay", target: 0, due_date: "2026-12-28" })], loans: [loan({ plan_id: "rp", monthly: 0 })], balances: [lb("2026-12-01", 300000)] } });
    expect(slackValue(d, "2026-12-28", "2026-12-28")).toBe(slackValue(d, "2026-12-25", "2026-12-25"));
  });
});

describe("I-1：カードの請求と一緒に返す借入。請求が見込みの額で確定しても跳ねない", () => {
  it("12/4 の請求（明細 1万だけの見込みで確定）の前後で同じ", () => {
    const base = { balances: [bal("2026-11-20", 400000)], cards: [card({ card: "saison", date: "2026-11-10", amount: 10000, category: "食料品" })], budgets: budget, v5: { loans: [loan({ card: "saison", pay_day: null })], balances: [lb("2026-10-10", 100000)] } };
    const before = D(base);
    const after = D({ ...base, accounts: [acc({ group: "card", card: "saison", date: "2026-12-04", amount: 10000, source: "card_bill", source_ref: "bill:saison:2026-12-04", locked: false })] });
    expect(slackValue(after, "2026-12-04", "2026-12-04")).toBe(slackValue(before, "2026-12-03", "2026-12-03"));
  });
});

describe("I-2：計画にひも付けた購入が、まとめられたり消されたりしても二重にならない", () => {
  it("手で入れた明細をひも付け、メールの明細にまとめられても同じ", () => {
    const moves = [
      { id: "in", plan_id: "p1", kind: "manual" as const, amount: 60000, date: "2026-11-02", bonus_entry_id: null, entry_kind: null, entry_id: null, memo: "" },
      { id: "sp", plan_id: "p1", kind: "spend" as const, amount: 60000, date: "2026-11-20", bonus_entry_id: null, entry_kind: "card" as const, entry_id: "hand", memo: "" },
    ];
    const base = { balances: [bal("2026-11-01", 500000)], budgets: budget, accounts: [salary("2026-11-16")], v5: { plans: [plan({})], moves } };
    const linked = D({ ...base, cards: [card({ id: "hand", date: "2026-11-20", amount: 60000 })] });
    const merged = D({ ...base, cards: [card({ id: "hand", date: "2026-11-20", amount: 60000, merged_into: "mail" }), card({ id: "mail", date: "2026-11-20", amount: 60000, source: "card_flash" })] });
    expect(slackValue(merged, "2026-11-21", "2026-11-21")).toBe(slackValue(linked, "2026-11-21", "2026-11-21"));
  });
  it("ひも付けた明細を消したら、ひも付けもなかったことになる", () => {
    const moves = [
      { id: "in", plan_id: "p1", kind: "manual" as const, amount: 60000, date: "2026-11-02", bonus_entry_id: null, entry_kind: null, entry_id: null, memo: "" },
      { id: "sp", plan_id: "p1", kind: "spend" as const, amount: 60000, date: "2026-11-20", bonus_entry_id: null, entry_kind: "card" as const, entry_id: "gone", memo: "" },
    ];
    const d = D({ balances: [bal("2026-11-01", 500000)], budgets: budget, v5: { plans: [plan({})], moves } });
    expect(part(slackAt(d, "2026-11-21", "2026-11-21"), "reserve").amount).toBe(60000);
  });
});

describe("I-3：借入残高を直したあとに、それより前の明細をリボに回しても消えない", () => {
  it("11/10 に残高を直してから 11/1 の家賃を 11/20 にリボに回すと、請求 −8万・借入残高 +8万", () => {
    const rent = card({ id: "rent", card: "saison", date: "2026-11-01", amount: 80000, group: "fixed", category: "家賃" });
    const base = { balances: [bal("2026-11-01", 400000)], budgets: [{ month: "2026-11", category: "家賃", amount: 80000 }], v5: { loans: [loan({ card: "saison", pay_day: null, monthly: 0 })], balances: [lb("2026-10-01", 200000), lb("2026-11-10", 200000)] } };
    const before = D({ ...base, cards: [rent] });
    const after = D({ ...base, cards: [{ ...rent, group: "purchase", revolved_at: "2026-11-20" }] });
    expect(slackValue(after, "2026-11-20", "2026-11-20")).toBe(slackValue(before, "2026-11-20", "2026-11-20"));
    expect(part(slackAt(after, "2026-11-20", "2026-11-20"), "due", "loans").amount).toBe(280000);
  });
  it("同じカードの借入が2つあっても、リボに回した分は1つにだけ足す", () => {
    const d = D({ cards: [card({ card: "saison", date: "2026-11-05", amount: 10000, group: "purchase", category: "外食", revolved_at: "2026-11-05" })], v5: { loans: [loan({ card: "saison", pay_day: null, monthly: 0 }), loan({ id: "l2", card: "saison", pay_day: null, monthly: 0, sort: 1 })], balances: [lb("2026-11-01", 0), lb("2026-11-01", 0, "l2")] } });
    expect(part(slackAt(d, "2026-11-06", "2026-11-06"), "due", "loans").amount).toBe(10000);
  });
});

describe("I-4：給与の入金がない月の見込みは、給料日のあとの残高が入るまで未入金のまま", () => {
  it("給料日（11/16）を過ぎても、残高を入れるまでは余裕額が変わらない", () => {
    const d = D({ balances: [bal("2026-11-01", 300000)], settings: { ...S, salaryEstimate: 200000 } });
    const before = slackValue(d, "2026-11-13", "2026-11-13");
    expect(slackValue(d, "2026-11-17", "2026-11-17")).toBe(before);
    const recorded = { ...d, balances: [...d.balances, bal("2026-11-17", 500000)] };
    expect(slackValue(recorded, "2026-11-17", "2026-11-17")).toBe(before);
  });
});

describe("I-5：前の版の分割（返済）の明細は請求に数えない（借入の返済は借入から出す）", () => {
  it("分割（返済）だけの請求は、未払いのクレカ請求に入らない", () => {
    const d = D({ balances: [bal("2026-11-01", 300000)], cards: [card({ card: "saison", date: "2026-11-04", amount: 20000, group: "installment", category: null })] });
    expect(part(slackAt(d, "2026-11-10", "2026-11-10"), "due", "card").amount).toBe(0);
  });
});

describe("I-6：締め日が月末でないカード。今月使った分は今月の未払いに入る", () => {
  it("15日締めのカードで 11/20 に使っても（予算の中なら）余裕額は変わらない", () => {
    const s15 = { ...S, cards: S.cards.map((c) => (c.id === "smbc" ? { ...c, closingDay: 15 } : c)) };
    const base: Partial<Data> = { balances: [bal("2026-11-01", 300000)], budgets: budget, settings: s15, accounts: [salary("2026-11-16")] };
    const none = D(base);
    const spent = D({ ...base, cards: [card({ date: "2026-11-20", amount: 10000 })] });
    expect(slackValue(spent, "2026-11-21", "2026-11-21")).toBe(slackValue(none, "2026-11-21", "2026-11-21"));
  });
});
