import { describe, expect, it } from "vitest";
import { acc, card, S } from "../engine/fixture";
import { atmRow, defaultStatus, handover, handoverPatch, incomeChange, revolvingPatch, spendChange, splitRows } from "./v5ops";

// v5 の明細の操作（設計書 §3.4・§3.6）。値はすべて作り物
describe("リボに回す", () => {
  it("回すと分割（購入）、戻すと費目から決めた大費目", () => {
    const rent = card({ card: "saison", group: "fixed", category: "家賃", amount: 80000 });
    expect(revolvingPatch(S, rent, true)).toEqual({ group: "purchase" });
    expect(revolvingPatch(S, { ...rent, group: "purchase" }, false)).toEqual({ group: "fixed" });
    expect(revolvingPatch(S, card({ group: "purchase", category: "外食" }), false)).toEqual({ group: "variable" });
  });
});

describe("口座明細を分ける", () => {
  it("1行を費目ごとの行に分ける（最初の行は元の行を直す）", () => {
    const e = acc({ id: "atm", category: "現金", amount: 10000, name: "ATMで引き出し" });
    const r = splitRows(S, e, [{ category: "外食", amount: 8000 }, { category: "趣味・娯楽", amount: 2000 }]);
    expect(r.update).toEqual({ id: "atm", patch: { category: "外食", amount: 8000, group: "variable" } });
    expect(r.inserts).toHaveLength(1);
    expect(r.inserts[0]).toMatchObject({ category: "趣味・娯楽", amount: 2000, date: e.date, direction: "out", account: "bank", group: "variable" });
  });
  it("合計が元の額と違えば分けない", () => {
    expect(() => splitRows(S, acc({ amount: 10000 }), [{ category: "外食", amount: 5000 }])).toThrow();
  });
});

describe("ATM で引き出す", () => {
  it("口座の出金・費目「現金」の1行（財布は持たない）", () => {
    expect(atmRow("2026-11-05", 10000)).toMatchObject({ account: "bank", direction: "out", status: "confirmed", group: "variable", category: "現金", amount: 10000, date: "2026-11-05", name: "ATMで引き出し" });
  });
});

describe("v4 から引き継ぐ", () => {
  it("v4 の計画の予定の行と、前の版の調整の行は消す。v4 の計画の確定した行は、計画とのつながりだけ外す", () => {
    const rows = [
      acc({ id: "keep", amount: 1000 }),
      acc({ id: "pp", status: "plan", amount: 2000, plan_id: "v4p", plan_role: "pay" }),
      acc({ id: "pc", status: "confirmed", amount: 3000, plan_id: "v4p", plan_role: "pay", budget_month: "2026-10" }),
      acc({ id: "adj", direction: "in", group: "salary", amount: 4000, source: "migration", source_ref: "v2base:#給与:2026-10" }),
    ];
    const h = handover(rows);
    expect(h.remove.map((e) => e.id)).toEqual(["pp", "adj"]);
    expect(h.unlink.map((e) => e.id)).toEqual(["pc"]);
    expect(handoverPatch).toEqual({ plan_id: null, plan_role: null, budget_month: null });
    expect(handover([acc({ id: "keep" })])).toEqual({ remove: [], unlink: [] });
  });
});

describe("入力の画面で保存する中身", () => {
  it("予定か確定かの最初の値は日付で決める（先の日付なら予定）", () => {
    expect(defaultStatus("2026-11-05", "2026-11-05")).toBe("confirmed");
    expect(defaultStatus("2026-11-04", "2026-11-05")).toBe("confirmed");
    expect(defaultStatus("2026-11-06", "2026-11-05")).toBe("plan");
  });
  const base = { cat: "外食", amount: 1200, date: "2026-11-05", name: "", status: "confirmed" as const, tatekae: 0, memo: "" };
  it("出金：払い方がカードならクレカ明細、口座・PayPay は口座明細（費目から大費目を決める）", () => {
    expect(spendChange(S, { ...base, pay: "card:smbc" })).toMatchObject({ kind: "addCard", entry: { card: "smbc", group: "variable", category: "外食", amount: 1200, status: "confirmed" } });
    expect(spendChange(S, { ...base, pay: "bank", cat: "家賃" })).toMatchObject({ kind: "addAccount", entry: { account: "bank", direction: "out", group: "fixed", category: "家賃" } });
    expect(spendChange(S, { ...base, pay: "paypay" })).toMatchObject({ kind: "addAccount", entry: { name: "PayPayチャージ", category: "外食" } });
  });
  it("出金：現金は ATM で引き出した額（費目「現金」）", () => {
    expect(spendChange(S, { ...base, pay: "atm" })).toMatchObject({ kind: "addAccount", entry: { category: "現金", group: "variable", name: "ATMで引き出し", amount: 1200 } });
  });
  it("出金：カードで一部を立て替えたら立替額、全額なら大費目を立替にする", () => {
    expect(spendChange(S, { ...base, pay: "card:smbc", tatekae: 500 })).toMatchObject({ kind: "addCard", entry: { group: "variable", tatekae: 500 } });
    expect(spendChange(S, { ...base, pay: "card:smbc", tatekae: 1200 })).toMatchObject({ kind: "addCard", entry: { group: "tatekae", category: null, tatekae: 0 } });
  });
  it("入金：区分が違うだけで、同じ口座明細の入金", () => {
    expect(incomeChange({ group: "bonus", amount: 250000, date: "2026-12-15", name: "", status: "plan" })).toMatchObject({ kind: "addAccount", entry: { account: "bank", direction: "in", group: "bonus", name: "賞与", status: "plan", category: null } });
    expect(incomeChange({ group: "refund", amount: 3000, date: "2026-11-05", name: "飲み会", status: "confirmed" })).toMatchObject({ entry: { group: "refund", name: "飲み会" } });
  });
});
