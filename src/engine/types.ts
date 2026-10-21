// 計算エンジンで使う型。DBの列名と同じ名前にしている（supabase/migrations を参照）。仕様は docs/SPEC.md（v3）

export type Status = "plan" | "confirmed";

// ---------- 口座明細（§3.1） ----------

export type Account = "bank" | "wallet";
export type Direction = "in" | "out";
/** 大費目。出金：変動費・固定費・立替・クレカ支払い・その他／入金：給与・追加予算・立替の返金・その他 */
export type AccountGroup = "variable" | "fixed" | "tatekae" | "card" | "other" | "salary" | "extra" | "refund";
export const OUT_GROUPS: AccountGroup[] = ["variable", "fixed", "tatekae", "card", "other"];
export const IN_GROUPS: AccountGroup[] = ["salary", "extra", "refund", "other"];
export type AccountSource = "manual" | "recurring" | "card_bill" | "goal" | "migration";

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

/** 臨時の返済・積立。carry は、前月からの繰越が上限をこえた分を積立に回したもの（§5.8。目標用マイナスに入れない） */
export interface Lump { date: string; amount: number; memo: string; carry?: boolean }

/** 目標マスタ（§3.4） */
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
  carryFrom: string | null; // 前月からの繰越を予算に入れはじめる月（YYYY-MM）。null なら入れない（§5.8）
  carryCap: number; // 繰越を予算に入れる上限。こえた分は carryGoal の積立に回す
  carryGoal: string | null; // 上限をこえた繰越を回す積立の目標の id。null なら上限なしで全部予算に入れる
}

export const RESERVE = "予備";
/** 予算マスタで、その月の目標用マイナスを手で直した値を入れる費目 */
export const GOAL_KEY = "#目標用マイナス";
/** 予算マスタで、その月の前月からの繰越を手で直した値を入れる費目 */
export const CARRY_KEY = "#繰越";

export const DEFAULT_SETTINGS: Settings = {
  safety: 0,
  payday: 15,
  cards: [
    { id: "smbc", name: "三井", closingDay: 31, payDay: 26, payMonths: 1 },
    { id: "saison", name: "セゾン", closingDay: 31, payDay: 4, payMonths: 1 },
  ],
  salaryEstimate: 0,
  varCats: ["食料品", "交通", "外食", "日用品・通販", "趣味・娯楽", "美容", "医療", "衣服"],
  fixCats: ["家賃", "奨学金", "保険・共済", "通信", "水道ガス光熱費", "定期代", "サブスク"],
  dailyCats: ["食料品", "交通", "外食", "日用品・通販", "趣味・娯楽"],
  version: 7,
  carryFrom: null,
  carryCap: 20000,
  carryGoal: null,
};

/** 予算を持つ費目。変動費（予備を含む）と固定費 */
export const budgetCats = (s: Settings) => [...s.varCats, RESERVE, ...s.fixCats];
export const isFixedCat = (s: Settings, c: string | null) => !!c && s.fixCats.includes(c);
/** 費目から決まる大費目（変動費か固定費か）。未分類は変動費（予備で数える） */
export const groupOfCat = (s: Settings, c: string | null): "variable" | "fixed" => (isFixedCat(s, c) ? "fixed" : "variable");

export const ACCOUNT_GROUP_LABEL: Record<AccountGroup, string> = {
  variable: "変動費", fixed: "固定費", tatekae: "立替", card: "クレカ支払い", other: "その他", salary: "給与", extra: "追加予算", refund: "立替の返金",
};
export const CARD_GROUP_LABEL: Record<CardGroup, string> = {
  variable: "変動費", fixed: "固定費", tatekae: "立替", installment: "分割（返済）", purchase: "分割（購入）",
};

export interface Data {
  accounts: AccountEntry[];
  cards: CardEntry[];
  balances: Balance[];
  recurring: Recurring[];
  goals: Goal[];
  budgets: Budget[];
  rules: Rule[];
  settings: Settings;
  /** 消した明細の source_ref（メールの取り込みや予定づくりで、また作らないため） */
  removedRefs?: string[];
}
