// 内訳（設計書 §4.1）。計算した数字は、例外なくこの形で式と中身の行をたどれるようにする

/** 内訳の中身の1行（明細・請求見込・借入の返済の見込みなど） */
export interface PartRow {
  date: string;
  name: string;
  amount: number;
  plan: boolean; // 予定・見込み
  ref: { kind: "card" | "account" | "virtual"; id: string };
}

/** 式の1つの項。parts があればその合計（sign をかけて足す）が amount */
export interface Part {
  key: string;
  label: string;
  amount: number;
  sign: 1 | -1;
  parts?: Part[];
  rows?: PartRow[];
}

/** Σ sign × amount */
export const total = (parts: Part[]) => parts.reduce((a, p) => a + p.sign * p.amount, 0);

/** 子の項から、その合計を amount に持つ項を作る */
export const sum = (key: string, label: string, parts: Part[], sign: 1 | -1 = 1): Part => ({ key, label, amount: total(parts), sign, parts });

/** 行の合計を amount に持つ項を作る */
export const ofRows = (key: string, label: string, rows: PartRow[], sign: 1 | -1 = 1): Part => ({ key, label, amount: rows.reduce((a, r) => a + r.amount, 0), sign, rows });

export const leaf = (key: string, label: string, amount: number, sign: 1 | -1 = 1): Part => ({ key, label, amount, sign });
