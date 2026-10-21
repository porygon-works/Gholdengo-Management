import { describe, expect, it } from "vitest";
import {
  assetAt, budgetsFor, cardPayDate, debitsFor, nextMonthDebits, nextPayday, balanceAfterDebits, cashLimit, dipBefore, goalPlan, monthBase, monthlyFor, planGoals, cashDate, categorize, computeMonth, DEFAULT_SETTINGS, findMerges, forecast, holidays,
  isBusinessDay, missingRecurring, normalizeShop, projection, recurringDate, ruleFor, shiftBusiness, type Data, type Entry, type Recurring,
} from "./index";

const S = DEFAULT_SETTINGS;
let n = 0;
const E = (p: Partial<Entry>): Entry => ({
  id: p.id ?? `e${++n}`, kind: "expense", status: "confirmed", date: "2026-10-10", amount: 1000, method: "card", category: "食料品",
  shop: "", item: "", memo: "", tatekae: 0, source: "manual", source_ref: null, merged_into: null, recurring_id: null, not_dup: [], locked: false, card: null, ...p,
});
const D = (p: Partial<Data>): Data => ({ entries: [], balances: [], cardBills: [], recurring: [], budgets: [], rules: [], debts: [], settings: S, ...p });

describe("日付と祝日", () => {
  it("2026年の祝日と振替休日", () => {
    const h = holidays(2026);
    for (const d of ["2026-01-01", "2026-01-12", "2026-03-20", "2026-05-06", "2026-07-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-23"]) {
      expect(h.has(d), d).toBe(true);
    }
    expect(h.has("2026-05-07")).toBe(false);
  });
  it("営業日にずらす", () => {
    expect(shiftBusiness("2026-09-26", "next")).toBe("2026-09-28"); // 土曜 → 月曜（三井住友の9月の支払日と同じ）
    expect(shiftBusiness("2026-11-15", "next")).toBe("2026-11-16"); // 日曜 → 月曜（給料日）
    expect(shiftBusiness("2026-11-15", "prev")).toBe("2026-11-13");
    expect(isBusinessDay("2027-01-02")).toBe(false);
  });
  it("カードの引落日", () => {
    expect(cardPayDate("2026-10", S)).toBe("2026-11-26");
    expect(cardPayDate("2026-08", S)).toBe("2026-09-28");
    expect(cardPayDate("2026-12", S)).toBe("2027-01-26");
  });
});

describe("資産から減る日", () => {
  it("金種ごと", () => {
    expect(cashDate(E({ method: "card", date: "2026-10-31" }), S)).toBe("2026-11-26");
    expect(cashDate(E({ method: "cash" }), S)).toBe("2026-10-10");
    expect(cashDate(E({ method: "paypay" }), S)).toBe("2026-10-10");
    expect(cashDate(E({ method: "point" }), S)).toBeNull();
    expect(cashDate(E({ method: "revo" }), S)).toBeNull();
    expect(cashDate(E({ method: "card", category: "返済", date: "2026-10-26" }), S)).toBe("2026-10-26");
    expect(cashDate(E({ kind: "transfer", method: "bank" }), S)).toBeNull();
  });
});

describe("定期のお金", () => {
  const salary: Recurring = { id: "r1", name: "給与", kind: "income", category: null, amount: 250000, day: 15, shift: "next", method: "bank", card: null, shop: "", start_month: null, end_month: null, active: true };
  it("土日祝をずらして予定を作る", () => {
    expect(recurringDate(salary, "2026-11")).toBe("2026-11-16");
    const out = missingRecurring([salary], [], ["2026-11", "2026-12"]);
    expect(out.map((e) => e.date)).toEqual(["2026-11-16", "2026-12-15"]);
    expect(out[0].source_ref).toBe("rec:r1:2026-11");
  });
  it("もう作った月は作らない", () => {
    const have = [E({ source_ref: "rec:r1:2026-11" })];
    expect(missingRecurring([salary], have, ["2026-11"])).toHaveLength(0);
  });
});

