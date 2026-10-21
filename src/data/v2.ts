import { cardOf, closingEnd, closingFor, groupOfCat, type AccountEntry, type AccountGroup, type CardEntry, type CardGroup, type Goal, type Recurring, type Settings } from "../engine";
import type { Row } from "./backend";

// 前の版（v2）の表を、v3 の表の形に変える（docs/SPEC.md §3.8）

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null || v === "" ? 0 : Math.round(Number(v)) || 0);
const day = (v: unknown) => str(v).slice(0, 10);

const REPAY = "返済", OUTSIDE = "予算外", FIXED_DEBIT = "固定引落";
/** v1 の「固定引落」を、名前から家賃・奨学金・保険・共済に分ける */
const fixedDebit = (name: string) => (/家賃/.test(name) ? "家賃" : /奨学金/.test(name) ? "奨学金" : /共済|保険/.test(name) ? "保険・共済" : FIXED_DEBIT);

/**
 * v2 の返済は「その日に請求される額」（使った日＝引落日）だった。v3 のクレカ明細は利用日で請求に入るので、
 * その引落日の請求に入る締め期間の最後の日にする
 */
const repayDate = (payDate: string, s: Settings, card: string) => closingEnd(closingFor(payDate.slice(0, 7), s, card), s, card);

/** v2 の entries の1行を、口座明細かクレカ明細にする。ATM は口座明細2行。ポイント払いは捨てる */
export function convertEntry(r: Row, s: Settings): { accounts: Omit<AccountEntry, "id">[]; cards: Omit<CardEntry, "id">[] } {
  const out = { accounts: [] as Omit<AccountEntry, "id">[], cards: [] as Omit<CardEntry, "id">[] };
  const kind = str(r.kind), method = str(r.method);
  let category = (r.category as string) || null;
  if (category === FIXED_DEBIT) category = fixedDebit(str(r.item) || str(r.shop));
  const name = str(r.item) || str(r.shop);
  const status = r.status === "plan" ? "plan" : "confirmed";
  const ref = (r.source_ref as string) || `v2:${str(r.id)}`;
  const date = day(r.date), amount = num(r.amount);
  const base = { status, date, amount, memo: str(r.memo), recurring_id: (r.recurring_id as string) || null, goal_id: null, locked: !!r.locked } as const;
  const accSource = (r.source === "recurring" ? "recurring" : "migration") as AccountEntry["source"];
  const acc = (p: Partial<AccountEntry> & Pick<AccountEntry, "account" | "direction" | "group">): Omit<AccountEntry, "id"> => ({
    ...base, category: null, name, source: accSource, source_ref: ref, card: null, pair_id: null, ...p,
  });

  if (kind === "transfer") {
    out.accounts.push(acc({ account: "bank", direction: "out", group: "other", name: name || "ATMで引き出し" }));
    out.accounts.push(acc({ account: "wallet", direction: "in", group: "other", name: name || "ATMで引き出し", source_ref: `${ref}:wallet` }));
    return out;
  }
  if (kind === "income") {
    const group: AccountGroup = category === "給与" || (!category && r.recurring_id) ? "salary" : category === "追加予算" ? "extra" : /立替の返金/.test(name) ? "refund" : "other";
    out.accounts.push(acc({ account: method === "cash" ? "wallet" : "bank", direction: "in", group, name: name || "入金" }));
    return out;
  }
  if (method === "point") return out;
  if (method === "card" || method === "revo") {
    const group: CardGroup = method === "revo" ? "purchase" : category === REPAY ? "installment" : category === OUTSIDE ? "tatekae" : groupOfCat(s, category);
    const card = cardOf(s, r.card as string | null).id;
    out.cards.push({
      ...base, card, group, date: group === "installment" ? repayDate(date, s, card) : date, category: group === "variable" || group === "fixed" ? category : null, name: str(r.item), shop: str(r.shop),
      memo: category === OUTSIDE ? [str(r.memo), "予算外"].filter(Boolean).join("・") : str(r.memo), tatekae: num(r.tatekae),
      source: (["card_flash", "card_statement", "recurring"].includes(str(r.source)) ? r.source : "migration") as CardEntry["source"],
      source_ref: ref, merged_into: null, not_dup: [],
    });
    return out;
  }
  // 名前に「セゾン」とある口座払いの返済は、セゾンの請求と一緒に出る（v2 の版3の決め方）
  if (category === REPAY && /セゾン/.test(name) && s.cards.some((c) => c.id === "saison")) {
    out.cards.push({ ...base, card: "saison", date: repayDate(date, s, "saison"), group: "installment", category: null, name, shop: "", tatekae: 0, source: accSource === "recurring" ? "recurring" : "migration", source_ref: ref, merged_into: null, not_dup: [] });
    return out;
  }
  const group: AccountGroup = category === REPAY || category === OUTSIDE ? "other" : groupOfCat(s, category);
  out.accounts.push(acc({ account: method === "cash" || method === "ic" ? "wallet" : "bank", direction: "out", group, category: group === "other" ? null : category, name: name || category || "出金" }));
  return out;
}

