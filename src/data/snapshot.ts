import { accountFlow, addMonths, computeMonth, goalBalanceAt, goalOutlook, monthBase, nextPayments, PAY_GROUP_LABEL, ymOf } from "../engine";
import type { AppData } from "./store";

// Claude が読むための書き出し（format: gholdengo-snapshot-v1）。アプリが開くたびに Supabase の snapshots に保存し、
// GAS が1時間に1回 Google ドライブの Gholdengo/gholdengo-snapshot.json に置く。書き方は docs/OPS.md

/**
 * アプリが計算したまとめ（画面に出している数）。Claude がこれを読めば、自分で計算しなくてよい
 */
export function summary(d: AppData, today: string) {
  const ym = ymOf(today), next = addMonths(ym, 1);
  const v = computeMonth(d, ym, today);
  const f = accountFlow(d, today);
  const n = nextPayments(d, next);
  const nb = monthBase(d, next);
  return {
    today,
    thisMonth: {
      month: ym, budget: v.T, remaining: v.R, variableUsed: v.U, variablePlanned: v.P, fixedOver: v.fixedOver,
      base: { salary: v.base.salary, extra: v.base.extra, carry: v.base.carry, fixed: v.base.fixed, goalMinus: v.base.goal, goalMinusManual: v.base.goalManual, available: v.base.available, budgetDecided: v.base.budgetManual },
      carry: v.base.carryInfo,
      categories: v.cats.filter((c) => c.budget || c.used || c.planned).map((c) => ({ category: c.cat, fixed: c.fixed, budget: c.budget, used: c.used, planned: c.planned, remaining: c.rem })),
    },
    account: f && {
      bankNow: f.now.bank, walletNow: f.now.wallet, lastBalanceReport: f.now.base.date, nextPayday: f.end, leftBeforePayday: f.last, short: f.short,
      flow: f.rows.map((r) => ({ date: r.date, name: r.entry.name || r.entry.category, amount: r.delta, balanceAfter: r.balance, status: r.entry.status, group: r.entry.group })),
    },
    nextMonthPayments: { month: next, total: n.total, groups: n.groups.map((g) => ({ group: PAY_GROUP_LABEL[g.group], amount: g.amount, items: g.items.map((x) => ({ date: x.date, name: x.name, from: x.from, amount: x.amount, plan: x.plan })) })) },
    nextMonthBudget: { month: next, budget: nb.T, base: { salary: nb.salary, extra: nb.extra, carry: nb.carry, fixed: nb.fixed, goalMinus: nb.goal, available: nb.available, budgetDecided: nb.budgetManual } },
    goals: goalOutlook(d, ym, 36).map((o) => ({
      name: o.goal.name, kind: o.goal.kind, balanceNow: goalBalanceAt(o.goal, d.settings, today), monthly: o.goal.monthly, doneMonth: o.doneYm,
      schedule: o.months.filter((m) => m.pay || m.lump).slice(0, 12).map((m) => ({ month: m.ym, pay: m.pay, lump: m.lump, left: m.left })),
    })),
  };
}

/** Claude に渡す用に、今のデータを書き出す（まとめ ＋ ops の key に使う名前・id が分かる元のデータ） */
export function snapshot(d: AppData, today: string) {
  const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}`;
  return {
    format: "gholdengo-snapshot-v1",
    exportedAt: new Date().toISOString(),
    howToChange: "変えたいときは docs/OPS.md の gholdengo-ops-v1 で書いて、アプリの「設定 → データ → Claude との相談を取り込む」で読み込む",
    summary: summary(d, today),
    settings: d.settings,
    budgets: d.budgets,
    goals: d.goals,
    recurring: d.recurring,
    rules: d.rules,
    balances: d.balances,
    account_entries: d.accounts.filter((e) => e.date >= from).map(({ at: _a, ...e }) => e),
    card_entries: d.cards.filter((e) => e.date >= from && !e.merged_into).map(({ at: _a, ...e }) => e),
  };
}
