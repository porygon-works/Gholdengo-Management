import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, debtLeft, forecast, normalizeBills, planBucket, planMinusItems, planNeed, planStatus, reserveAt, syncLumps,
  type AccountEntry, type Data, type Plan, type PlanDebt, type PlanFund,
} from "./index";

// 値はすべて作り物（このリポジトリは公開されている）

const S = DEFAULT_SETTINGS;
let n = 0;
const A = (p: Partial<AccountEntry>): AccountEntry => ({
  id: p.id ?? `a${++n}`, account: "bank", direction: "out", status: "plan", group: "other", category: null, name: "", memo: "", date: "2026-11-10",
  amount: 1000, source: "plan", source_ref: null, recurring_id: null, goal_id: null, card: null, pair_id: null, locked: false, ...p,
});
const P = (p: Partial<Plan>): Plan => ({ id: p.id ?? `p${++n}`, kind: "repay", name: "リボ", use_date: "2026-12-16", target: 0, done: false, sort: 0, ...p });
const DB = (p: Partial<PlanDebt>): PlanDebt => ({ id: p.id ?? `d${++n}`, plan_id: "p1", name: "カードA", balance: 50000, as_of: "2026-11-01", sort: 0, ...p });
const F = (p: Partial<PlanFund>): PlanFund => ({ id: p.id ?? `f${++n}`, plan_id: "p1", source: "bonus", name: "", date: "2026-12-15", budget_month: null, amount: 0, status: "plan", ...p });
const D = (p: Partial<Data>): Data => ({ accounts: [], cards: [], balances: [], recurring: [], goals: [], plans: [], debts: [], funds: [], months: [], budgets: [], rules: [], settings: S, ...p });

describe("返済の計画", () => {
  const plan = P({ id: "p1" });
  const debts = [DB({ id: "d1", balance: 50000 }), DB({ id: "d2", name: "カードB", balance: 30000, as_of: "2026-11-20" })];
  const pays = [
    A({ plan_id: "p1", plan_role: "pay", debt_id: "d1", date: "2026-11-26", amount: 10000 }),
    A({ plan_id: "p1", plan_role: "pay", debt_id: "d2", date: "2026-11-15", amount: 5000 }), // 残高を見た日より前なので引かない
    A({ plan_id: "p1", plan_role: "pay", debt_id: "d2", date: "2026-12-04", amount: 5000 }),
    A({ plan_id: "p1", plan_role: "pay", debt_id: "d1", date: "2026-12-26", amount: 10000 }), // まとめて返す日より後
  ];
  it("まとめて返す額 ＝ 残高 − 見た日のあと、まとめて返す日より前の支払い", () => {
    const d = D({ plans: [plan], debts, accounts: pays });
    expect([debtLeft(d, plan, debts[0]), debtLeft(d, plan, debts[1])]).toEqual([40000, 25000]);
    expect(planNeed(d, plan)).toBe(65000);
  });
  it("まとめて返す行を作り、額と日を計画に合わせる。確定した行はそのまま", () => {
    const d = D({ plans: [plan], debts, accounts: pays });
    const s1 = syncLumps(d);
    expect(s1.inserts.map((e) => [e.date, e.amount, e.plan_role, e.source_ref])).toEqual([["2026-12-16", 65000, "lump", "plan:p1:lump"]]);
    const lump = A({ id: "L", plan_id: "p1", plan_role: "lump", date: "2026-12-15", amount: 1 });
    expect(syncLumps(D({ plans: [plan], debts, accounts: [...pays, lump] })).updates).toEqual([{ id: "L", patch: { amount: 65000, date: "2026-12-16" } }]);
    expect(syncLumps(D({ plans: [plan], debts, accounts: [...pays, { ...lump, status: "confirmed" }] })).updates).toEqual([]);
    // 使う日をなくした（貯蓄にした）ら、予定の行は消す
    expect(syncLumps(D({ plans: [{ ...plan, kind: "save" }], debts, accounts: [lump] })).removes).toEqual(["L"]);
  });
  it("予算の出し方の内訳：その月の予算を減らす支払いと、予算から入れる分", () => {
    const d = D({ plans: [plan], debts, accounts: pays.map((e) => ({ ...e, name: "支払い", budget_month: "2026-11" })), funds: [F({ source: "budget", budget_month: "2026-11", amount: 3000, name: "11月の予算から" })] });
    expect(planMinusItems(d, "2026-11").map((x) => x.amount)).toEqual([5000, 10000, 5000, 10000, 3000]); // 日付の順
  });
});