/** v2 の card_bills の1行を、口座明細のクレカ支払い（確定）にする */
export function convertBill(r: Row, s: Settings): Omit<AccountEntry, "id"> {
  const c = cardOf(s, r.card as string | null);
  const date = day(r.pay_date);
  const k = +date.slice(5, 7) - c.payMonths;
  const closing = k >= 1 ? k : k + 12;
  return {
    account: "bank", direction: "out", status: "confirmed", group: "card", category: null, name: `${c.name} ${closing}月分`, memo: "", date, amount: num(r.amount),
    source: "card_bill", source_ref: `bill:${c.id}:${date}`, recurring_id: null, goal_id: null, card: c.id, pair_id: null, locked: true,
  };
}

/** v2 の debts の1行を、返済の目標にする */
export function convertDebt(r: Row, s: Settings): Omit<Goal, "id"> & { source_ref: string } {
  const name = str(r.name);
  const card = /セゾン/.test(name) && s.cards.some((c) => c.id === "saison") ? "saison" : /三井|SMBC/i.test(name) ? s.cards[0].id : null;
  return {
    kind: "repay", name, card, balance: num(r.balance), as_of: r.as_of ? day(r.as_of) : null, target: 0, monthly: num(r.min_payment), day: 27,
    start_month: null, end_month: null, lumps: [], active: num(r.balance) > 0, sort: num(r.sort), source_ref: `v2debt:${str(r.id) || name}`,
  };
}

/** 定期マスタの v2 の行（大費目がない）から、大費目と払い方を決める */
export function recurringFromRow(r: Row, s: Settings): Recurring {
  const kind = (r.kind as Recurring["kind"]) || "expense";
  let category = (r.category as string) || null;
  if (category === FIXED_DEBIT) category = fixedDebit(str(r.name));
  const method = str(r.method);
  const group = (r.group as Recurring["group"]) || (kind === "income"
    ? (category === "追加予算" ? "extra" : category && category !== "給与" ? "other" : "salary")
    : category === REPAY ? (method === "card" ? "installment" : "other") : category === OUTSIDE ? "other" : groupOfCat(s, category));
  const pay = r.group ? ((r.pay as Recurring["pay"]) || "bank") : method === "card" || method === "revo" ? "card" : method === "cash" || method === "ic" ? "wallet" : "bank";
  return {
    id: str(r.id), name: str(r.name), kind, group, category: kind === "income" || group === "installment" || group === "other" ? null : category, amount: num(r.amount),
    day: num(r.day) || 1, shift: (r.shift as Recurring["shift"]) || "next", pay, card: (r.card as string) || null, shop: str(r.shop),
    start_month: (r.start_month as string) || null, end_month: (r.end_month as string) || null, active: r.active !== false,
  };
}