describe("重複の処理", () => {
  it("速報と明細：同じ金種・同じ金額・3日以内なら明細が速報を吸収する", () => {
    const flash = E({ id: "f", source: "card_flash", status: "flash", shop: "Mastercard加盟店", amount: 2990, date: "2026-10-15", category: null });
    const stmt = E({ id: "s", source: "card_statement", shop: "ネットフリックス", amount: 2990, date: "2026-10-14", category: null });
    const { merges, review } = findMerges([flash, stmt]);
    expect(review).toHaveLength(0);
    expect(merges).toHaveLength(1);
    expect(merges[0].keep.id).toBe("s");
    expect(merges[0].absorb.id).toBe("f");
  });
  it("手入力→速報→明細の順に吸収し、本人の費目が残る", () => {
    const manual = E({ id: "m", source: "manual", amount: 5000, date: "2026-10-17", category: "外食", item: "飲み会" });
    const flash = E({ id: "f", source: "card_flash", status: "flash", amount: 5000, date: "2026-10-17", category: null });
    const stmt = E({ id: "s", source: "card_statement", amount: 5000, date: "2026-10-17", category: "食料品" });
    const { merges } = findMerges([manual, flash, stmt]);
    expect(merges.map((m) => `${m.keep.id}<${m.absorb.id}`)).toEqual(["f<m", "s<f"]);
    expect(merges[1].patch.category).toBe("外食");
    expect(merges[1].patch.item).toBe("飲み会");
  });
  it("定期のお金の予定は、金額±20%・7日以内なら自動で吸収する", () => {
    const plan = E({ id: "p", status: "plan", source: "recurring", amount: 5000, date: "2026-10-24", category: "通信" });
    const real = E({ id: "r", source: "card_statement", amount: 5800, date: "2026-10-25", category: "通信" });
    expect(findMerges([plan, real]).merges[0]?.absorb.id).toBe("p");
  });
  it("一回きりの予定は自動でまとめず、要確認で聞く（Amazonの買い物がスマホケースの予定と取り違えられないように）", () => {
    const plan = E({ id: "p", status: "plan", source: "migration", amount: 3000, date: "2026-10-17", category: "日用品・通販", item: "スマホケース" });
    const amazon = E({ id: "a", source: "card_statement", amount: 3200, date: "2026-10-21", category: "日用品・通販", shop: "AMAZON.CO.JP" });
    const { merges, review } = findMerges([plan, amazon]);
    expect(merges).toHaveLength(0);
    expect(review[0].candidates.map((c) => c.id)).toEqual(["p"]);
    expect(review[0].reason).toContain("スマホケース");
  });
  it("3,000円未満の予定は金額がぴったりのときだけまとめる", () => {
    const plan = E({ id: "p", status: "plan", source: "recurring", amount: 550, date: "2026-10-06", category: "サブスク" });
    const prime = E({ id: "r", source: "card_statement", amount: 600, date: "2026-10-04", category: "サブスク" });
    expect(findMerges([plan, prime]).merges).toHaveLength(0);
  });
  it("予定にお店の名前のヒントがあれば、費目が違ってもまとめ、費目は予定に合わせる", () => {
    const plan = E({ id: "p", status: "plan", source: "recurring", amount: 6660, date: "2026-11-10", category: "定期代", shop: "モバイルSuica" });
    const flash = E({ id: "f", source: "card_flash", status: "flash", amount: 6660, date: "2026-11-09", category: "交通", shop: "モバイルＳｕｉｃａ（Ａｐｐｌｅ）" });
    const { merges } = findMerges([plan, flash]);
    expect(merges[0].absorb.id).toBe("p");
    expect(merges[0].patch.category).toBe("定期代");
  });
  it("費目が違う予定とは、金額がぴったりでもまとめない（外食 5,000円 と 通信 5,000円の予定）", () => {
    const plan = E({ id: "p", status: "plan", source: "recurring", amount: 5000, date: "2026-10-28", category: "通信" });
    const manual = E({ id: "m", source: "manual", amount: 5000, date: "2026-10-21", category: "外食", locked: true });
    expect(findMerges([plan, manual]).merges).toHaveLength(0);
  });
  it("候補が2件なら要確認", () => {
    const a = E({ id: "a", amount: 500, date: "2026-10-10" });
    const b = E({ id: "b", amount: 500, date: "2026-10-11" });
    const f = E({ id: "f", source: "card_flash", status: "flash", amount: 500, date: "2026-10-10" });
    const { merges, review } = findMerges([a, b, f]);
    expect(merges).toHaveLength(0);
    expect(review[0].candidates.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });
  it("日付が4〜7日ずれていれば要確認、金種が違えばまとめない", () => {
    const a = E({ id: "a", amount: 500, date: "2026-10-10" });
    const f = E({ id: "f", source: "card_flash", status: "flash", amount: 500, date: "2026-10-15" });
    expect(findMerges([a, f]).review).toHaveLength(1);
    const c = E({ id: "c", amount: 500, method: "cash" });
    const f2 = E({ id: "f2", source: "card_flash", status: "flash", amount: 500 });
    const r = findMerges([c, f2]);
    expect(r.merges).toHaveLength(0);
    expect(r.review).toHaveLength(0);
  });
  it("金額が少し違う候補は、手入力のときだけ出す", () => {
    const stmt = E({ id: "s", source: "card_statement", amount: 184, date: "2026-10-17" });
    const mig = E({ id: "m", source: "migration", amount: 180, date: "2026-10-16" });
    expect(findMerges([stmt, mig]).review).toHaveLength(0);
    const manual = E({ id: "h", source: "manual", amount: 1000, date: "2026-10-16" });
    const flash = E({ id: "f", source: "card_flash", status: "flash", amount: 1050, date: "2026-10-17" });
    expect(findMerges([manual, flash]).review).toHaveLength(1);
  });
  it("「別のもの」と決めたものはまとめない", () => {
    const a = E({ id: "a", amount: 500, not_dup: ["f"] });
    const f = E({ id: "f", source: "card_flash", status: "flash", amount: 500 });
    expect(findMerges([a, f]).merges).toHaveLength(0);
  });
});

describe("口座の見通し（足りなくなる日の警告に使う）", () => {
  const today = "2026-10-20";
  const base = { id: "b", date: "2026-10-19", bank: 300000, cash: 5000, paypay: 0, memo: "" };
  it("予測資産は報告日より後の出来事だけを足し引きする", () => {
    const d = D({
      balances: [base],
      entries: [
        E({ method: "cash", amount: 1000, date: "2026-10-18" }), // 報告より前 → 残高に入っている
        E({ method: "cash", amount: 2000, date: "2026-10-20" }),
        E({ method: "card", amount: 50000, date: "2026-10-05" }), // 11/26 に引落
        E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: "2026-11-16", category: null }),
      ],
    });
    const p = projection(d, today)!;
    expect(assetAt(p, "2026-10-20")).toBe(303000);
    expect(assetAt(p, "2026-11-26")).toBe(303000 + 250000 - 50000);
  });
  it("残高の報告日より前の日付の予定は、残高に入っているものとして数えない（月の途中で作った給与の予定など）", () => {
    const d = D({
      balances: [base],
      entries: [
        E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: "2026-10-15", category: null }),
        E({ kind: "expense", status: "plan", method: "cash", amount: 1000, date: "2026-10-19", category: "食料品" }), // 報告日と同じ日 → 残高に入っている
        E({ kind: "expense", status: "plan", method: "card", amount: 2000, date: "2026-10-18", category: "食料品" }), // カードは 11/26 に引落なので数える
      ],
    });
    const p = projection(d, today)!;
    expect(p.events.map((e) => [e.date, e.delta])).toEqual([["2026-11-26", -2000]]);
  });
  it("引落日より前に安全残高を下回る日があれば知らせる", () => {
    const d = D({ balances: [base], entries: [E({ kind: "expense", method: "bank", category: "固定引落", amount: 400000, date: "2026-11-04" })] });
    expect(dipBefore(d, today)).toEqual({ value: -95000, date: "2026-11-04" });
    expect(dipBefore(D({ balances: [base] }), today)).toBeNull();
  });
  it("現金はすぐ口座から出るので、今日からいちばん少ない日で上限を出す", () => {
    const d = D({ balances: [base], settings: { ...S, safety: 10000 }, entries: [E({ kind: "expense", method: "bank", category: "固定引落", amount: 230000, date: "2026-10-27" })] });
    expect(cashLimit(d, today)).toEqual({ value: 65000, date: "2026-10-27" });
  });
  it("カード請求額が分かっていれば、その日のクレカ明細の代わりに請求額で数える", () => {
    const d = D({
      balances: [base],
      cardBills: [{ id: "c", card: "smbc", pay_date: "2026-10-26", amount: 123456 }],
      entries: [E({ method: "card", amount: 200000, date: "2026-09-20" })],
    });
    const p = projection(d, today)!;
    expect(assetAt(p, "2026-10-26")).toBe(305000 - 123456);
  });
  it("立替・予算外も口座からは出る。リボで買った物は出ない（返済で出る）", () => {
    const d = D({
      balances: [base],
      entries: [E({ amount: 88000, tatekae: 82500, category: "外食" }), E({ amount: 50000, category: "予算外" }), E({ amount: 30000, method: "revo", category: "日用品・通販" })],
    });
    expect(assetAt(projection(d, today)!, "2026-11-26")).toBe(305000 - 88000 - 50000);
  });
  it("先の月の見通しは、前の月の分をその月の引落日に使ったものとして続けて計算する", () => {
    const inc = (date: string) => E({ kind: "income", status: "plan", method: "bank", amount: 250000, date, category: null });
    const fc = forecast(D({ balances: [base], entries: [inc("2026-11-16"), inc("2026-12-15"), inc("2027-01-15")] }), today, 2)!;
    expect(fc.map((f) => f.R)).toEqual([555000, 250000, 250000]);
  });
});

