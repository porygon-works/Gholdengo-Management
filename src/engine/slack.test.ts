import { describe, expect, it } from "vitest";
import { acc, bal, card, D, example } from "./fixture";
import { slackAt, slackValue, type Data, type Part } from "./index";

// 余裕額（設計書 §2.2）。値はすべて作り物
const part = (p: Part, ...keys: string[]): Part => keys.reduce((x, k) => x.parts!.find((y) => y.key === k)!, p);
const billRow = (c: string, date: string, amount: number) => acc({ group: "card", card: c, date, amount, source: "card_bill", source_ref: `bill:${c}:${date}`, name: "請求" });

describe("余裕額（今日）", () => {
  it("設計書 §2.4：11/1 の余裕額は 5万", () => {
    const d = example();
    const p = slackAt(d, "2026-11-01", "2026-11-01");
    expect(p.parts!.map((x) => x.key)).toEqual(["bank", "salary", "refund", "due", "reserve"]);
    expect(part(p, "bank").amount).toBe(300000);
    expect(part(p, "salary").amount).toBe(250000);
    expect(part(p, "due", "card").amount).toBe(330000); // 10月の三井 17万・10月の家賃 8万・11月の家賃 8万
    expect(part(p, "due", "budget").amount).toBe(170000);
    expect(p.amount).toBe(50000);
  });

  it("11/20 に家賃をリボに回しても 5万のまま（請求が −8万、借入残高が +8万）", () => {
    const base = example();
    const d: Data = {
      ...base,
      cards: base.cards.map((e) => (e.id === "nov-rent" ? { ...e, group: "purchase" } : e)),
      accounts: [...base.accounts.map((e) => (e.id === "nov-pay" ? { ...e, status: "confirmed" as const } : e)), billRow("saison", "2026-11-04", 80000)],
      v5: { ...base.v5, loans: [{ id: "l1", plan_id: null, name: "セゾンのリボ", card: "saison", monthly: 0, pay_day: null, sort: 0 }], balances: [{ id: "lb", loan_id: "l1", date: "2026-10-31", balance: 0 }] },
    };
    const p = slackAt(d, "2026-11-20", "2026-11-20");
    expect(part(p, "bank").amount).toBe(470000);
    expect(part(p, "due", "card").amount).toBe(170000);
    expect(part(p, "due", "loans").amount).toBe(80000);
    expect(p.amount).toBe(50000);
  });

  it("引落日が土日祝でずれたら、ずれた日までは未払いの請求に残る", () => {
    // 2027-09-04 は土曜なので、セゾンの8月分は 9/6 に引き落とされる
    const d = D({ balances: [bal("2027-08-31", 100000)], cards: [card({ card: "saison", date: "2027-08-10", amount: 10000 })] });
    expect(part(slackAt(d, "2027-09-05", "2027-09-05"), "due", "card").amount).toBe(10000);
    const paid = { ...d, accounts: [billRow("saison", "2027-09-06", 10000)] };
    expect(part(slackAt(paid, "2027-09-06", "2027-09-06"), "due", "card").amount).toBe(0);
  });

  it("まとめられたクレカ明細は未払いの請求に入れない", () => {
    const d = D({ balances: [bal("2026-11-01", 100000)], cards: [card({ id: "k", date: "2026-11-03", amount: 2000 }), card({ date: "2026-11-03", amount: 2000, merged_into: "k" })] });
    expect(part(slackAt(d, "2026-11-05", "2026-11-05"), "due", "card").amount).toBe(2000);
  });

  it("立替の返金の予定は未回収立替として足す", () => {
    const d = D({ balances: [bal("2026-11-01", 100000)], accounts: [acc({ direction: "in", group: "refund", status: "plan", date: "2026-11-30", amount: 3000 })] });
    expect(part(slackAt(d, "2026-11-05", "2026-11-05"), "refund").amount).toBe(3000);
  });

  it("固定費の予算のうち、まだ明細のない分は予算残額に入れる（明細が入っても余裕額は跳ねない）", () => {
    const base = { balances: [bal("2026-11-01", 100000)], budgets: [{ month: "2026-11", category: "水道ガス光熱費", amount: 10000 }] };
    const before = slackValue(D(base), "2026-11-05", "2026-11-05");
    const after = slackValue(D({ ...base, cards: [card({ date: "2026-11-04", amount: 10000, group: "fixed", category: "水道ガス光熱費" })] }), "2026-11-05", "2026-11-05");
    expect(after).toBe(before);
  });

  it("先の月の予算を目安額より多く決めたら、その分を今日の余裕額から引く", () => {
    const d = example();
    const more = { ...d, v5: { ...d.v5, months: [{ month: "2026-12", budget: 200000, source: "decided" as const }] } };
    expect(part(slackAt(more, "2026-11-01", "2026-11-01"), "due", "ahead").amount).toBe(30000);
    expect(slackValue(more, "2026-11-01", "2026-11-01")).toBe(20000);
  });
});
