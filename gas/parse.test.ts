import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// GAS のコードをそのまま読み込んでテストする
const require = createRequire(import.meta.url);
const { parseMessage, categorize } = require("./Code.gs.cjs");

const FLASH = `テスト　様

いつも三井住友カードをご利用頂きありがとうございます。
お客様のカードご利用内容をお知らせいたします。'

ご利用カード：テストカード

◇利用日：2026/10/17 23:10
◇利用先：やきとり酒場テスト店／ＮＦＣ
◇利用取引：買物
◇利用金額：7,500円

ご利用内容について、万が一身に覚えのない場合は…`;

const STATEMENT = `ご利用カード：テストカード

◇利用日：2026/10/16
◇利用先：ファミリーマート／ｉＤ
◇利用取引：買物
◇利用金額：798円

◇利用日：2026/10/17
◇利用先：テスト電機／ｉＤ
◇利用取引：買物
◇利用金額：1,190円

※メール1通あたり30件のご利用内容をお知らせします。`;

const BILL = `次回のお支払い金額のお知らせです。

--------------------------------------------
支払日　10月26日
今月の『テストカード』のお支払い金額
123,456円
--------------------------------------------`;

const at = new Date("2026-10-12T06:01:08Z");

describe("GAS：メールを読む", () => {
  it("ご利用のお知らせ → 速報1件", () => {
    const r = parseMessage("ご利用のお知らせ【三井住友カード】", FLASH, at, "abc");
    expect(r.entries).toEqual([expect.objectContaining({ status: "flash", source: "card_flash", date: "2026-10-17", amount: 7500, shop: "やきとり酒場テスト店／ＮＦＣ", method: "card", source_ref: "abc#1" })]);
  });
  it("ご利用明細のお知らせ → 確定 n件", () => {
    const r = parseMessage("ご利用明細のお知らせ【三井住友カード】", STATEMENT, at, "def");
    expect(r.entries.map((e: { date: string; amount: number; source_ref: string; status: string }) => [e.date, e.amount, e.source_ref, e.status])).toEqual([
      ["2026-10-16", 798, "def#1", "confirmed"],
      ["2026-10-17", 1190, "def#2", "confirmed"],
    ]);
  });
  it("HTML版の書式も読む", () => {
    const r = parseMessage("ご利用のお知らせ【三井住友カード】", "ご利用内容 ご利用日時：2026/10/18 11:45 テスト美容室／ＮＦＣ（買物） 4400円 本メールは", at, "x");
    expect(r.entries[0]).toEqual(expect.objectContaining({ date: "2026-10-18", amount: 4400, shop: "テスト美容室／ＮＦＣ" }));
  });
  it("お支払い金額のお知らせ → カード請求額", () => {
    expect(parseMessage("お支払い金額のお知らせ", BILL, at, "b").bills).toEqual([{ pay_date: "2026-10-26", amount: 123456, source_ref: "bill:b" }]);
    expect(parseMessage("お支払い金額のお知らせ", BILL.replace("10月26日", "1月26日"), new Date("2026-12-12T00:00:00Z"), "b").bills[0].pay_date).toBe("2027-01-26");
  });
  it("関係ないメールは null、読めないメールは error", () => {
    expect(parseMessage("ネットショッピング認証コードのご案内", "…", at, "n")).toBeNull();
    expect(parseMessage("ご利用のお知らせ【三井住友カード】", "形が変わった本文", at, "e").error).toBeTruthy();
  });
  it("費目のルール", () => {
    const rules = [{ pattern: "酒場", category: "外食" }, { pattern: "ファミリーマート", category: "趣味・娯楽" }];
    expect(categorize("やきとり酒場テスト店／ＮＦＣ", rules)).toBe("外食");
    expect(categorize("ファミリーマート／ｉＤ", rules)).toBe("趣味・娯楽");
    expect(categorize("Mastercard加盟店", rules)).toBeNull();
  });
});
