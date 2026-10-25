import { addMonths, budgetView, lastDay, loanAt, loanCorrections, outlook, PLAN_KIND_LABEL, plannedBonus, repayView, savedAt, slackAt, ymOf, type Part } from "../engine";
import type { AppData } from "./store";
import { OPS_FORMAT } from "./ops";

// Claude が読むための書き出し（format: gholdengo-snapshot-v2）。アプリが開くたびに Supabase の snapshots に保存し、
// GAS が1時間に1回 Google ドライブの Gholdengo/gholdengo-snapshot.json に置く。書き方は docs/OPS.md

export const SNAPSHOT_FORMAT = "gholdengo-snapshot-v2";

/** 内訳（アプリでタップすると出る式と同じもの）。行は多くなりすぎないよう先頭だけ */
const tree = (p: Part): unknown => ({
  name: p.label, amount: p.amount, sign: p.sign < 0 ? "−" : "＋",
  ...(p.parts?.length ? { parts: p.parts.map(tree) } : {}),
  ...(p.rows?.length ? { rows: p.rows.slice(0, 30).map((r) => ({ date: r.date, name: r.name, amount: r.amount, plan: r.plan })), ...(p.rows.length > 30 ? { moreRows: p.rows.length - 30 } : {}) } : {}),
});

/**
 * アプリが計算したまとめ（画面に出している数と、その内訳）。Claude がこれを読めば、自分で計算しなくてよい
 */
export function summary(d: AppData, today: string) {
  const ym = ymOf(today), next = addMonths(ym, 1);
  const month = (m: string) => {
    const v = budgetView(d, m, today);
    return {
      month: m, budget: v.budget, budgetSource: v.source, guide: tree(v.guide), budgetLeft: tree(v.left),
      categories: v.cats.filter((c) => c.budget || c.used || c.planned).map((c) => ({ category: c.cat, fixed: c.fixed, budget: c.budget, used: c.used, planned: c.planned, left: c.left })),
    };
  };
  const endYm = addMonths(ym, 6);
  const days = d.balances.length ? outlook(d, today, today, `${endYm}-${String(lastDay(endYm)).padStart(2, "0")}`) : [];
  return {
    today,
    slack: tree(slackAt(d, today, today)),
    thisMonth: month(ym),
    nextMonth: month(next),
    loans: d.v5.loans.map((l) => ({ name: l.name, balance: tree(loanAt(d, l, today)), monthly: l.monthly, card: l.card, corrections: loanCorrections(d, l) })),
    plans: d.v5.plans.map((p) => {
      const base = { name: p.name, kind: PLAN_KIND_LABEL[p.kind], target: p.target, dueDate: p.due_date, monthly: p.monthly, drawOrder: p.draw_order, noDraw: p.no_draw, done: p.done };
      if (p.kind === "repay") {
        const r = repayView(d, p, today);
        return { ...base, repay: r && { due: tree(r.due), bankThen: r.bankThen.amount, ok: r.ok, lowAfter: { date: r.lowAfter.label, amount: r.lowAfter.amount } } };
      }
      return { ...base, saved: tree(savedAt(d, p, today)), plannedBonus: plannedBonus(d, p) };
    }),
    // 見通し：日ごとの口座残高と余裕額（先は見込み。予算どおりに使う前提）。週に1回と月末だけ
    outlook: days.filter((x, i) => i % 7 === 0 || x.date.slice(8) === String(lastDay(ymOf(x.date)))),
  };
}

/** Claude に渡す用に、今のデータを書き出す（まとめ ＋ ops の key に使う名前・id が分かる元のデータ） */
export function snapshot(d: AppData, today: string) {
  const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}`;
  return {
    format: SNAPSHOT_FORMAT,
    exportedAt: new Date().toISOString(),
    howToChange: `変えたいときは docs/OPS.md の ${OPS_FORMAT} で書いて、アプリの「設定 → データ → Claude との相談を取り込む」で読み込む`,
    summary: summary(d, today),
    settings: d.settings,
    budgets: d.budgets,
    v5_months: d.v5.months,
    v5_plans: d.v5.plans,
    v5_loans: d.v5.loans,
    v5_loan_balances: d.v5.balances,
    v5_moves: d.v5.moves,
    recurring: d.recurring,
    rules: d.rules,
    balances: d.balances,
    account_entries: d.accounts.filter((e) => e.date >= from && e.account === "bank").map(({ at: _a, ...e }) => e),
    card_entries: d.cards.filter((e) => e.date >= from && !e.merged_into).map(({ at: _a, ...e }) => e),
  };
}