describe("今月の予算（給与 ＋ 追加予算 − 固定費 − 目標用マイナス）", () => {
  const today = "2026-10-20";
  const salary = E({ kind: "income", status: "confirmed", method: "bank", amount: 260000, date: "2026-10-15", category: "給与" });
  const revo = E({ kind: "expense", status: "plan", method: "card", category: "返済", amount: 20000, date: "2026-10-26" });
  const fixedBudgets = [{ month: "2026-10", category: "家賃", amount: 70000 }, { month: "2026-10", category: "通信", amount: 5000 }];
  it("予算の元：固定費は固定費の費目の予算の合計。賞与や売却代金・立替の返金は、追加予算にしたときだけ入る", () => {
    const d = D({
      budgets: fixedBudgets,
      entries: [
        salary, revo,
        E({ kind: "income", status: "plan", method: "bank", amount: 5000, date: "2026-10-20", category: "追加予算", item: "イベチケ" }),
        E({ kind: "income", status: "plan", method: "cash", amount: 16000, date: "2026-10-25", category: null, item: "立替の返金" }),
        E({ kind: "income", status: "confirmed", method: "bank", amount: 40000, date: "2026-10-20", category: null, item: "売却代金" }),
      ],
    });
    const b = monthBase(d, "2026-10");
    expect([b.salary, b.extra, b.fixed, b.goal]).toEqual([260000, 5000, 75000, 20000]);
    expect(b.T).toBe(260000 + 5000 - 75000 - 20000);
  });
  it("固定費の費目に予算がなければ、定期のお金のその月の額を初めの値にする", () => {
    const rec = (p: Partial<Recurring>): Recurring => ({ id: "r", name: "奨学金", kind: "expense", category: "奨学金", amount: 30000, day: 27, shift: "next", method: "bank", card: null, shop: "", start_month: null, end_month: null, active: true, ...p });
    const d = D({ recurring: [rec({}), rec({ id: "r2", name: "家賃", category: "家賃", amount: 70000, start_month: "2027-01" })] });
    expect(budgetsFor(d, "2026-10").get("奨学金")).toBe(30000);
    expect(budgetsFor(d, "2026-10").has("家賃")).toBe(false);
    expect(monthBase(d, "2027-01").fixed).toBe(100000);
  });
  it("固定費の費目が定期のお金になければ、その月の明細と予定の合計を初めの値にする", () => {
    const d = D({ entries: [E({ status: "plan", method: "bank", amount: 70000, date: "2026-11-04", category: "家賃", item: "家賃" })] });
    expect(budgetsFor(d, "2026-11").get("家賃")).toBe(70000);
    expect(budgetsFor(d, "2026-12").has("家賃")).toBe(false);
  });
  it("定期のお金から作った収入は、扱いを決めていなければ給与として数える", () => {
    const d = D({ entries: [E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: "2026-11-16", category: null, recurring_id: "r1" })] });
    expect(monthBase(d, "2026-11").salary).toBe(250000);
  });
  it("目標用マイナスの初期値は、その月の返済＋貯金（貯金を始める月から）。手で直した月はその値を使う", () => {
    const settings = { ...S, savingMonthly: 20000, savingStart: "2027-01" };
    const d = D({ settings, entries: [revo] });
    expect(monthBase(d, "2026-10").goal).toBe(20000);
    expect(monthBase(d, "2026-12").goal).toBe(0);
    expect(monthBase(d, "2027-01").goal).toBe(20000);
    const m = monthBase(D({ settings, entries: [revo], budgets: [{ month: "2026-10", category: "#目標用マイナス", amount: 35000 }] }), "2026-10");
    expect(m.goal).toBe(35000);
    expect(m.manual.goal).toBe(true);
    expect(m.auto.goal).toBe(20000);
  });
  it("自由に使える残り ＝ 予算 − 変動費で使った − 変動費の予定。固定費の支払いと返済は引かない", () => {
    const d = D({
      budgets: fixedBudgets,
      entries: [salary, revo, E({ method: "bank", amount: 70000, category: "家賃", date: "2026-10-04" }), E({ amount: 3000, category: "外食", date: "2026-10-18" }), E({ status: "plan", amount: 5000, category: "外食", date: "2026-10-25" })],
    });
    const v = computeMonth(d, "2026-10", today);
    expect(v.T).toBe(260000 - 75000 - 20000);
    expect([v.U, v.P, v.fixedOver]).toEqual([3000, 5000, 0]);
    expect(v.R).toBe(v.T - 8000);
    expect(v.cats.find((c) => c.cat === "家賃")!.used).toBe(70000);
    expect(v.outside.map((e) => e.category)).toEqual(["返済"]);
  });
  it("固定費が予算（見込み）をこえた分は、自由に使える残りから引く", () => {
    const d = D({ budgets: fixedBudgets, entries: [salary, E({ amount: 6500, category: "通信" })] });
    const v = computeMonth(d, "2026-10", today);
    expect(v.fixedOver).toBe(1500);
    expect(v.R).toBe(v.T - 1500);
  });
  it("カードで使っても現金で使っても、残りは同じだけ減り、予算は変わらない", () => {
    const a = computeMonth(D({ entries: [salary] }), "2026-10", today);
    const b = computeMonth(D({ entries: [salary, E({ method: "card", amount: 3000, category: "食料品" }), E({ method: "cash", amount: 1000, category: "食料品" })] }), "2026-10", today);
    expect(a.R - b.R).toBe(4000);
    expect(b.T).toBe(a.T);
  });
  it("予備は予算から他の変動費の予算を引いた残り。未分類は予備に数える", () => {
    const d = D({
      budgets: [...fixedBudgets, { month: "2026-10", category: "食料品", amount: 30000 }, { month: "2026-10", category: "外食", amount: 20000 }],
      entries: [salary, E({ amount: 3000, category: null, source: "card_flash", status: "flash" })],
    });
    const v = computeMonth(d, "2026-10", today);
    const reserve = v.cats.find((c) => c.cat === "予備")!;
    expect(reserve.budget).toBe(260000 - 75000 - 50000);
    expect(reserve.used).toBe(3000);
    expect(v.unclassified).toHaveLength(1);
  });
  it("1日に使える額は、残り÷今日を含む月末までの日数", () => {
    const d = D({ budgets: [{ month: "2026-10", category: "食料品", amount: 30000 }], entries: [E({ amount: 6000 })] });
    const v = computeMonth(d, "2026-10", today);
    const food = v.cats.find((c) => c.cat === "食料品")!;
    expect(v.daysLeft).toBe(12);
    expect(food.daily).toBe(2000);
  });
  it("立替は自分の分だけを数える。予算外とリボで買った物は数えない", () => {
    const d = D({ entries: [E({ amount: 88000, tatekae: 82500, category: "外食" }), E({ amount: 50000, category: "予算外" }), E({ amount: 30000, method: "revo", category: "日用品・通販" })] });
    const v = computeMonth(d, "2026-10", today);
    expect(v.U).toBe(5500);
    expect(v.outside).toHaveLength(2);
  });
  it("費目予算は前の月から引き継ぐが、予備は引き継がない", () => {
    const d = D({ budgets: [{ month: "2026-09", category: "食料品", amount: 30000 }, { month: "2026-09", category: "予備", amount: 9999 }] });
    const b = budgetsFor(d, "2026-10");
    expect(b.get("食料品")).toBe(30000);
    expect(b.has("予備")).toBe(false);
    // 予算の元だけを直した月があっても、費目予算は前の月から引き継ぐ
    const d2 = D({ budgets: [{ month: "2026-09", category: "食料品", amount: 30000 }, { month: "2026-10", category: "#目標用マイナス", amount: 10000 }] });
    expect(budgetsFor(d2, "2026-10").get("食料品")).toBe(30000);
  });
  it("目標用マイナスの見通し：まず借金に回し、なくなったら貯金に回す", () => {
    const d = D({
      settings: { ...S, savingMonthly: 20000, savingStart: "2026-10", reserveGoal: 30000 },
      debts: [{ id: "d", name: "リボ", balance: 30000, as_of: null, rate: "", min_payment: 0, note: "", planned: false }],
    });
    const g = goalPlan(d, "2026-10", 4);
    expect(g.rows.map((r) => [r.toDebt, r.toSaving, r.debtLeft, r.saved])).toEqual([[20000, 0, 10000, 0], [10000, 10000, 0, 10000], [0, 20000, 0, 30000], [0, 20000, 0, 50000]]);
    expect(g.payoffYm).toBe("2026-11");
    expect(g.reachYm).toBe("2026-12");
  });
  it("目標用マイナスの見通し：賞与もその月に借金の返済に回し、余りは貯金に回す", () => {
    const d = D({
      settings: { ...S, savingMonthly: 0, savingStart: null },
      debts: [{ id: "d", name: "リボ", balance: 100000, as_of: null, rate: "", min_payment: 0, note: "", planned: false }],
      entries: [E({ kind: "income", status: "plan", method: "bank", amount: 300000, date: "2026-12-15", category: null, item: "賞与（12月）" })],
    });
    const g = goalPlan(d, "2026-11", 3);
    expect(g.rows.map((r) => [r.bonus, r.toDebt, r.toSaving, r.debtLeft])).toEqual([[0, 0, 0, 100000], [300000, 100000, 200000, 0], [0, 0, 0, 0]]);
    expect(g.payoffYm).toBe("2026-12");
  });
});

