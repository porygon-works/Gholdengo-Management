import { addMonths, ymOf } from "./dates";
import { budgetView } from "./budget5";
import { lowest } from "./outlook";
import { slackValue } from "./slack";
import type { AccountEntry, CardEntry, Data, PlanMove } from "./types";

// 変更を当てる前と後の比べ（設計書 §4.3・§3.5）。保存する前に、何が変わるかを出す。余裕額がマイナスになっても止めない

export type Change =
  | { kind: "addAccount"; entry: Omit<AccountEntry, "id"> }
  | { kind: "addCard"; entry: Omit<CardEntry, "id"> }
  | { kind: "decideBudget"; month: string; amount: number }
  | { kind: "addMove"; move: Omit<PlanMove, "id"> };

/** 変更を Data の写しに当てる（元の d は変えない） */
export function applyChange(d: Data, c: Change): Data {
  switch (c.kind) {
    case "addAccount": return { ...d, accounts: [...d.accounts, { ...c.entry, id: "whatif" }] };
    case "addCard": return { ...d, cards: [...d.cards, { ...c.entry, id: "whatif" }] };
    case "decideBudget": return { ...d, v5: { ...d.v5, months: [...d.v5.months.filter((m) => m.month !== c.month), { month: c.month, budget: c.amount, source: "decided" }] } };
    case "addMove": return { ...d, v5: { ...d.v5, moves: [...d.v5.moves, { ...c.move, id: "whatif" }] } };
  }
}

const monthOf = (c: Change, today: string) => (c.kind === "decideBudget" ? c.month : c.kind === "addMove" ? ymOf(today) : ymOf(c.entry.date));

export interface Comparison {
  slack: [number, number]; // 今日の余裕額の前と後
  budget: { month: string; before: number; after: number }; // その月の予算残額
  lowest: { date: string; bank: number }; // 後の、口座残高が一番少なくなる日（6か月先まで）
  shortBudget: number; // その月の予算残額のマイナスの分
  warn: boolean; // 後の余裕額がマイナス（注意だけ出す。確保額からは差し引かない）
}

export function compare(d: Data, c: Change, today: string): Comparison {
  const after = applyChange(d, c);
  const month = monthOf(c, today);
  const s0 = slackValue(d, today, today), s1 = slackValue(after, today, today);
  const b0 = budgetView(d, month, today).left.amount, b1 = budgetView(after, month, today).left.amount;
  return {
    slack: [s0, s1],
    budget: { month, before: b0, after: b1 },
    lowest: lowest(after, today, `${addMonths(ymOf(today), 6)}-01`),
    shortBudget: Math.max(0, -b1),
    warn: s1 < 0,
  };
}
