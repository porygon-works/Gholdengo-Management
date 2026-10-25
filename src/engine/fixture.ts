// テスト用のデータを作る関数（値はすべて作り物）。テストだけが使う
import { DEFAULT_SETTINGS, emptyV5, type AccountEntry, type CardEntry, type Data, type Settings, type V5Data } from "./types";

export const S: Settings = { ...DEFAULT_SETTINGS, salaryEstimate: 0 };

let n = 0;
export const acc = (p: Partial<AccountEntry>): AccountEntry => ({
  id: p.id ?? `a${++n}`, account: "bank", direction: "out", status: "confirmed", group: "variable", category: null, name: "", memo: "", date: "2026-11-01", amount: 0,
  source: "manual", source_ref: null, recurring_id: null, goal_id: null, card: null, pair_id: null, locked: true, ...p,
});
export const card = (p: Partial<CardEntry>): CardEntry => ({
  id: p.id ?? `c${++n}`, card: "smbc", status: "confirmed", date: "2026-11-01", amount: 0, group: "variable", category: "食料品", name: "", shop: "", memo: "", tatekae: 0,
  source: "manual", source_ref: null, merged_into: null, not_dup: [], locked: true, recurring_id: null, goal_id: null, ...p,
});
export const bal = (date: string, bank: number) => ({ id: `b${++n}`, date, bank, cash: 0, paypay: 0, memo: "" });

export const D = (p: Partial<Omit<Data, "v5">> & { v5?: Partial<V5Data> } = {}): Data => ({
  accounts: [], cards: [], balances: [], recurring: [], goals: [], plans: [], debts: [], funds: [], months: [], budgets: [], rules: [], settings: S,
  ...p, v5: { ...emptyV5(), ...(p.v5 ?? {}) },
});

/**
 * 設計書 §2.4 の例：給与 25万（11/16・12/15）・家賃 8万（セゾン、翌月4日払い）・予算 17万（三井、翌月26日払い）・賞与 30万（12/10）。
 * 10/31 の口座 30万。10月の三井 17万と10月の家賃 8万はまだ引き落とされていない
 */
export const example = (): Data => D({
  balances: [bal("2026-10-31", 300000)],
  budgets: [{ month: "2026-10", category: "家賃", amount: 80000 }],
  cards: [
    card({ id: "oct-use", card: "smbc", date: "2026-10-15", amount: 170000, category: "食料品" }),
    card({ id: "oct-rent", card: "saison", date: "2026-10-01", amount: 80000, group: "fixed", category: "家賃" }),
    card({ id: "nov-rent", card: "saison", date: "2026-11-01", amount: 80000, group: "fixed", category: "家賃" }),
    card({ id: "dec-rent", card: "saison", date: "2026-12-01", amount: 80000, group: "fixed", category: "家賃", status: "plan" }),
  ],
  accounts: [
    acc({ id: "nov-pay", direction: "in", group: "salary", name: "給与", date: "2026-11-16", amount: 250000, status: "plan" }),
    acc({ id: "dec-pay", direction: "in", group: "salary", name: "給与", date: "2026-12-15", amount: 250000, status: "plan" }),
    acc({ id: "bonus", direction: "in", group: "bonus", name: "賞与", date: "2026-12-10", amount: 300000, status: "plan" }),
  ],
});