describe("確保額", () => {
  it("計画の確保額：入る日から使う日の前の日まで。貯蓄は目標額まで", () => {
    const buy = P({ id: "b", kind: "buy", target: 60000, use_date: "2027-03-30" });
    const save = P({ id: "s", kind: "save", target: 25000, use_date: null });
    const funds = [F({ plan_id: "b", source: "budget", date: "2027-01-26", amount: 20000 }), F({ plan_id: "b", source: "budget", date: "2027-02-26", amount: 20000 }),
      F({ plan_id: "s", source: "budget", date: "2027-01-26", amount: 20000 }), F({ plan_id: "s", source: "budget", date: "2027-02-26", amount: 20000 })];
    const d = D({ plans: [buy, save], funds });
    expect([planBucket(d, buy, "2027-01-25"), planBucket(d, buy, "2027-02-26"), planBucket(d, buy, "2027-03-30")]).toEqual([0, 40000, 0]);
    expect(planBucket(d, save, "2027-03-01")).toBe(25000);
  });
});

describe("クレカの請求と計画の支払い", () => {
  it("カード会社の請求額に入っている計画の支払いは、クレカ支払いの行から引く（二重に数えない）", () => {
    const bill = A({ id: "B", group: "card", source: "card_bill", card: "smbc", date: "2026-11-26", amount: 120000, locked: true, status: "confirmed" });
    const pay = A({ plan_id: "p1", plan_role: "pay", card: "smbc", date: "2026-11-26", amount: 20000 });
    const out = normalizeBills([bill, pay]);
    expect([out[0].amount, out[0].billTotal]).toEqual([100000, 120000]);
    // 確定の額でない（見込みの）行は、もともと計画の支払いを含まない
    expect(normalizeBills([{ ...bill, locked: false }, pay])[0].amount).toBe(120000);
  });
});

describe("口座の見通し", () => {
  it("毎日の口座残高と実質残高。これからカードで使う見込み（残り予算）を引落日に入れ、実質残高は使った日に減る", () => {
    const d = D({
      balances: [{ id: "b", date: "2026-11-01", bank: 100000, cash: 0, paypay: 0, memo: "" }],
      months: [{ month: "2026-11", budget: 30000, memo: "" }],
      accounts: [
        A({ status: "confirmed", source: "manual", group: "fixed", category: "家賃", date: "2026-11-04", amount: 50000 }),
        A({ status: "plan", source: "recurring", direction: "in", group: "salary", date: "2026-11-16", amount: 200000 }),
      ],
      cards: [{ id: "c1", card: "smbc", status: "confirmed", date: "2026-11-05", amount: 10000, group: "variable", category: "食料品", name: "", shop: "", memo: "", tatekae: 0, source: "manual", source_ref: null, merged_into: null, not_dup: [], locked: false, recurring_id: null, goal_id: null }],
    });
    const f = forecast(d, "2026-11-10", 2)!;
    const at = (t: string) => f.days.find((x) => x.date === t)!;
    expect([at("2026-11-03").bank, at("2026-11-04").bank, at("2026-11-10").bank, at("2026-11-16").bank]).toEqual([100000, 50000, 50000, 250000]);
    // 11月の請求（12/28）：使った 10,000 ＋ 残り予算 20,000
    expect(at("2026-12-28").bank).toBe(250000 - 30000);
    // 実質残高：使った 10,000 はその日から引く
    expect(at("2026-11-05").real).toBe(40000);
    expect(f.eves).toContain("2026-11-15");
    expect(reserveAt(d, f, "2026-11-15")!.spare).toBe(50000);
    const plan = P({ id: "p1", kind: "buy", target: 60000, use_date: "2026-12-20" });
    const st = planStatus({ ...d, plans: [plan] }, plan, f);
    expect([st.need, st.got, st.short, st.ok]).toEqual([60000, 0, 60000, true]);
  });
});

