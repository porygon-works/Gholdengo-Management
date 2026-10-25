import { ACCOUNT_GROUP_LABEL, groupOfCat, type AccountEntry, type AccountGroup, type CardEntry, type Change, type Settings, type Status } from "../engine";

// v5 の明細の操作で、保存する中身を決める部分（設計書 §3.4・§3.6）。保存は store.ts の actions5

/** リボに回す（大費目を分割（購入）に）・戻す（費目から変動費か固定費に） */
export function revolvingPatch(s: Settings, e: CardEntry, on: boolean): Pick<CardEntry, "group"> {
  return { group: on ? "purchase" : groupOfCat(s, e.category) };
}

/** 口座明細の1行を、費目ごとの行に分ける。最初の行は元の行を直し、残りは新しい行にする。合計は元の額と同じでなければならない */
export function splitRows(s: Settings, e: AccountEntry, parts: { category: string; amount: number }[]) {
  if (!parts.length || parts.reduce((a, p) => a + p.amount, 0) !== e.amount) throw new Error(`分けた額の合計を ${e.amount.toLocaleString("ja-JP")}円 にしてください`);
  const [first, ...rest] = parts;
  return {
    update: { id: e.id, patch: { category: first.category, amount: first.amount, group: groupOfCat(s, first.category) } },
    inserts: rest.map((p) => ({ account: e.account, direction: e.direction, status: e.status, group: groupOfCat(s, p.category), category: p.category, name: e.name, memo: e.memo, date: e.date, amount: p.amount })),
  };
}

/** ATM で引き出した額を、その日に使ったもの（口座の出金・費目「現金」）にする。財布は持たない */
export const atmRow = (date: string, amount: number) => ({
  account: "bank" as const, direction: "out" as const, status: "confirmed" as const, group: "variable" as const, category: "現金", name: "ATMで引き出し", memo: "", date, amount,
});

/**
 * v4 から引き継ぐ（設計書 §7.3）：v4 の計画の予定の行と、前の版から移したときの調整の行（給与の調整・追加予算の調整）は消す。
 * v4 の計画の確定した行は、普通の明細として残し、計画とのつながりだけ外す
 */
export function handover(rows: AccountEntry[]): { remove: AccountEntry[]; unlink: AccountEntry[] } {
  return {
    remove: rows.filter((e) => (e.plan_id && e.status === "plan") || e.source_ref?.startsWith("v2base:")),
    unlink: rows.filter((e) => e.plan_id && e.status !== "plan" && !e.source_ref?.startsWith("v2base:")),
  };
}

export const handoverPatch = { plan_id: null, plan_role: null, budget_month: null } as const;

// ---------- 入力の画面（設計書 §4.4） ----------

/** 予定か確定かの最初の値：日付が今日か前なら確定、先なら予定（本人が切り替えられる） */
export const defaultStatus = (date: string, today: string): Status => (date > today ? "plan" : "confirmed");

const accountBase = { account: "bank" as const, memo: "", source: "manual" as const, source_ref: null, recurring_id: null, goal_id: null, card: null, pair_id: null, locked: true };

/** 出金の入力：払い方（`card:ID`・`paypay`・`bank`・`atm`）から保存先を決める。現金は ATM で引き出した額（費目「現金」） */
export function spendChange(s: Settings, x: { pay: string; cat: string; amount: number; date: string; name: string; status: Status; tatekae: number; memo: string }): Change {
  const group = groupOfCat(s, x.cat);
  if (x.pay.startsWith("card:")) {
    const all = x.tatekae > 0 && x.tatekae >= x.amount;
    return { kind: "addCard", entry: { card: x.pay.slice(5), status: x.status, date: x.date, amount: x.amount, group: all ? "tatekae" : group, category: all ? null : x.cat, name: x.name, shop: "", memo: x.memo, tatekae: all ? 0 : x.tatekae, source: "manual", source_ref: null, merged_into: null, not_dup: [], locked: x.status !== "plan", recurring_id: null, goal_id: null } };
  }
  if (x.pay === "atm") return { kind: "addAccount", entry: { ...accountBase, ...atmRow(x.date, x.amount), status: x.status, memo: x.memo } };
  return { kind: "addAccount", entry: { ...accountBase, direction: "out", status: x.status, group, category: x.cat, name: x.name || (x.pay === "paypay" ? "PayPayチャージ" : ""), memo: x.memo, date: x.date, amount: x.amount } };
}

/** 入金の入力：給与・賞与・立替の返金・その他は区分が違うだけで、同じ口座明細の入金 */
export function incomeChange(x: { group: AccountGroup; amount: number; date: string; name: string; status: Status }): Change {
  return { kind: "addAccount", entry: { ...accountBase, direction: "in", status: x.status, group: x.group, category: null, name: x.name || ACCOUNT_GROUP_LABEL[x.group], date: x.date, amount: x.amount } };
}
