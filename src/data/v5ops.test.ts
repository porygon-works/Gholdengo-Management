import { describe, expect, it } from "vitest";
import { acc, card, S } from "../engine/fixture";
import { atmRow, revolvingPatch, splitRows } from "./v5ops";

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
