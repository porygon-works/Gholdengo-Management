// 計算エンジンで使う型。DBの列名と同じ名前にしている（supabase/migrations を参照）

export type Kind = "expense" | "income" | "transfer";
export type Status = "plan" | "flash" | "confirmed";
export type Method = "card" | "cash" | "paypay" | "ic" | "point" | "bank" | "revo";
export type Source = "manual" | "card_flash" | "card_statement" | "recurring" | "migration";

export interface Entry {
  id: string;
  kind: Kind;
  status: Status;
  date: string; // 使った日（予算に数える日） YYYY-MM-DD
  amount: number; // いつもプラス
  method: Method;
  category: string | null; // null は未分類
  shop: string;
  item: string;
  memo: string;
  tatekae: number;
  source: Source;
  source_ref: string | null;
  merged_into: string | null;
  recurring_id: string | null;
  not_dup: string[]; // 「別のもの」と決めた相手
  locked: boolean; // 本人が費目などを直した。吸収されても本人の値を残す
}

export interface Balance {
  id: string;
  date: string;
  bank: number;
  cash: number;
  paypay: number;
  memo: string;
}

export interface CardBill {
  id: string;
  pay_date: string;
  amount: number;
}

export interface Recurring {
  id: string;
  name: string;
  kind: "expense" | "income";
  category: string | null;
  amount: number;
  day: number; // 1〜31。月末より大きければ月末
  shift: "next" | "prev" | "none"; // 土日祝のずらし方
  method: Method;
  shop: string; // お店の名前のヒント。カードの明細のお店にこれが入っていれば、費目が違ってもこの予定とまとめる
  start_month: string | null; // YYYY-MM
  end_month: string | null;
  active: boolean;
}

export interface Budget {
  month: string; // YYYY-MM
  category: string;
  amount: number;
}

export interface Rule {
  id: string;
  pattern: string;
  category: string;
}

export interface Debt {
  id: string;
  name: string;
  balance: number;
  as_of: string | null;
  rate: string;
  min_payment: number;
  note: string;
  planned: boolean;
}

export interface Settings {
  safety: number; // 安全残高
  reserveGoal: number; // 目標残高（給料日前日）
  payday: number; // 給料日
  cardClosingDay: number; // 31 = 月末
  cardPayDay: number;
  salaryEstimate: number;
  varCats: string[]; // 変動費
  fixCats: string[]; // 固定費
  dailyCats: string[]; // 1日に使える額を出す費目
  savingMonthly: number; // 目標用マイナスの初期値に入れる、毎月の貯金
  savingStart: string | null; // 貯金を始める月（YYYY-MM）
  version: number; // データの形の版。古い版のデータは起動したときに直す（src/data/store.ts）
}

export const RESERVE = "予備";
export const REPAY = "返済";
export const OUTSIDE = "予算外";
/** 前の版の費目。版2で「家賃・奨学金・保険・共済」の費目に移す。移せなかったものは固定費の費目として残す */
export const FIXED_DEBIT = "固定引落";

/** 収入の扱い（収入の明細の category に入れる）。どちらでもなければ予算に入れない */
export const INCOME_SALARY = "給与";
export const INCOME_EXTRA = "追加予算";

/** その月の「予算の元」を本人が手で直したときに budgets に入れるキー。固定費は固定費の費目の予算の合計なので、ここでは直さない */
export const BASE_KEYS = { salary: "#給与", extra: "#追加予算", goal: "#目標用マイナス" } as const;
export type BaseKey = keyof typeof BASE_KEYS;
export type BaseField = BaseKey | "fixed";

export const DEFAULT_SETTINGS: Settings = {
  safety: 0,
  reserveGoal: 0,
  payday: 15,
  cardClosingDay: 31,
  cardPayDay: 26,
  salaryEstimate: 0,
  varCats: ["食料品", "交通", "外食", "日用品・通販", "趣味・娯楽", "美容", "医療", "衣服"],
  fixCats: ["家賃", "奨学金", "保険・共済", "通信", "水道ガス光熱費", "定期代", "サブスク"],
  dailyCats: ["食料品", "交通", "外食", "日用品・通販", "趣味・娯楽"],
  savingMonthly: 0,
  savingStart: null,
  version: 2,
};

/**
 * 予算を持つ費目。大項目は2つ：
 * - 変動費（予備を含む）：自由に使えるお金から使う
 * - 固定費：予算（見込み）の合計を、予算の元で給与から引く
 * 返済は目標用マイナスの中で払うので入れない
 */
export const budgetCats = (s: Settings) => [...s.varCats, RESERVE, ...s.fixCats];
export const isFixedCat = (s: Settings, c: string) => s.fixCats.includes(c);
/** 予算に入れない費目 */
export const nonBudgetCats = [OUTSIDE, REPAY];

export interface Data {
  entries: Entry[];
  balances: Balance[];
  cardBills: CardBill[];
  recurring: Recurring[];
  budgets: Budget[];
  rules: Rule[];
  debts: Debt[];
  settings: Settings;
}