describe("計画をつくる", () => {
  const debts = [{ id: "d", name: "リボ", balance: 100000, as_of: null, rate: "", min_payment: 0, note: "", planned: false }];
  const salaryPlan = (ym: string) => E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: `${ym}-15`, category: "給与" });
  it("毎月の額から：まず借金に回し、返し終えたら貯金。賞与もその月に回す。返済の予定が多い月はその額", () => {
    const d = D({
      settings: { ...S, salaryEstimate: 250000 },
      debts,
      budgets: [{ month: "2026-11", category: "家賃", amount: 70000 }],
      entries: [
        salaryPlan("2026-11"),
        E({ kind: "expense", status: "plan", method: "card", category: "返済", amount: 30000, date: "2026-11-26" }),
        E({ kind: "income", status: "plan", method: "bank", amount: 50000, date: "2026-12-15", category: null, item: "賞与" }),
      ],
    });
    const r = planGoals(d, { from: "2026-11", monthly: 20000, useBonus: true, saved: 10000, target: 60000, months: 4 });
    expect(r.rows.map((x) => [x.put, x.bonus, x.debtLeft, x.saved])).toEqual([[30000, 0, 70000, 10000], [20000, 50000, 0, 10000], [20000, 0, 0, 30000], [20000, 0, 0, 50000]]);
    expect(r.payoffYm).toBe("2026-12");
    expect(r.reachYm).toBeNull();
    expect(r.rows[0].free).toBe(250000 - 70000 - 30000);
  });
  it("達成したい月から：その月までに目標に届く、いちばん少ない毎月の額", () => {
    const d = D({ settings: { ...S, salaryEstimate: 250000 }, debts });
    const m = monthlyFor(d, { from: "2026-11", useBonus: false, saved: 0, target: 100000 }, "2027-08")!;
    // 10か月（11月〜8月）で 借金10万＋貯金10万 = 20万 → 毎月 2万
    expect(m).toBe(20000);
    expect(planGoals(d, { from: "2026-11", monthly: m, useBonus: false, saved: 0, target: 100000 }).reachYm).toBe("2027-08");
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

describe("カード2枚と引き落とし", () => {
  it("カードごとの締め日・引落日で、資産から減る日を出す", () => {
    expect(cashDate(E({ method: "card", card: "saison", date: "2026-10-31" }), S)).toBe("2026-11-04");
    expect(cardPayDate("2026-12", S, "saison")).toBe("2027-01-04");
    expect(cashDate(E({ method: "card", card: null, date: "2026-10-31" }), S)).toBe("2026-11-26");
    const later = { ...S, cards: [S.cards[0], { ...S.cards[1], payMonths: 2 }] };
    expect(cashDate(E({ method: "card", card: "saison", date: "2026-10-31" }), later)).toBe("2026-12-04");
  });
  it("引き落とし枠：口座から直接・カードごとの見込み・請求額があれば確定", () => {
    const d = D({
      entries: [
        E({ method: "bank", category: "奨学金", amount: 30000, date: "2026-11-27", status: "plan" }),
        E({ method: "card", amount: 5000, date: "2026-10-05" }),
        E({ method: "card", amount: 3000, date: "2026-10-31" }),
        E({ method: "card", amount: 9000, date: "2026-11-01" }),
        E({ method: "card", card: "saison", category: "家賃", amount: 70000, date: "2026-10-27" }),
        E({ method: "card", card: "saison", category: "返済", amount: 10000, date: "2026-11-04", status: "plan" }),
        E({ method: "cash", amount: 800, date: "2026-11-02" }),
      ],
    });
    const x = debitsFor(d, "2026-11");
    expect(x.directSum).toBe(30000);
    const [smbc, saison] = x.cards;
    expect([smbc.date, smbc.estimate, smbc.bill]).toEqual(["2026-11-26", 8000, null]);
    expect([saison.date, saison.estimate, saison.repays.length]).toEqual(["2026-11-04", 80000, 1]);
    expect(x.total).toBe(30000 + 8000 + 80000);
    const y = debitsFor({ ...d, cardBills: [{ id: "b", card: "smbc", pay_date: "2026-11-26", amount: 8500 }] }, "2026-11");
    expect([y.cards[0].bill, y.cards[0].amount, y.total]).toEqual([8500, 8500, 30000 + 8500 + 80000]);
  });
  it("来月の支払い予定：来月の引き落としを、カードの固定費・直接の固定費・カードの変動費・返済に分ける", () => {
    const d = D({
      entries: [
        E({ method: "card", card: "saison", category: "家賃", amount: 70000, date: "2026-10-27", status: "plan" }),
        E({ method: "card", category: "食料品", amount: 4000, date: "2026-10-10" }),
        E({ method: "card", category: "外食", amount: 3000, date: "2026-10-30", status: "plan" }),
        E({ method: "cash", category: "外食", amount: 900, date: "2026-10-11" }),
        E({ method: "bank", category: "奨学金", amount: 30000, date: "2026-11-27", status: "plan" }),
        E({ method: "card", card: "saison", category: "返済", amount: 10000, date: "2026-11-04", status: "plan" }),
      ],
    });
    const n = nextMonthDebits(d, "2026-11");
    expect([n.cardFixed, n.directFixed, n.cardVar, n.repay, n.other]).toEqual([70000, 30000, 7000, 10000, 0]);
    expect(n.total).toBe(117000);
  });
  it("口座の今後の動き：今月これからの引き落としと、次の給料日の前日に残る額", () => {
    const d = D({
      balances: [{ id: "b", date: "2026-10-19", bank: 300000, cash: 10000, paypay: 0, memo: "" }],
      entries: [
        E({ method: "card", amount: 50000, date: "2026-09-10" }),
        E({ method: "bank", category: "奨学金", amount: 30000, date: "2026-10-27", status: "plan" }),
        E({ method: "bank", category: "奨学金", amount: 30000, date: "2026-10-10" }),
        E({ method: "card", card: "saison", category: "家賃", amount: 70000, date: "2026-10-27", status: "plan" }),
        E({ method: "bank", category: "保険・共済", amount: 2000, date: "2026-11-20", status: "plan" }),
      ],
    });
    expect(nextPayday(S, "2026-10-21")).toBe("2026-11-16");
    expect(nextPayday(S, "2026-10-14")).toBe("2026-10-15");
    const x = balanceAfterDebits(d, "2026-10-21")!;
    expect([x.now, x.thisMonth, x.afterThisMonth]).toEqual([310000, 80000, 230000]);
    expect([x.nextBeforePay, x.beforePayday]).toEqual([70000, 160000]);
  });
});