describe("計画の計算（見直し）", () => {
  const base = { balances: [{ id: "b", date: "2026-11-01", bank: 100000, cash: 0, paypay: 0, memo: "" }], months: [{ month: "2026-11", budget: 0, memo: "" }, { month: "2026-12", budget: 0, memo: "" }] };
  it("買い物：使う日の前までに入れた分がそろえば、足りない額は0。まとめて払う行の額は金額", () => {
    const buy = P({ id: "b1", kind: "buy", target: 60000, use_date: "2026-12-20" });
    const d = D({ ...base, plans: [buy], funds: [F({ plan_id: "b1", source: "spare", date: "2026-11-10", amount: 60000 })] });
    const f = forecast(d, "2026-11-10", 2)!;
    const st = planStatus(d, buy, f);
    expect([st.need, st.got, st.short, st.ok]).toEqual([60000, 60000, 0, true]);
    expect(syncLumps(d).inserts.map((e) => [e.date, e.amount])).toEqual([["2026-12-20", 60000]]);
  });
  it("確保額の内訳：計画ごとの分と、予備 ＝ 口座残高 − 計画の分", () => {
    const buy = P({ id: "b1", kind: "buy", target: 60000, use_date: "2026-12-20" });
    const save = P({ id: "s1", kind: "save", target: 30000, use_date: null });
    const d = D({ ...base, plans: [buy, save], funds: [F({ plan_id: "b1", source: "spare", date: "2026-11-10", amount: 40000 }), F({ plan_id: "s1", source: "spare", date: "2026-11-10", amount: 50000 })] });
    const f = forecast(d, "2026-11-10", 2)!;
    const r = reserveAt(d, f, "2026-11-15")!;
    expect([r.total, r.byKind.buy, r.byKind.save, r.spare]).toEqual([100000, 40000, 30000, 30000]);
    // 使う日のあとは計画の分が0になる
    expect(reserveAt(d, f, "2026-12-20")!.byKind.buy).toBe(0);
  });
  it("終わった計画の「予算から」は、予算から引かない（支払いは引く）", () => {
    const p = P({ id: "p1", done: true });
    const d = D({ plans: [p], funds: [F({ source: "budget", budget_month: "2026-11", amount: 5000 })], accounts: [A({ plan_id: "p1", plan_role: "pay", budget_month: "2026-11", amount: 7000 })] });
    expect(planMinusItems(d, "2026-11").map((x) => x.amount)).toEqual([7000]);
  });
  it("実質残高：先の月にカードで使う見込みは、月の中で日割りで増える", () => {
    const d = D({ ...base, months: [{ month: "2026-11", budget: 0, memo: "" }, { month: "2026-12", budget: 31000, memo: "" }] });
    const f = forecast(d, "2026-11-10", 2)!;
    const at = (t: string) => f.days.find((x) => x.date === t)!;
    expect([at("2026-11-30").real, at("2026-12-10").real, at("2026-12-31").real]).toEqual([100000, 90000, 69000]);
    expect(at("2026-12-31").bank).toBe(100000);
  });
});

describe("使う日に入る分", () => {
  it("賞与の日にまとめて返すとき、その日の賞与から入れる分も数える", () => {
    const plan = P({ id: "p1", use_date: "2026-12-15" });
    const d = D({
      balances: [{ id: "b", date: "2026-11-01", bank: 10000, cash: 0, paypay: 0, memo: "" }], months: [{ month: "2026-11", budget: 0, memo: "" }, { month: "2026-12", budget: 0, memo: "" }],
      plans: [plan], debts: [DB({ id: "d1", balance: 50000 })], funds: [F({ source: "bonus", date: "2026-12-15", amount: 50000 })],
      accounts: [A({ status: "plan", source: "manual", direction: "in", group: "other", name: "賞与", date: "2026-12-15", amount: 60000 }), A({ id: "L", plan_id: "p1", plan_role: "lump", date: "2026-12-15", amount: 50000 })],
    });
    const st = planStatus(d, plan, forecast(d, "2026-11-10", 2));
    expect([st.need, st.got, st.short, st.ok]).toEqual([50000, 50000, 0, true]);
    // 賞与から入れていなければ足りない。予備（賞与の残り 60,000 ＋ 10,000 − 0）でまかなえる
    const st2 = planStatus({ ...d, funds: [] }, plan, forecast({ ...d, funds: [] }, "2026-11-10", 2));
    expect([st2.short, st2.spare, st2.ok]).toEqual([50000, 70000, true]);
  });
});

describe("カードの請求の見込み", () => {
  it("予算を使い切るまでは予算の額で1行、こえたら使った分。確定の額が入ればその額", () => {
    const card = (amount: number, date = "2026-11-05") => ({ id: `c${amount}${date}`, card: "smbc", status: "confirmed" as const, date, amount, group: "variable" as const, category: "食料品", name: "", shop: "", memo: "", tatekae: 0, source: "manual" as const, source_ref: null, merged_into: null, not_dup: [], locked: false, recurring_id: null, goal_id: null });
    const base = { balances: [{ id: "b", date: "2026-11-01", bank: 100000, cash: 0, paypay: 0, memo: "" }], months: [{ month: "2026-11", budget: 10000, memo: "" }, { month: "2026-12", budget: 0, memo: "" }] };
    const bills = (d: Data) => forecast(d, "2026-11-10", 2)!.rows.filter((r) => r.entry.group === "card" && r.date === "2026-12-28").map((r) => r.delta);
    expect(bills(D({ ...base, cards: [card(8000)] }))).toEqual([-10000]);
    expect(bills(D({ ...base, cards: [card(12000)] }))).toEqual([-12000]);
    const locked = A({ id: "B", group: "card", source: "card_bill", source_ref: "bill:smbc:2026-12-28", card: "smbc", date: "2026-12-28", amount: 9000, locked: true, status: "confirmed" });
    expect(bills(D({ ...base, cards: [card(8000)], accounts: [locked] }))).toEqual([-9000]);
  });
});
