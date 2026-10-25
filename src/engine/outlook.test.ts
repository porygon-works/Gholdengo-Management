import { describe, expect, it } from "vitest";
import { bal, D, example, S } from "./fixture";
import { lowest, outlook, repayView, type Data } from "./index";

// 見通し（設計書 §2.4・§4.2）。値はすべて作り物

/** §2.4 の例で、11月の家賃をリボに回し、12/27 にまとめて返す */
const revolving = (): Data => {
  const d = example();
  return {
    ...d,
    cards: d.cards.map((e) => (e.id === "nov-rent" ? { ...e, group: "purchase", revolved_at: "2026-11-01" } : e)),
    v5: {
      ...d.v5,
      plans: [{ id: "rp", kind: "repay", name: "リボを12月に返す", target: 0, due_date: "2026-12-27", monthly: 0, start_month: null, draw_order: 0, no_draw: true, done: false, sort: 0 }],
      loans: [{ id: "l1", plan_id: "rp", name: "セゾンのリボ", card: "saison", monthly: 0, pay_day: null, sort: 0 }],
      balances: [{ id: "lb", loan_id: "l1", date: "2026-10-31", balance: 0 }],
    },
  };
};

describe("見通し", () => {
  it("設計書 §2.4 を 11/1 から見通すと、表のとおりに動く", () => {
    const days = outlook(revolving(), "2026-11-01", "2026-11-01", "2026-12-31");
    const at = (date: string) => days.find((x) => x.date === date)!;
    expect(at("2026-11-01")).toEqual({ date: "2026-11-01", bank: 300000, slack: 50000 });
    expect(at("2026-11-04")).toMatchObject({ bank: 220000, slack: 50000 });
    expect(at("2026-11-16")).toMatchObject({ bank: 470000, slack: 50000 });
    expect(at("2026-11-26")).toMatchObject({ bank: 300000, slack: 50000 });
    expect(at("2026-12-04")).toMatchObject({ bank: 300000, slack: 50000 });
    expect(at("2026-12-10")).toMatchObject({ bank: 600000, slack: 350000 });
    expect(at("2026-12-15")).toMatchObject({ bank: 850000, slack: 350000 });
    expect(at("2026-12-27")).toMatchObject({ bank: 770000, slack: 350000 });
    expect(at("2026-12-28")).toMatchObject({ bank: 600000, slack: 350000 });
  });

  it("月末から1日に変わっても余裕額は跳ねない", () => {
    const days = outlook(example(), "2026-11-01", "2026-11-01", "2026-12-31");
    const slack = (date: string) => days.find((x) => x.date === date)!.slack;
    expect(slack("2026-12-01")).toBe(slack("2026-11-30"));
  });

  it("給与の予定がない先の月は、設定の給与の見込みで数える", () => {
    const d = D({ balances: [bal("2026-10-31", 100000)], settings: { ...S, salaryEstimate: 200000 } });
    const days = outlook(d, "2026-11-01", "2026-11-01", "2027-01-31");
    const at = (date: string) => days.find((x) => x.date === date)!;
    // 2026-12-15 は火曜
    expect(at("2026-12-15").bank - at("2026-12-14").bank).toBe(200000);
    expect(at("2026-12-01").slack).toBe(at("2026-11-30").slack);
    expect(at("2026-12-16").slack).toBe(at("2026-12-14").slack);
  });

  it("返済の計画：返す額の見込み・その日の口座残高・返した後の最低残高（期日から60日）", () => {
    const d = revolving();
    const r = repayView(d, d.v5.plans[0], "2026-11-01")!;
    expect(r.due.amount).toBe(80000);
    expect(r.bankThen.amount).toBe(850000);
    expect(r.ok).toBe(true);
    // 期日〜60日後の毎日の口座残高の見込みのうち、一番少ない日と額
    const after = outlook(d, "2026-11-01", "2026-12-27", "2027-02-25");
    const min = after.reduce((a, x) => (x.bank < a.bank ? x : a));
    expect(r.lowAfter.amount).toBe(min.bank);
    expect(r.lowAfter.label).toContain(`${+min.date.slice(5, 7)}/${+min.date.slice(8)}`);
    expect(r.lowAfter.rows!.at(-1)!.date <= min.date).toBe(true);
  });

  it("口座残高が一番少なくなる日", () => {
    expect(lowest(revolving(), "2026-11-01", "2026-12-31")).toEqual({ date: "2026-11-04", bank: 220000 });
  });
});
