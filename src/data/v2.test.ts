import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../engine";
import { convertBill, convertDebt, convertEntry, recurringFromRow } from "./v2";

// 前の版（v2）の行を v3 の形に変える（値はすべて作り物）
const S = DEFAULT_SETTINGS;
const row = (p: Record<string, unknown>) => ({ id: "x1", kind: "expense", status: "confirmed", date: "2026-10-10", amount: 1000, method: "card", category: "食料品", shop: "", item: "", memo: "", tatekae: 0, source: "manual", source_ref: null, recurring_id: null, ...p });

describe("v2 → v3", () => {
  it("クレカ・リボ・返済・予算外はクレカ明細の大費目に", () => {
    expect(convertEntry(row({ source: "card_flash", status: "flash", source_ref: "m#1" }), S).cards[0]).toMatchObject({ card: "smbc", group: "variable", status: "confirmed", source: "card_flash", source_ref: "m#1" });
    expect(convertEntry(row({ category: "家賃", card: "saison" }), S).cards[0]).toMatchObject({ card: "saison", group: "fixed", category: "家賃" });
    expect(convertEntry(row({ method: "revo" }), S).cards[0].group).toBe("purchase");
    // 分割（返済）は引落日の日付のまま
    expect(convertEntry(row({ category: "返済", date: "2026-10-26" }), S).cards[0]).toMatchObject({ group: "installment", category: null, date: "2026-10-26" });
    expect(convertEntry(row({ category: "予算外" }), S).cards[0].group).toBe("tatekae");
  });
  it("口座・PayPay は口座、現金・交通系は財布。収入は給与・追加予算・立替の返金・その他", () => {
    expect(convertEntry(row({ method: "bank", category: "奨学金", item: "奨学金" }), S).accounts[0]).toMatchObject({ account: "bank", direction: "out", group: "fixed", name: "奨学金", source_ref: "v2:x1" });
    expect(convertEntry(row({ method: "cash" }), S).accounts[0]).toMatchObject({ account: "wallet", group: "variable" });
    expect(convertEntry(row({ kind: "income", method: "bank", category: null, recurring_id: "r" }), S).accounts[0].group).toBe("salary");
    expect(convertEntry(row({ kind: "income", method: "bank", category: "追加予算" }), S).accounts[0].group).toBe("extra");
    expect(convertEntry(row({ kind: "income", method: "cash", category: null, item: "立替の返金（飲み会）" }), S).accounts[0]).toMatchObject({ account: "wallet", group: "refund" });
    expect(convertEntry(row({ method: "bank", category: "返済", item: "セゾン リボ返済", status: "plan" }), S).cards[0]).toMatchObject({ card: "saison", group: "installment", status: "plan", date: "2026-10-10" });
    expect(convertEntry(row({ method: "bank", category: "固定引落", item: "家賃" }), S).accounts[0].category).toBe("家賃");
  });
  it("ATM は口座の出金と財布の入金の2行。ポイントは捨てる", () => {
    const a = convertEntry(row({ kind: "transfer", method: "bank", category: null, item: "ATMで引き出し" }), S).accounts;
    expect(a.map((e) => [e.account, e.direction])).toEqual([["bank", "out"], ["wallet", "in"]]);
    expect(convertEntry(row({ method: "point" }), S)).toEqual({ accounts: [], cards: [] });
  });
  it("請求額はクレカ支払い（確定）、借金は返済の目標、定期のお金は大費目と払い方を決める", () => {
    expect(convertBill({ pay_date: "2026-10-26", amount: 5000 }, S)).toMatchObject({ group: "card", status: "confirmed", name: "三井 9月分", source_ref: "bill:smbc:2026-10-26" });
    expect(convertDebt({ id: "d", name: "セゾン リボ", balance: 30000, as_of: "2026-10-19", min_payment: 10000 }, S)).toMatchObject({ kind: "repay", card: "saison", monthly: 10000 });
    expect(recurringFromRow({ id: "r", name: "家賃", kind: "expense", category: "家賃", amount: 70000, day: 4, method: "card", card: "saison" }, S)).toMatchObject({ pay: "card", group: "fixed", card: "saison" });
    expect(recurringFromRow({ id: "r", name: "給与", kind: "income", category: null, amount: 250000, day: 15, method: "bank" }, S)).toMatchObject({ pay: "bank", group: "salary" });
  });
});
