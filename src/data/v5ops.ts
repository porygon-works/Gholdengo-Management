import { groupOfCat, type AccountEntry, type CardEntry, type Settings } from "../engine";

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
