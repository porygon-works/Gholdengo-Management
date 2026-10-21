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
}

export const RESERVE = "予備";
export const REPAY = "返済";
export const OUTSIDE = "予算外";
export const FIXED_DEBIT = "固定引落"; // 家賃・ローン・保険など。予算に入れない出金

export const DEFAULT_SETTINGS: Settings = {
  safety: 0,
  reserveGoal: 0,
  payday: 15,
  cardClosingDay: 31,
  cardPayDay: 26,
  salaryEstimate: 0,
  varCats: ["食料品", "交通", "外食", "日用品・通販", "趣味・娯楽", "美容", "医療", "衣服"],
  fixCats: ["通信", "水道ガス光熱費", "定期代", "サブスク"],
  dailyCats: ["食料品", "交通", "外食", "日用品・通販", "趣味・娯楽"],
};

/** 予算を持つ費目（予備は最後） */
export const budgetCats = (s: Settings) => [...s.varCats, ...s.fixCats, REPAY, RESERVE];
/** 予算に入れない費目 */
export const nonBudgetCats = [OUTSIDE, FIXED_DEBIT];

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
