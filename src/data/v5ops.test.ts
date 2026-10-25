import { describe, expect, it } from "vitest";
import { acc, card, S } from "../engine/fixture";
import { atmRow, handover, handoverPatch, revolvingPatch, splitRows } from "./v5ops";

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
