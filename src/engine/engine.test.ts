import { describe, expect, it } from "vitest";
import {
  ACCOUNT_GROUP_LABEL, accountFlow, accountNow, applyLabels, CARD_GROUP_LABEL, goalBalanceAt, PAY_GROUP_LABEL, accountsWithBills, billsFor, budgetsFor, cardPayDate, categorize, computeMonth, DEFAULT_SETTINGS, findMerges, goalMinusAuto,
  goalOutlook, goalSchedule, holidays, isBusinessDay, missingGoalPlans, missingRecurring, monthBase, monthlyFor, nextPayday, nextPayments, normalizeShop,
  planGoals, recurringDate, balanceAt, BUDGET_KEY, carryFor, recurringDue, syncGoalPlans, ruleFor, shiftBusiness, syncBills,
  type AccountEntry, type CardEntry, type Data, type Goal, type Recurring,
} from "./index";

// 値はすべて作り物（このリポジトリは公開されている）

const S = DEFAULT_SETTINGS;
let n = 0;
const C = (p: Partial<CardEntry>): CardEntry => ({
  id: p.id ?? `c${++n}`, card: "smbc", status: "confirmed", date: "2026-10-10", amount: 1000, group: "variable", category: "食料品", name: "", shop: "", memo: "",
  tatekae: 0, source: "manual", source_ref: null, merged_into: null, not_dup: [], locked: false, recurring_id: null, goal_id: null, ...p,
});
const A = (p: Partial<AccountEntry>): AccountEntry => ({
  id: p.id ?? `a${++n}`, account: "bank", direction: "out", status: "confirmed", group: "variable", category: "食料品", name: "", memo: "", date: "2026-10-10",
  amount: 1000, source: "manual", source_ref: null, recurring_id: null, goal_id: null, card: null, pair_id: null, locked: false, ...p,
});
const G = (p: Partial<Goal>): Goal => ({
  id: p.id ?? `g${++n}`, kind: "repay", name: "リボ", card: "saison", balance: 30000, as_of: "2026-10-19", target: 0, monthly: 10000, day: 27,
  start_month: null, end_month: null, lumps: [], active: true, sort: 0, ...p,
});
const D = (p: Partial<Data>): Data => ({ accounts: [], cards: [], balances: [], recurring: [], goals: [], budgets: [], rules: [], settings: S, ...p });
const bal = (p: Partial<Data["balances"][number]> = {}) => ({ id: "b", date: "2026-10-19", bank: 300000, cash: 10000, paypay: 0, memo: "", ...p });

describe("日付と祝日", () => {
  it("2026年の祝日と振替休日", () => {
    const h = holidays(2026);
    for (const d of ["2026-01-01", "2026-01-12", "2026-03-20", "2026-05-06", "2026-07-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-23"]) {
      expect(h.has(d), d).toBe(true);
    }
    expect(h.has("2026-05-07")).toBe(false);
  });
  it("営業日にずらす", () => {
    expect(shiftBusiness("2026-09-26", "next")).toBe("2026-09-28");
    expect(shiftBusiness("2026-11-15", "next")).toBe("2026-11-16");
    expect(shiftBusiness("2026-11-15", "prev")).toBe("2026-11-13");
    expect(isBusinessDay("2027-01-02")).toBe(false);
  });
  it("カードごとの引落日", () => {
    expect(cardPayDate("2026-10", S)).toBe("2026-11-26");
    expect(cardPayDate("2026-08", S)).toBe("2026-09-28");
    expect(cardPayDate("2026-10", S, "saison")).toBe("2026-11-04");
    expect(cardPayDate("2026-12", S, "saison")).toBe("2027-01-04");
    expect(nextPayday(S, "2026-10-21")).toBe("2026-11-16");
    expect(nextPayday(S, "2026-10-14")).toBe("2026-10-15");
  });
});

