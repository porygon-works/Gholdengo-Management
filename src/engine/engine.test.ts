import { describe, expect, it } from "vitest";
import {
  ACCOUNT_GROUP_LABEL, accountNow, applyLabels, CARD_GROUP_LABEL, PAY_GROUP_LABEL, accountsWithBills, billsFor, budgetsFor, cardPayDate, categorize, DEFAULT_SETTINGS, findMerges,
  holidays, isBusinessDay, missingRecurring, normalizeShop,
  recurringDate, recurringDue, ruleFor, shiftBusiness, syncBills, emptyV5,
  type AccountEntry, type CardEntry, type Data, type Recurring,
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
const D = (p: Partial<Data>): Data => ({ accounts: [], cards: [], balances: [], recurring: [], goals: [], plans: [], debts: [], funds: [], months: [], budgets: [], rules: [], settings: S, ...p, v5: p.v5 ?? emptyV5() });
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
  it("先の請求は保存せずに見込みで出す。引落日が来たら見込みの額で確定の行を作る。確定した行は変えない。前の版の見込みの行は消す", () => {
    // 引落日の前：保存しない（見通し・明細には accountsWithBills の見込みで出る）
    expect(syncBills(d, "2026-10-21", ["2026-11"]).inserts).toEqual([]);
    const virt = accountsWithBills(d, "2026-10-21", ["2026-11"]).filter((e) => e.group === "card");
    expect(virt.map((e) => [e.name, e.date, e.amount, e.status])).toEqual([["三井 10月分", "2026-11-26", 16000, "plan"], ["セゾン 10月分", "2026-11-04", 80000, "plan"]]);
    // 引落日が来た：見込みの額で確定の行を作る
    expect(syncBills(d, "2026-11-26", ["2026-11"]).inserts.map((e) => [e.name, e.amount, e.status])).toEqual([["三井 10月分", 16000, "confirmed"], ["セゾン 10月分", 80000, "confirmed"]]);
    // 前の版の見込みの行：先の日付なら消す、引落日が来ていれば確定にする
    const row = A({ id: "r", group: "card", card: "smbc", status: "plan", amount: 1, date: "2026-11-26", source: "card_bill", source_ref: "bill:smbc:2026-11-26" });
    expect(syncBills({ ...d, accounts: [row] }, "2026-10-21", ["2026-11"]).removes).toEqual(["r"]);
    expect(syncBills({ ...d, accounts: [row] }, "2026-11-26", ["2026-11"]).updates).toEqual([{ id: "r", patch: { status: "confirmed", amount: 16000 } }]);
    // 確定の額が入った行は変えない・消さない
    const done = { ...row, status: "confirmed" as const, amount: 15800, locked: true };
    const s1 = syncBills({ ...d, accounts: [done] }, "2026-10-21", ["2026-11"]);
    expect([s1.updates, s1.removes]).toEqual([[], []]);
    expect(billsFor({ ...d, accounts: [done] }, "2026-11")[0].amount).toBe(15800);
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
