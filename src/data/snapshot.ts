import { accountFlow, addMonths, computeMonth, forecast, monthBase, nextPayments, PAY_GROUP_LABEL, PLAN_KIND_LABEL, planDebts, planEntries, planFunds, planStatus, reserveAt, debtLeft, ymOf } from "../engine";
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
  const fc = forecast(d, today);
  return {
    today,
    thisMonth: {
      month: ym, budget: v.T, remaining: v.R, variableUsed: v.U, variablePlanned: v.P, fixedOver: v.fixedOver,
      base: { salary: v.base.salary, extra: v.base.extra, fixed: v.base.fixed, planMinus: v.base.plan, guide: v.base.auto, decided: v.base.manual },
      categories: v.cats.filter((c) => c.budget || c.used || c.planned).map((c) => ({ category: c.cat, fixed: c.fixed, budget: c.budget, used: c.used, planned: c.planned, remaining: c.rem })),
    },
    account: f && {
      bankNow: f.now.bank, walletNow: f.now.wallet, lastBalanceReport: f.now.base.date, nextPayday: f.end, leftBeforePayday: f.last, short: f.short,
      flow: f.rows.map((r) => ({ date: r.date, name: r.entry.name || r.entry.category, amount: r.delta, balanceAfter: r.balance, status: r.entry.status, group: r.entry.group })),
    },
    nextMonthPayments: { month: next, total: n.total, groups: n.groups.map((g) => ({ group: PAY_GROUP_LABEL[g.group], amount: g.amount, items: g.items.map((x) => ({ date: x.date, name: x.name, from: x.from, amount: x.amount, plan: x.plan })) })) },
    nextMonthBudget: { month: next, budget: nb.T, base: { salary: nb.salary, extra: nb.extra, fixed: nb.fixed, planMinus: nb.plan, guide: nb.auto, decided: nb.manual } },
    // 確保額 ＝ 給料日の前日の口座残高（見込み）。計画ごとに入れた分と、予備
    reserves: fc ? fc.eves.map((e) => reserveAt(d, fc, e)).filter(Boolean) : [],
    plans: d.plans.map((p) => {
      const st = planStatus(d, p, fc);
      return {
        id: p.id, name: p.name, kind: PLAN_KIND_LABEL[p.kind], useDate: p.use_date, need: st.need, collected: st.got, short: st.short, ok: st.ok, done: p.done,
        debts: planDebts(d, p).map((x) => ({ name: x.name, balance: x.balance, asOf: x.as_of, left: debtLeft(d, p, x) })),
        entries: planEntries(d, p).map((e) => ({ date: e.date, name: e.name, amount: e.amount, status: e.status, role: e.plan_role, card: e.card })),
        funds: planFunds(d, p).map((f) => ({ date: f.date, source: f.source, name: f.name, amount: f.amount, status: f.status })),
      };
    }),
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
    months: d.months,
    plans: d.plans,
    plan_debts: d.debts,
    plan_funds: d.funds,
    recurring: d.recurring,
    rules: d.rules,
    balances: d.balances,
    account_entries: d.accounts.filter((e) => e.date >= from).map(({ at: _a, ...e }) => e),
    card_entries: d.cards.filter((e) => e.date >= from && !e.merged_into).map(({ at: _a, ...e }) => e),
  };
}