describe("定期マスタ", () => {
  const rec = (p: Partial<Recurring>): Recurring => ({ id: "r1", name: "給与", kind: "income", group: "salary", category: null, amount: 250000, day: 15, shift: "next", pay: "bank", card: null, shop: "", every: 1, start_month: null, end_month: null, active: true, ...p });
  it("口座の予定とクレカの予定に分けて作る。土日祝はずらす", () => {
    const salary = rec({});
    const rent = rec({ id: "r2", name: "家賃", kind: "expense", group: "fixed", category: "家賃", amount: 70000, day: 27, pay: "card", card: "saison" });
    expect(recurringDate(salary, "2026-11")).toBe("2026-11-16");
    const out = missingRecurring({ recurring: [salary, rent], accounts: [], cards: [], settings: S }, ["2026-11"]);
    expect(out.accounts.map((e) => [e.direction, e.group, e.date, e.amount])).toEqual([["in", "salary", "2026-11-16", 250000]]);
    expect(out.cards.map((e) => [e.card, e.group, e.category, e.date])).toEqual([["saison", "fixed", "家賃", "2026-11-27"]]);
    const again = missingRecurring({ recurring: [salary], accounts: [A({ source_ref: "rec:r1:2026-11" })], cards: [], settings: S }, ["2026-11"]);
    expect(again.accounts).toHaveLength(0);
  });
});

describe("定期マスタ：何か月ごと・消した予定", () => {
  const rec = (p: Partial<Recurring>): Recurring => ({ id: "r9", name: "年払い", kind: "expense", group: "fixed", category: "サブスク", amount: 2400, day: 10, shift: "none", pay: "card", card: null, shop: "", every: 1, start_month: null, end_month: null, active: true, ...p });
  it("2か月ごと・毎年は、始める月から数えた月だけ作る。固定費の見込みもその月だけ", () => {
    const months = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"];
    const two = missingRecurring({ recurring: [rec({ every: 2, start_month: "2026-11" })], accounts: [], cards: [], settings: S }, months);
    expect(two.cards.map((e) => e.date)).toEqual(["2026-11-10", "2027-01-10", "2027-03-10"]);
    const year = rec({ every: 12, start_month: "2026-12" });
    expect(missingRecurring({ recurring: [year], accounts: [], cards: [], settings: S }, months).cards.map((e) => e.date)).toEqual(["2026-12-10"]);
    expect([recurringDue(year, "2027-12"), recurringDue(year, "2027-11")]).toEqual([true, false]);
    const d = D({ recurring: [year] });
    expect([budgetsFor(d, "2026-12").get("サブスク"), budgetsFor(d, "2027-01").has("サブスク")]).toEqual([2400, false]);
  });
  it("消した予定（removedRefs）は、また作らない", () => {
    const r = rec({});
    expect(missingRecurring({ recurring: [r], accounts: [], cards: [], settings: S, removedRefs: ["rec:r9:2026-11"] }, ["2026-11", "2026-12"]).cards.map((e) => e.date)).toEqual(["2026-12-10"]);
    const g = G({ id: "g1", balance: 20000, monthly: 10000, card: "saison" });
    expect(missingGoalPlans(D({ goals: [g], removedRefs: ["goal:g1:2026-11"] }), ["2026-11", "2026-12"]).cards.map((e) => e.source_ref)).toEqual(["goal:g1:2026-12"]);
  });
});

