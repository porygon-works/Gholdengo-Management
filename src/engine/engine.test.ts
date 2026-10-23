import { describe, expect, it } from "vitest";
import {
  ACCOUNT_GROUP_LABEL, accountFlow, accountNow, applyLabels, CARD_GROUP_LABEL, PAY_GROUP_LABEL, accountsWithBills, billsFor, budgetsFor, cardPayDate, categorize, computeMonth, DEFAULT_SETTINGS, findMerges,
  goalSchedule, holidays, isBusinessDay, missingRecurring, monthBase, nextPayday, nextPayments, normalizeShop,
  recurringDate, recurringDue, ruleFor, shiftBusiness, syncBills,
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
const D = (p: Partial<Data>): Data => ({ accounts: [], cards: [], balances: [], recurring: [], goals: [], plans: [], debts: [], funds: [], months: [], budgets: [], rules: [], settings: S, ...p });
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
    // 中身がなくなった（見込みが0の）予定の行は消す。確定の額が入った行は消さない
    const empty = A({ id: "z", group: "card", card: "smbc", status: "plan", amount: 1, date: "2027-02-26", source: "card_bill", source_ref: "bill:smbc:2027-02-26" });
    expect(syncBills({ ...d, accounts: [empty] }, "2026-10-21", ["2027-02"]).removes).toEqual(["z"]);
    expect(syncBills({ ...d, accounts: [{ ...empty, locked: true }] }, "2026-10-21", ["2027-02"]).removes).toEqual([]);
  });
});

describe("今月の予算と残り予算", () => {
  const fixed = [{ month: "2026-10", category: "家賃", amount: 70000 }, { month: "2026-10", category: "通信", amount: 5000 }];
  it("予算の元：給与・追加予算は口座明細の入金、固定費は固定費の予算、計画の分は計画の支払いと予算から入れる分。決めた予算があればそれ", () => {
    const d = D({
      budgets: fixed,
      plans: [{ id: "p1", kind: "repay", name: "リボ", use_date: "2026-12-16", target: 0, done: false, sort: 0 }, { id: "p2", kind: "save", name: "貯金", use_date: null, target: 100000, done: false, sort: 1 }],
      funds: [{ id: "f1", plan_id: "p2", source: "budget", name: "", date: "2026-11-26", budget_month: "2026-10", amount: 20000, status: "plan" }, { id: "f2", plan_id: "p2", source: "bonus", name: "", date: "2026-10-30", budget_month: null, amount: 5000, status: "plan" }],
      accounts: [
        A({ direction: "in", group: "salary", amount: 260000, date: "2026-10-15" }),
        A({ direction: "in", group: "extra", amount: 5000, date: "2026-10-20", status: "plan" }),
        A({ direction: "in", group: "refund", amount: 16000, date: "2026-10-25" }),
        A({ direction: "in", group: "other", name: "売却代金", amount: 40000, date: "2026-10-20" }),
        A({ group: "other", category: null, amount: 10000, date: "2026-11-04", status: "plan", plan_id: "p1", plan_role: "pay", budget_month: "2026-10", source: "plan" }),
        A({ group: "other", category: null, amount: 99000, date: "2026-12-16", status: "plan", plan_id: "p1", plan_role: "lump", source: "plan" }),
      ],
    });
    const b = monthBase(d, "2026-10");
    expect([b.salary, b.extra, b.fixed, b.plan, b.manual]).toEqual([260000, 5000, 75000, 30000, null]);
    expect(b.T).toBe(260000 + 5000 - 75000 - 30000);
    const m = monthBase({ ...d, months: [{ month: "2026-10", budget: 90000, memo: "" }] }, "2026-10");
    expect([m.T, m.auto, m.manual]).toEqual([90000, b.auto, 90000]);
    // まとめて払う行は予算から引かない（確保額から払う）
    expect(monthBase(d, "2026-12").plan).toBe(0);
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

describe("前の版の目標マスタ（計画に写すときに使う）", () => {
  it("返済：残高の日より後の支払いから、残高が0になるまで。臨時の返済で早く終わる", () => {
    const g = G({ balance: 35000, monthly: 10000, as_of: "2026-10-19", card: "saison", lumps: [{ date: "2026-12-16", amount: 99999, memo: "賞与から" }] });
    const m = goalSchedule(g, S, "2026-10", 4);
    expect(m.map((x) => [x.ym, x.pay, x.lump, x.left])).toEqual([["2026-11", 10000, 0, 25000], ["2026-12", 10000, 15000, 0], ["2027-01", 0, 0, 0], ["2027-02", 0, 0, 0]]);
  });
  it("積立：始める月から目標額まで", () => {
    const save = G({ kind: "save", balance: 0, target: 50000, monthly: 20000, start_month: "2027-01" });
    expect(goalSchedule(save, S, "2026-12", 5).map((x) => x.pay)).toEqual([0, 20000, 20000, 10000, 0]);
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

describe("区分", () => {
  it("大費目の名前を変えると、画面で使う名前の表が変わる（計算は id のまま）", () => {
    applyLabels({ ...S, labels: { variable: "やりくり費", installment: "リボ" } });
    expect([ACCOUNT_GROUP_LABEL.variable, CARD_GROUP_LABEL.variable, CARD_GROUP_LABEL.installment, PAY_GROUP_LABEL.installment, PAY_GROUP_LABEL.fixed]).toEqual(["やりくり費", "やりくり費", "リボ", "計画の支払い", "固定費"]);
    applyLabels(S);
    expect([ACCOUNT_GROUP_LABEL.variable, PAY_GROUP_LABEL.installment]).toEqual(["変動費", "計画の支払い"]);
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
