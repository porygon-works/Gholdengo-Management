// 計算エンジンで使う型。DBの列名と同じ名前にしている（supabase/migrations を参照）。仕様は docs/SPEC.md（v4）

export type Status = "plan" | "confirmed";

// ---------- 口座明細（§3.1） ----------

export type Account = "bank" | "wallet";
export type Direction = "in" | "out";
/** 大費目。出金：変動費・固定費・立替・クレカ支払い・その他／入金：給与・追加予算・立替の返金・賞与・その他 */
export type AccountGroup = "variable" | "fixed" | "tatekae" | "card" | "other" | "salary" | "extra" | "refund" | "bonus";
export const OUT_GROUPS: AccountGroup[] = ["variable", "fixed", "tatekae", "card", "other"];
export const IN_GROUPS: AccountGroup[] = ["salary", "extra", "refund", "bonus", "other"];
export type AccountSource = "manual" | "recurring" | "card_bill" | "goal" | "plan" | "migration";

export interface AccountEntry {
  id: string;
  account: Account;
  direction: Direction;
  status: Status;
  group: AccountGroup;
  category: string | null; // 費目（出金の変動費・固定費）
  name: string; // 名称
  memo: string;
  date: string; // 計上日 YYYY-MM-DD
  amount: number; // いつもプラス
  source: AccountSource;
  source_ref: string | null;
  recurring_id: string | null;
  goal_id: string | null;
  card: string | null; // 大費目がクレカ支払いのとき、どのカードの請求か
  pair_id: string | null; // ATM のように2行で1つの動きのときの相手
  locked: boolean; // 本人が直した。自動で作り直さない
  plan_id?: string | null; // 計画の取引（§3.4）
  debt_id?: string | null; // 返済の計画の支払いが、どの残高の分か
  plan_role?: PlanRole | null; // 支払い（毎月など）か、まとめて払う（使う）か
  budget_month?: string | null; // 計画の支払いで、予算を減らす月（YYYY-MM）。空なら計上日の月
  billTotal?: number; // クレカ支払いの行：カード会社の請求額（計画の支払いを引く前）
  at?: string; // 入れた時刻（残高を直した日と同じ日の明細を、直す前か後か分けるため）
}

// ---------- クレカ明細（§3.2） ----------

/** 大費目。変動費・固定費・立替・分割（返済）・分割（購入） */
export type CardGroup = "variable" | "fixed" | "tatekae" | "installment" | "purchase";
export const CARD_GROUPS: CardGroup[] = ["variable", "fixed", "tatekae", "installment", "purchase"];
export type CardSource = "manual" | "card_flash" | "card_statement" | "recurring" | "goal" | "migration";

export interface CardEntry {
  id: string;
  card: string; // settings.cards の id
  status: Status;
  date: string; // 利用日
  amount: number;
  group: CardGroup;
  category: string | null; // 費目。null は未分類
  name: string; // 名称（商品名など）
  shop: string; // 店
  memo: string;
  tatekae: number; // 一部だけ立て替えたときの立替の額
  source: CardSource;
  source_ref: string | null;
  merged_into: string | null; // 重複として吸収された先。吸収されたものは計算に入れない
  not_dup: string[]; // 「別のもの」と決めた相手
  locked: boolean; // 本人が費目などを直した。吸収されても本人の値を残す
  recurring_id: string | null;
  goal_id: string | null;
  at?: string;
}

// ---------- マスタ ----------

export interface Balance {
  id: string;
  date: string;
  bank: number; // 口座
  cash: number; // 財布
  paypay: number; // 使わない（前の版の名残）
  memo: string;
  at?: string; // 入れた時刻（同じ日に何度か直したときの順番）
}