describe("重複の処理（クレカ明細）", () => {
  it("速報と明細：同じカード・同じ金額・3日以内なら明細が速報を吸収する", () => {
    const flash = C({ id: "f", source: "card_flash", shop: "Mastercard加盟店", amount: 2990, date: "2026-10-15", category: null });
    const stmt = C({ id: "s", source: "card_statement", shop: "サンプル動画", amount: 2990, date: "2026-10-14", category: null });
    const { merges, review } = findMerges([flash, stmt]);
    expect(review).toHaveLength(0);
    expect(merges.map((m) => `${m.keep.id}<${m.absorb.id}`)).toEqual(["s<f"]);
  });
  it("手入力→速報→明細の順に吸収し、本人の費目と名称が残る", () => {
    const manual = C({ id: "m", amount: 5000, date: "2026-10-17", category: "外食", name: "飲み会" });
    const flash = C({ id: "f", source: "card_flash", amount: 5000, date: "2026-10-17", category: null });
    const stmt = C({ id: "s", source: "card_statement", amount: 5000, date: "2026-10-17", category: "食料品" });
    const { merges } = findMerges([manual, flash, stmt]);
    expect(merges.map((m) => `${m.keep.id}<${m.absorb.id}`)).toEqual(["f<m", "s<f"]);
    expect(merges[1].patch.category).toBe("外食");
    expect(merges[1].patch.name).toBe("飲み会");
  });
  it("定期の予定は ±20%・7日以内なら吸収。3,000円未満はぴったりのときだけ", () => {
    expect(findMerges([C({ id: "p", status: "plan", source: "recurring", amount: 5000, date: "2026-10-24", category: "通信" }), C({ source: "card_statement", amount: 5800, date: "2026-10-25", category: "通信" })]).merges[0]?.absorb.id).toBe("p");
    expect(findMerges([C({ status: "plan", source: "recurring", amount: 550, category: "サブスク" }), C({ source: "card_statement", amount: 600, category: "サブスク" })]).merges).toHaveLength(0);
  });
  it("一回きりの予定は要確認で聞く", () => {
    const plan = C({ id: "p", status: "plan", source: "manual", amount: 3000, date: "2026-10-17", category: "日用品・通販", name: "スマホケース" });
    const net = C({ id: "a", source: "card_statement", amount: 3200, date: "2026-10-21", category: "日用品・通販", shop: "SAMPLE.SHOP" });
    const { merges, review } = findMerges([plan, net]);
    expect(merges).toHaveLength(0);
    expect(review[0].reason).toContain("スマホケース");
  });
  it("お店の名前のヒントがあれば費目が違ってもまとめ、費目と大費目は予定に合わせる", () => {
    const plan = C({ id: "p", status: "plan", source: "recurring", amount: 6660, date: "2026-11-10", group: "fixed", category: "定期代", shop: "モバイルSuica" });
    const flash = C({ id: "f", source: "card_flash", amount: 6660, date: "2026-11-09", category: "交通", shop: "モバイルＳｕｉｃａ（Ａｐｐｌｅ）" });
    const { merges } = findMerges([plan, flash]);
    expect(merges[0].absorb.id).toBe("p");
    expect([merges[0].patch.category, merges[0].patch.group]).toEqual(["定期代", "fixed"]);
  });
  it("候補が2件なら要確認。カードが違えばまとめない。「別のもの」はまとめない", () => {
    const r = findMerges([C({ id: "a", amount: 500 }), C({ id: "b", amount: 500, date: "2026-10-11" }), C({ id: "f", source: "card_flash", amount: 500 })]);
    expect(r.review[0].candidates.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(findMerges([C({ amount: 500, card: "saison" }), C({ source: "card_flash", amount: 500 })]).merges).toHaveLength(0);
    expect(findMerges([C({ id: "x", amount: 500, not_dup: ["y"] }), C({ id: "y", source: "card_flash", amount: 500 })]).merges).toHaveLength(0);
  });
});

describe("クレカの請求（口座明細のクレカ支払い）", () => {
  const d = D({
    cards: [
      C({ amount: 5000, date: "2026-10-05" }),
      C({ amount: 3000, date: "2026-10-31", status: "plan" }),
      C({ amount: 9000, date: "2026-11-01" }), // 12月の請求
      C({ amount: 40000, date: "2026-10-12", group: "purchase", category: null }), // 分割（購入）は請求に入らない
      C({ amount: 8000, date: "2026-10-20", group: "tatekae", category: null }),
      C({ card: "saison", amount: 70000, date: "2026-10-27", group: "fixed", category: "家賃" }),
      C({ card: "saison", amount: 10000, date: "2026-10-31", group: "installment", category: null, status: "plan" }),
    ],
  });
  it("見込み＝締め期間のクレカ明細（予定・立替を含む。分割（購入）を除く）", () => {
    const [smbc, saison] = billsFor(d, "2026-11");
    expect([smbc.date, smbc.estimate, smbc.amount]).toEqual(["2026-11-26", 16000, 16000]);
    expect([saison.date, saison.estimate]).toEqual(["2026-11-04", 80000]);
  });
  it("行がなければ予定で作る。予定のあいだは見込みに合わせ、引落日が来たら確定する。確定した行は変えない", () => {
    const a = syncBills(d, "2026-10-21", ["2026-11"]);
    expect(a.inserts.map((e) => [e.name, e.date, e.amount, e.status, e.group])).toEqual([["三井 10月分", "2026-11-26", 16000, "plan", "card"], ["セゾン 10月分", "2026-11-04", 80000, "plan", "card"]]);
    const row = A({ id: "r", group: "card", card: "smbc", status: "plan", amount: 1, date: "2026-11-26", source: "card_bill", source_ref: "bill:smbc:2026-11-26" });
    expect(syncBills({ ...d, accounts: [row] }, "2026-10-21", ["2026-11"]).updates).toEqual([{ id: "r", patch: { amount: 16000 } }]);
    expect(syncBills({ ...d, accounts: [row] }, "2026-11-26", ["2026-11"]).updates).toEqual([{ id: "r", patch: { amount: 16000, status: "confirmed" } }]);
    const done = { ...row, status: "confirmed" as const, amount: 15800 };
    expect(syncBills({ ...d, accounts: [done] }, "2026-11-26", ["2026-11"]).updates).toEqual([]);
    expect(billsFor({ ...d, accounts: [done] }, "2026-11")[0].amount).toBe(15800);
  });
});

describe("今月の予算と残り予算", () => {
  const fixed = [{ month: "2026-10", category: "家賃", amount: 70000 }, { month: "2026-10", category: "通信", amount: 5000 }];
  it("予算の元：給与・追加予算は口座明細の入金、固定費は固定費の予算、目標用マイナスは目標マスタ", () => {
    const d = D({
      budgets: fixed,
      goals: [G({ monthly: 10000, card: null, day: 27, balance: 50000 }), G({ kind: "save", balance: 0, target: 255000, monthly: 20000, start_month: "2026-10" })],
      accounts: [
        A({ direction: "in", group: "salary", amount: 260000, date: "2026-10-15" }),
        A({ direction: "in", group: "extra", amount: 5000, date: "2026-10-20", status: "plan" }),
        A({ direction: "in", group: "refund", amount: 16000, date: "2026-10-25" }),
        A({ direction: "in", group: "other", name: "売却代金", amount: 40000, date: "2026-10-20" }),
      ],
    });
    const b = monthBase(d, "2026-10");
    expect([b.salary, b.extra, b.fixed, b.goal]).toEqual([260000, 5000, 75000, 30000]);
    expect(b.T).toBe(260000 + 5000 - 75000 - 30000);
    const m = monthBase({ ...d, budgets: [...fixed, { month: "2026-10", category: "#目標用マイナス", amount: 12000 }] }, "2026-10");
    expect([m.goal, m.goalAuto, m.goalManual]).toEqual([12000, 30000, true]);
  });
  it("残り予算 ＝ 予算 − クレカの変動費 − 口座の変動費の出金（自分の分・予定を含む）− 固定費の超過", () => {
    const d = D({
      budgets: [...fixed, { month: "2026-10", category: "食料品", amount: 30000 }],
      accounts: [
        A({ direction: "in", group: "salary", amount: 200000, date: "2026-10-15" }),
        A({ account: "wallet", amount: 800, category: "食料品", date: "2026-10-11" }),
        A({ amount: 3000, category: "交通", date: "2026-10-12", name: "PayPayチャージ" }),
        A({ amount: 5500, group: "fixed", category: "通信", date: "2026-10-25", status: "plan" }),
        A({ amount: 263000, group: "card", category: null, date: "2026-10-26" }), // クレカ支払いは数えない
      ],
      cards: [
        C({ amount: 10000, tatekae: 6000, category: "外食" }),
        C({ amount: 2000, category: null }),
        C({ amount: 700, status: "plan", category: "食料品", date: "2026-10-30" }),
        C({ amount: 70000, group: "fixed", category: "家賃", date: "2026-10-27", card: "saison" }),
        C({ amount: 9000, group: "tatekae", category: null }),
      ],
    });
    const v = computeMonth(d, "2026-10", "2026-10-21");
    expect([v.U, v.P, v.fixedOver]).toEqual([800 + 3000 + 4000 + 2000, 700, 500]);
    expect(v.R).toBe(v.T - v.U - v.P - 500);
    expect(v.unclassified).toHaveLength(1);
    expect(v.outsideCards.map((e) => e.group)).toEqual(["tatekae"]);
    expect(v.cats.find((c) => c.cat === "予備")!.unclassified).toBe(2000);
  });
  it("固定費の予算がなければ、定期マスタの額、それもなければその月の明細の合計", () => {
    const d = D({ cards: [C({ group: "fixed", category: "家賃", amount: 70000, date: "2026-11-27", status: "plan", card: "saison" })] });
    expect(budgetsFor(d, "2026-11").get("家賃")).toBe(70000);
    expect(budgetsFor(d, "2026-12").has("家賃")).toBe(false);
  });
});

describe("目標マスタ", () => {
  it("返済：残高の日より後の支払いから、残高が0になるまで。臨時の返済で早く終わる", () => {
    const g = G({ balance: 35000, monthly: 10000, as_of: "2026-10-19", card: "saison", lumps: [{ date: "2026-12-16", amount: 99999, memo: "賞与から" }] });
    const m = goalSchedule(g, S, "2026-10", 4);
    expect(m.map((x) => [x.ym, x.pay, x.lump, x.left])).toEqual([["2026-11", 10000, 0, 25000], ["2026-12", 10000, 15000, 0], ["2027-01", 0, 0, 0], ["2027-02", 0, 0, 0]]);
    expect(goalOutlook(D({ goals: [g] }), "2026-10")[0].doneYm).toBe("2026-12");
    // 残高は返済の日が来るたびに見込みで減る
    expect([goalBalanceAt(g, S, "2026-11-03"), goalBalanceAt(g, S, "2026-11-04"), goalBalanceAt(g, S, "2026-12-16")]).toEqual([35000, 25000, 0]);
    // 額を入れていない臨時の返済は、残り全部
    const all = G({ balance: 35000, monthly: 10000, card: "saison", lumps: [{ date: "2026-12-16", amount: 0, memo: "賞与から全額" }] });
    expect(goalSchedule(all, S, "2026-11", 2).map((x) => [x.pay, x.lump, x.left])).toEqual([[10000, 0, 25000], [10000, 15000, 0]]);
    expect(missingGoalPlans(D({ goals: [all] }), ["2026-12"]).accounts.map((e) => e.amount)).toEqual([15000]);
  });
  it("積立：始める月から目標額まで。目標用マイナスはその月に動いている目標の合計", () => {
    const save = G({ kind: "save", balance: 0, target: 50000, monthly: 20000, start_month: "2027-01" });
    expect(goalSchedule(save, S, "2026-12", 5).map((x) => x.pay)).toEqual([0, 20000, 20000, 10000, 0]);
    const d = D({ goals: [save, G({ balance: 30000, monthly: 10000, card: "saison" })] });
    expect([goalMinusAuto(d, "2026-11"), goalMinusAuto(d, "2027-01")]).toEqual([10000, 30000]);
    // 先の月も、残高の日から数えて0になったら返済は終わる（30,000円・毎月10,000円 → 11〜1月）
    expect([goalMinusAuto(d, "2027-01"), goalMinusAuto(d, "2027-02")]).toEqual([30000, 20000]);
  });
  it("返済の予定を作る：カードなら締め月の最後の日の分割（返済）、臨時は口座の出金。もう同じ締め月にあれば作らない", () => {
    const g = G({ id: "g1", balance: 25000, monthly: 10000, card: "saison", lumps: [{ date: "2026-12-16", amount: 15000, memo: "賞与から" }] });
    const out = missingGoalPlans(D({ goals: [g] }), ["2026-11", "2026-12"]);
    expect(out.cards.map((e) => [e.card, e.group, e.date, e.amount])).toEqual([["saison", "installment", "2026-10-31", 10000], ["saison", "installment", "2026-11-30", 10000]]);
    expect(out.accounts.map((e) => [e.date, e.amount, e.direction])).toEqual([["2026-12-16", 5000, "out"]]); // 残り 5,000円まで
    const had = missingGoalPlans(D({ goals: [g], cards: [C({ card: "saison", group: "installment", category: null, date: "2026-10-31", amount: 10000 })] }), ["2026-11"]);
    expect(had.cards).toHaveLength(0);
  });
});

describe("目標から作った予定を目標に合わせる", () => {
  it("残高や毎月の額が変わると、予定の額も変わる。残り全部の臨時の返済は、その月の返済を引いた額。いらなくなった予定は消す。本人が直した予定はそのまま", () => {
    const g = G({ id: "g1", balance: 30000, monthly: 10000, card: null, day: 4, as_of: "2026-10-19", lumps: [{ date: "2026-12-15", amount: 0, memo: "賞与から全額" }] });
    const made = missingGoalPlans(D({ goals: [g] }), ["2026-11", "2026-12", "2027-01"]).accounts.map((e, i) => ({ ...e, id: `p${i}` }));
    expect(made.map((e) => [e.source_ref, e.amount])).toEqual([["goal:g1:2026-11", 10000], ["goal:g1:2026-12", 10000], ["goal:g1:lump:2026-12-15", 10000]]);
    // 残高を 40,000 に直した → 臨時の返済は 20,000（11月・12月の返済を引いた残り）
    const s1 = syncGoalPlans(D({ goals: [{ ...g, balance: 40000 }], accounts: made }), ["2026-11", "2026-12", "2027-01"]);
    expect(s1.updates).toEqual([{ table: "account_entries", id: "p2", amount: 20000 }]);
    // 毎月 20,000 にした → 11月 20,000・12月 10,000（残り）・臨時は 0 → 消す
    const s2 = syncGoalPlans(D({ goals: [{ ...g, monthly: 20000 }], accounts: made }), ["2026-11", "2026-12", "2027-01"]);
    expect(s2.updates).toEqual([{ table: "account_entries", id: "p0", amount: 20000 }]);
    expect(s2.removes).toEqual([{ table: "account_entries", id: "p2" }]);
    // 本人が直した予定はそのまま
    const s3 = syncGoalPlans(D({ goals: [{ ...g, balance: 40000 }], accounts: made.map((e) => ({ ...e, locked: true })) }), ["2026-11", "2026-12", "2027-01"]);
    expect([s3.updates, s3.removes]).toEqual([[], []]);
  });
});

describe("口座", () => {
  it("いまの口座と財布：最後の残高 ＋ そのあと今日までの確定した口座明細。予定は数えない", () => {
    const d = D({
      balances: [bal()],
      accounts: [
        A({ direction: "in", group: "other", name: "売却代金", amount: 40000, date: "2026-10-20" }),
        A({ group: "other", name: "ATMで引き出し", amount: 20000, date: "2026-10-20", category: null }),
        A({ account: "wallet", direction: "in", group: "other", amount: 20000, date: "2026-10-20", category: null }),
        A({ account: "wallet", amount: 3000, date: "2026-10-21" }),
        A({ amount: 30000, group: "fixed", category: "奨学金", date: "2026-10-21", status: "plan" }),
        A({ amount: 999, date: "2026-10-18" }), // 残高の日より前
      ],
      cards: [C({ amount: 9000, date: "2026-10-21" })], // 口座はすぐには減らない
    });
    const x = accountNow(d, "2026-10-21")!;
    expect([x.bank, x.wallet]).toEqual([320000, 27000]);
    // 残高を直した日と同じ日の明細は、直したあとに入れたものだけ数える
    const fixed = D({ balances: [bal({ date: "2026-10-21", bank: 400000, at: "2026-10-21T03:00:00Z" })], accounts: [A({ amount: 1000, date: "2026-10-21", at: "2026-10-21T02:00:00Z" }), A({ amount: 2000, date: "2026-10-21", at: "2026-10-21T04:00:00Z" })] });
    expect(accountNow(fixed, "2026-10-21")!.bank).toBe(398000);
  });
  it("口座の今後の動き：いまの口座から、給料日の前日までの口座明細（まだ行のないクレカ支払いも）。過ぎた予定は今日に", () => {
    const d = D({
      balances: [bal()],
      accounts: [
        A({ direction: "in", group: "other", amount: 40000, date: "2026-10-20", name: "売却代金" }),
        A({ amount: 30000, group: "fixed", category: "奨学金", name: "奨学金", date: "2026-10-27", status: "plan" }),
        A({ amount: 500, name: "忘れていた予定", date: "2026-10-18", status: "plan" }),
        A({ direction: "in", group: "salary", amount: 250000, date: "2026-11-16", status: "plan" }),
      ],
      cards: [C({ amount: 50000, date: "2026-09-10" }), C({ card: "saison", group: "fixed", category: "家賃", amount: 70000, date: "2026-10-27", status: "plan" })],
    });
    const f = accountFlow(d, "2026-10-21")!;
    expect(f.now.bank).toBe(340000);
    expect(f.rows.map((r) => [r.date, r.entry.name, r.delta, r.balance])).toEqual([
      ["2026-10-21", "忘れていた予定", -500, 339500],
      ["2026-10-26", "三井 9月分", -50000, 289500],
      ["2026-10-27", "奨学金", -30000, 259500],
      ["2026-11-04", "セゾン 10月分", -70000, 189500],
    ]);
    expect(f.last).toBe(189500);
    expect(accountsWithBills(d, "2026-10-21", ["2026-10", "2026-11"]).filter((e) => e.group === "card").map((e) => e.name)).toEqual(["三井 9月分", "セゾン 10月分"]);
  });
  it("来月の支払い予定：大費目ごとに分ける。クレカは中身の明細で、一部の立替は立替へ。クレカ支払いの行は数えない", () => {
    const d = D({
      cards: [
        C({ card: "saison", group: "fixed", category: "家賃", name: "家賃", amount: 70000, date: "2026-10-27", status: "plan" }),
        C({ card: "saison", group: "installment", category: null, name: "リボの返済", amount: 10000, date: "2026-10-31", status: "plan" }),
        C({ amount: 4000, date: "2026-10-10" }),
        C({ amount: 3000, date: "2026-10-30", status: "plan", category: "外食", tatekae: 1000 }),
        C({ group: "tatekae", category: null, amount: 6000, date: "2026-10-15" }),
      ],
      accounts: [
        A({ amount: 30000, group: "fixed", category: "奨学金", name: "奨学金", date: "2026-11-27", status: "plan" }),
        A({ amount: 2000, group: "fixed", category: "保険・共済", name: "共済", date: "2026-11-09", status: "plan" }),
        A({ amount: 99999, group: "card", category: null, card: "smbc", date: "2026-11-26", status: "plan", source_ref: "bill:smbc:2026-11-26" }),
      ],
    });
    const n2 = nextPayments(d, "2026-11");
    expect(n2.groups.map((g) => [g.group, g.amount, g.items.length])).toEqual([["fixed", 102000, 3], ["variable", 6000, 2], ["installment", 10000, 1], ["tatekae", 7000, 2]]);
    expect(n2.groups[0].items.map((x) => [x.date, x.name, x.from])).toEqual([["2026-11-04", "家賃", "セゾン"], ["2026-11-09", "共済", "口座"], ["2026-11-27", "奨学金", "口座"]]);
    expect(n2.total).toBe(125000);
  });
});

describe("計画をつくる", () => {
  const base = (p: Partial<Data> = {}) => D({
    goals: [G({ balance: 60000, monthly: 10000, card: "saison" })],
    budgets: [{ month: "2026-10", category: "家賃", amount: 70000 }],
    settings: { ...S, salaryEstimate: 250000 },
    ...p,
  });
  it("毎月の額から：リボを返してから積み立て、届く月を出す。賞与も回せる", () => {
    const r = planGoals(base(), { from: "2026-11", monthly: 30000, useBonus: false, saved: 0, target: 60000 });
    expect([r.payoffYm, r.reachYm]).toEqual(["2026-12", "2027-02"]);
    expect(r.rows[0].free).toBe(250000 - 70000 - 30000);
    const withBonus = planGoals(base({ accounts: [A({ direction: "in", group: "other", name: "賞与", amount: 100000, date: "2026-12-10", status: "plan" })] }), { from: "2026-11", monthly: 30000, useBonus: true, saved: 0, target: 60000 });
    expect(withBonus.reachYm).toBe("2026-12");
  });
  it("達成したい月から：その月までに届く、いちばん少ない毎月の額（1,000円単位）", () => {
    const m = monthlyFor(base(), { from: "2026-11", useBonus: false, saved: 0, target: 60000 }, "2027-04")!;
    expect(m).toBe(20000);
    expect(monthlyFor(base(), { from: "2026-11", useBonus: false, saved: 0, target: 1e9 }, "2027-01")).toBeNull();
  });
});

describe("区分", () => {
  it("大費目の名前を変えると、画面で使う名前の表が変わる（計算は id のまま）", () => {
    applyLabels({ ...S, labels: { variable: "やりくり費", installment: "リボ" } });
    expect([ACCOUNT_GROUP_LABEL.variable, CARD_GROUP_LABEL.variable, CARD_GROUP_LABEL.installment, PAY_GROUP_LABEL.installment, PAY_GROUP_LABEL.fixed]).toEqual(["やりくり費", "やりくり費", "リボ", "リボ", "固定費"]);
    applyLabels(S);
    expect([ACCOUNT_GROUP_LABEL.variable, PAY_GROUP_LABEL.installment]).toEqual(["変動費", "分割の返済"]);
  });
});

describe("お店→費目のルール", () => {
  const rules = [
    { id: "1", pattern: "ファミリーマート", category: "食料品" },
    { id: "2", pattern: "モバイルSuica", category: "交通" },
    { id: "3", pattern: "amazon", category: "日用品・通販" },
  ];
  it("全角や決済手段の後ろ書きをそろえて、いちばん長く一致したルールを使う", () => {
    expect(normalizeShop("ローソン／ｉＤ")).toBe("ローソン");
    expect(categorize("ファミリーマート／ｉＤ", rules)).toBe("食料品");
    expect(categorize("モバイルＳｕｉｃａ（Ａｐｐｌｅ） ●", rules)).toBe("交通");
    expect(categorize("ＡＭＡＺＯＮ．ＣＯ．ＪＰ", rules)).toBe("日用品・通販");
    expect(categorize("Mastercard加盟店", rules)).toBeNull();
  });
  it("中身の分からないお店は覚えない", () => {
    expect(ruleFor("Mastercard加盟店")).toBeNull();
    expect(ruleFor("サンプルストア／ｉＤ")).toBe("サンプルストア");
  });
});

describe("前月からの繰越（§5.8）と、使えるお金から決める予算（§5.1）", () => {
  const s = { ...S, safety: 10000, carryFrom: "2026-11", budgetDefault: 90000 };
  const save = G({ id: "s1", kind: "save", name: "積立", card: null, balance: 50000, as_of: null, monthly: 20000, start_month: "2026-10" });
  const base = (p: Partial<Data> = {}) => D({
    settings: s, goals: [save],
    balances: [bal({ date: "2026-10-19", bank: 300000, cash: 10000 })],
    accounts: [A({ date: "2026-10-25", amount: 50000 }), A({ date: "2026-11-15", direction: "in", group: "salary", category: null, amount: 200000 })],
    cards: [
      C({ date: "2026-10-10", amount: 1000 }), // 三井 11/26 に引落
      C({ card: "saison", date: "2026-10-05", amount: 70000, group: "fixed", category: "家賃" }), // セゾン 11/4 に引落
      C({ card: "saison", date: "2026-10-31", amount: 5000, group: "installment", category: null }), // 分割（返済）は目標用マイナスで数える
      C({ date: "2026-11-02", amount: 2000 }), // 11月に使った分は11月の予算
    ],
    ...p,
  });
  it("繰越 ＝ 口座＋財布 − 前の月までのクレカ − 積立 − 安全残高", () => {
    const c = carryFor(base(), "2026-11")!;
    expect([c.bank, c.wallet, c.owed, c.saved, c.raw]).toEqual([250000, 10000, 71000, 70000, 109000]);
    expect(carryFor(base(), "2026-10")).toBeNull();
  });
  it("使えるお金 ＝ 給与 ＋ 追加予算 ＋ 繰越 − 固定費 − 目標用マイナス。予算は決めた額、なければ初めの値", () => {
    const b = monthBase(base(), "2026-11");
    expect([b.carry, b.goal, b.available, b.input, b.budgetManual, b.T]).toEqual([109000, 20000, 200000 + 109000 - b.fixed - 20000, true, false, 90000]);
    const set = monthBase(base({ budgets: [{ month: "2026-11", category: BUDGET_KEY, amount: 120000 }] }), "2026-11");
    expect([set.budgetManual, set.T]).toEqual([true, 120000]);
    // 始める月より前は、使えるお金がそのまま予算
    const old = monthBase(base(), "2026-10");
    expect([old.input, old.T]).toEqual([false, old.available]);
  });
  it("マイナスの繰越は使えるお金から引く", () => {
    const c = carryFor(base({ settings: { ...s, safety: 300000 } }), "2026-11")!;
    expect(c.raw).toBe(-181000);
  });
  it("前の月より前に残高の記録がなければ、あとの記録から戻して出す", () => {
    const later = base({ balances: [bal({ date: "2026-11-05", bank: 240000, cash: 10000 })], accounts: [A({ date: "2026-11-03", amount: 10000 })] });
    // 11/3 の出金と、11/4 のセゾンの引落（10月の家賃と分割 75,000円）を戻す
    expect(balanceAt(later, "2026-10-31")).toEqual({ bank: 325000, wallet: 10000 });
  });
});
