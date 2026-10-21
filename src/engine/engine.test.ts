import { describe, expect, it } from "vitest";
import {
  assetAt, budgetsFor, cardPayDate, cashLimit, dipBefore, cashDate, categorize, computeMonth, DEFAULT_SETTINGS, findMerges, forecast, holidays,
  isBusinessDay, missingRecurring, normalizeShop, projection, recurringDate, ruleFor, shiftBusiness, type Data, type Entry, type Recurring,
} from "./index";

const S = DEFAULT_SETTINGS;
let n = 0;
const E = (p: Partial<Entry>): Entry => ({
  id: p.id ?? `e${++n}`, kind: "expense", status: "confirmed", date: "2026-10-10", amount: 1000, method: "card", category: "食料品",
  shop: "", item: "", memo: "", tatekae: 0, source: "manual", source_ref: null, merged_into: null, recurring_id: null, not_dup: [], locked: false, ...p,
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
  const salary: Recurring = { id: "r1", name: "給与", kind: "income", category: null, amount: 250000, day: 15, shift: "next", method: "bank", shop: "", start_month: null, end_month: null, active: true };
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

describe("使える額の計算", () => {
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
  it("R は、残りをカードで使ったとして、今月分の引落日〜次の引落日に資産が安全残高を下回らない額", () => {
    const d = D({
      balances: [base],
      settings: { ...S, safety: 10000 },
      entries: [
        E({ method: "card", amount: 200000, date: "2026-09-20" }), // 10/26 に引落
        E({ kind: "expense", method: "bank", category: "固定引落", amount: 30000, date: "2026-10-27" }),
        E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: "2026-11-16", category: null }),
        E({ method: "card", amount: 40000, date: "2026-10-10" }), // 11/26 に引落
      ],
    });
    const v = computeMonth(d, "2026-10", today);
    // 11/26: 305000-200000-30000+250000-40000=285000。そこから 12/28 まで動きなし
    expect(v.min).toEqual({ value: 285000, date: "2026-11-26" });
    expect(v.R).toBe(275000);
    expect(v.U).toBe(40000);
    expect(v.T).toBe(315000);
    // 現金は今日出ていくので、10/27 の 75000 で決まる
    expect(cashLimit(d, today)).toEqual({ value: 65000, date: "2026-10-27" });
    expect(dipBefore(d, today)).toBeNull();
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
  });
  it("今月カードで使うと、R が同じだけ減り、T は変わらない（引落が給料日の後でも）", () => {
    const entries = [
      E({ kind: "expense", method: "bank", category: "固定引落", amount: 300000, date: "2026-11-09" }),
      E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: "2026-11-16", category: null }),
    ];
    const a = computeMonth(D({ balances: [base], entries }), "2026-10", today);
    const b = computeMonth(D({ balances: [base], entries: [...entries, E({ method: "card", amount: 3000, date: "2026-10-20" })] }), "2026-10", today);
    expect(a.R! - b.R!).toBe(3000);
    expect(b.T).toBe(a.T);
  });
  it("カード請求額が分かっていれば、その日のクレカ明細の代わりに請求額で数える", () => {
    const d = D({
      balances: [base],
      cardBills: [{ id: "c", pay_date: "2026-10-26", amount: 123456 }],
      entries: [E({ method: "card", amount: 200000, date: "2026-09-20" })],
    });
    const p = projection(d, today)!;
    expect(assetAt(p, "2026-10-26")).toBe(305000 - 123456);
  });
  it("予備は総予算から他の費目予算を引いた残り。未分類は予備に数える", () => {
    const d = D({
      balances: [base],
      budgets: [{ month: "2026-10", category: "食料品", amount: 30000 }, { month: "2026-10", category: "外食", amount: 20000 }],
      entries: [E({ amount: 3000, category: null, source: "card_flash", status: "flash" })],
    });
    const v = computeMonth(d, "2026-10", today);
    const reserve = v.cats.find((c) => c.cat === "予備")!;
    expect(v.T).toBe(305000 + 0); // R=305000-3000（11/26引落）、U=3000
    expect(reserve.budget).toBe(305000 - 50000);
    expect(reserve.used).toBe(3000);
    expect(v.unclassified).toHaveLength(1);
  });
  it("1日に使える額は、残り÷今日を含む月末までの日数", () => {
    const d = D({ balances: [base], budgets: [{ month: "2026-10", category: "食料品", amount: 30000 }], entries: [E({ amount: 6000 })] });
    const v = computeMonth(d, "2026-10", today);
    const food = v.cats.find((c) => c.cat === "食料品")!;
    expect(v.daysLeft).toBe(12);
    expect(food.daily).toBe(2000);
  });
  it("立替は予算に数えない。予算外とリボで買った物も数えない。ポイントは予算に数えるが資産は減らない", () => {
    const d = D({
      balances: [base],
      entries: [
        E({ amount: 88000, tatekae: 82500, category: "外食" }),
        E({ amount: 50000, category: "予算外" }),
        E({ amount: 30000, method: "revo", category: "日用品・通販" }),
        E({ amount: 500, method: "point" }),
      ],
    });
    const v = computeMonth(d, "2026-10", today);
    expect(v.U).toBe(5500 + 500);
    expect(v.outside).toHaveLength(2);
    const p = projection(d, today)!;
    expect(assetAt(p, "2026-11-26")).toBe(305000 - 88000 - 50000);
  });
  it("先の月は、前の月の R をその月の引落日に使ったものとして続けて計算する", () => {
    const d = D({
      balances: [base],
      entries: [
        E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: "2026-11-16", category: null }),
        E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: "2026-12-15", category: null }),
        E({ kind: "income", status: "plan", method: "bank", amount: 250000, date: "2027-01-15", category: null }),
      ],
    });
    const fc = forecast(d, today, 2)!;
    // 10月：11/26〜12/28 の最小は 11/26 の 555000（今の資産＋11月の給与）
    expect(fc[0].R).toBe(555000);
    // 11月：12/28〜1/26 は 12月の給与の分だけ
    expect(fc[1].R).toBe(250000);
    expect(fc[2].R).toBe(250000);
  });
  it("残高の報告がなければ R は出さない", () => {
    expect(computeMonth(D({}), "2026-10", today).noBalance).toBe(true);
  });
  it("予算は前の月から引き継ぐが、予備は引き継がない", () => {
    const d = D({ budgets: [{ month: "2026-09", category: "食料品", amount: 30000 }, { month: "2026-09", category: "予備", amount: 9999 }] });
    const b = budgetsFor(d, "2026-10");
    expect(b.get("食料品")).toBe(30000);
    expect(b.has("予備")).toBe(false);
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