/** 定期マスタ（§3.6）。毎月の口座明細かクレカ明細の予定を作る */
export interface Recurring {
  id: string;
  name: string;
  kind: "expense" | "income";
  group: AccountGroup | CardGroup; // 大費目
  category: string | null;
  amount: number;
  day: number; // 1〜31。月末より大きければ月末
  shift: "next" | "prev" | "none"; // 土日祝のずらし方
  pay: Account | "card"; // 口座・財布・クレカ
  card: string | null; // クレカのとき、どのカードか。null は1枚目
  shop: string; // お店の名前のヒント（クレカの明細とまとめるため）
  every: number; // 何か月ごとか（1 = 毎月、2 = 隔月、12 = 毎年）。start_month の月から数える
  start_month: string | null; // YYYY-MM
  end_month: string | null;
  active: boolean;
}

export interface Lump { date: string; amount: number; memo: string }

/** 前の版の目標マスタ。v4 で計画に写す（src/data/store.ts） */
export interface Goal {
  id: string;
  kind: "repay" | "save";
  name: string;
  card: string | null; // 返済するカード。null は口座から振込
  balance: number; // 返済：残高
  as_of: string | null; // 返済：残高の日
  target: number; // 積立：目標額
  monthly: number; // 毎月の額
  day: number; // 口座から払うときの日（カードのときは引落日）
  start_month: string | null; // 始める月（返済はこの月の支払いから）
  end_month: string | null; // 終わる月（空なら、返済は残高が0、積立は目標額に届くまで）
  lumps: Lump[]; // 臨時の返済・積立
  active: boolean;
  sort: number;
}

// ---------- 計画（§3.4） ----------

export type PlanKind = "repay" | "buy" | "save";
export type PlanRole = "pay" | "lump";
export const PLAN_KIND_LABEL: Record<PlanKind, string> = { repay: "返済", buy: "買い物", save: "貯蓄" };

/** 計画。返済はまとめて返す日に残りを返し、買い物は使う日に使う。貯蓄は使う日なし */
export interface Plan {
  id: string;
  kind: PlanKind;
  name: string;
  use_date: string | null;
  target: number; // 買い物の金額・貯蓄の目標額（返済は残高から出す）
  done: boolean;
  sort: number;
}

/** 返済の計画の残高（カードのサイトで見た額と、その日） */
export interface PlanDebt {
  id: string;
  plan_id: string;
  name: string;
  balance: number;
  as_of: string;
  sort: number;
}

export type FundSource = "budget" | "bonus" | "spare";
export const FUND_SOURCE_LABEL: Record<FundSource, string> = { budget: "予算から", bonus: "賞与から", spare: "予備から" };

/** 確保額に入れる分。口座のお金は動かない（口座に残しておく額として数える） */
export interface PlanFund {
  id: string;
  plan_id: string;
  source: FundSource;
  name: string;
  date: string; // 確保額に入る日
  budget_month: string | null; // 予算から入れるとき、予算を減らす月
  amount: number;
  status: Status;
}

/** 月ごとに決める予算。budget が null なら目安（§5.1）をそのまま使う */
export interface MonthSetting {
  month: string;
  budget: number | null;
  memo: string;
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

/** クレカ1枚の締め日と引落日 */
export interface CardDef {
  id: string;
  name: string;
  closingDay: number; // 31 = 月末
  payDay: number;
  payMonths: number; // 締めた月の何か月後に引き落とすか（翌月なら1）
}

export interface Settings {
  safety: number; // 安全残高
  payday: number; // 給料日
  cards: CardDef[]; // 1枚目がいつも使うカード（カードのメールから入る明細もこれ）
  salaryEstimate: number; // 給与の予定がない先の月の見込み
  varCats: string[]; // 変動費の費目
  fixCats: string[]; // 固定費の費目
  dailyCats: string[]; // 1日に使える額を出す費目
  version: number; // データの形の版（src/data/store.ts で古い版を直す）
  v2CopiedAt?: string; // 前の版の表（entries・card_bills）から、この時刻までに入った行を写した
  labels?: Record<string, string>; // 大費目の名前を変えたもの（キーは大費目の id）
  plansFrom?: string; // 前の版の目標マスタを計画に写した時刻（v4）
}

export const RESERVE = "予備";

export const DEFAULT_SETTINGS: Settings = {
  safety: 0,
  payday: 15,
  cards: [
    { id: "smbc", name: "三井", closingDay: 31, payDay: 26, payMonths: 1 },
    { id: "saison", name: "セゾン", closingDay: 31, payDay: 4, payMonths: 1 },
  ],
  salaryEstimate: 0,
  varCats: ["食料品", "交通", "外食", "日用品・通販", "趣味・娯楽", "美容", "医療", "衣服", "現金"],
  fixCats: ["家賃", "奨学金", "保険・共済", "通信", "水道ガス光熱費", "定期代", "サブスク"],
  dailyCats: ["食料品", "交通", "外食", "日用品・通販", "趣味・娯楽"],
  version: 6,
};

/** 予算を持つ費目。変動費（予備を含む）と固定費 */
export const budgetCats = (s: Settings) => [...s.varCats, RESERVE, ...s.fixCats];
export const isFixedCat = (s: Settings, c: string | null) => !!c && s.fixCats.includes(c);
/** 費目から決まる大費目（変動費か固定費か）。未分類は変動費（予備で数える） */
export const groupOfCat = (s: Settings, c: string | null): "variable" | "fixed" => (isFixedCat(s, c) ? "fixed" : "variable");

export const ACCOUNT_GROUP_LABEL: Record<AccountGroup, string> = {
  variable: "変動費", fixed: "固定費", tatekae: "立替", card: "クレカ支払い", other: "その他", salary: "給与", extra: "追加予算", refund: "立替の返金", bonus: "賞与",
};
export const CARD_GROUP_LABEL: Record<CardGroup, string> = {
  variable: "変動費", fixed: "固定費", tatekae: "立替", installment: "分割（返済）", purchase: "分割（購入）",
};

// ---------- v5（設計書 docs/superpowers/specs/2026-10-23-v5-yoyuugaku-design.md） ----------

/** 計画（返済・購入・貯蓄）。返済の計画は積立額を持たない */
export interface V5Plan {
  id: string;
  kind: PlanKind;
  name: string;
  target: number; // 目標額（購入・貯蓄）
  due_date: string | null; // 期日
  monthly: number; // 毎月の積立額（購入・貯蓄）
  start_month: string | null; // 毎月の積立額を始める月
  draw_order: number; // 取崩順
  no_draw: boolean; // 取崩不可
  done: boolean;
  sort: number;
}

/** 借入（返す先ごと）。card があれば毎月の返済はそのカードの引落日、なければ pay_day */
export interface Loan {
  id: string;
  plan_id: string | null;
  name: string;
  card: string | null;
  monthly: number;
  pay_day: number | null;
  sort: number;
}

/** 借入残高の記録（カードのサイトで見た額） */
export interface LoanBalance {
  id: string;
  loan_id: string;
  date: string;
  balance: number;
  at?: string;
}

/** 計画のお金の出し入れ。amount はいつもプラス（draw・spend は積立額を減らす） */
export interface PlanMove {
  id: string;
  plan_id: string;
  kind: "manual" | "bonus" | "draw" | "spend";
  amount: number;
  date: string;
  bonus_entry_id: string | null;
  entry_kind: "card" | "account" | null;
  entry_id: string | null;
  memo: string;
}

/** 月の予算（決めた額か、月の初めに保存した目安額） */
export interface V5Month {
  month: string;
  budget: number;
  source: "guide" | "decided";
}

export interface V5Data {
  plans: V5Plan[];
  loans: Loan[];
  balances: LoanBalance[];
  moves: PlanMove[];
  months: V5Month[];
}

export const emptyV5 = (): V5Data => ({ plans: [], loans: [], balances: [], moves: [], months: [] });

export interface Data {
  accounts: AccountEntry[];
  cards: CardEntry[];
  balances: Balance[];
  recurring: Recurring[];
  goals: Goal[];
  plans: Plan[];
  debts: PlanDebt[];
  funds: PlanFund[];
  months: MonthSetting[];
  budgets: Budget[];
  rules: Rule[];
  settings: Settings;
  /** 消した明細の source_ref（メールの取り込みや予定づくりで、また作らないため） */
  removedRefs?: string[];
  /** v5 の表（まだなければ全部空） */
  v5: V5Data;
}
