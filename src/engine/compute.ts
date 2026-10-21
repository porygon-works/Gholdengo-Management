import { addMonths, dayOf, lastDay, shiftBusiness, ymOf } from "./dates";
import { isLive } from "./merge";
import { cardOf, cardPayDate, closingFor, closingMonth, ownCost } from "./schedule";
import {
  budgetCats, GOAL_KEY, isFixedCat, RESERVE,
  type AccountEntry, type Balance, type CardDef, type CardEntry, type Data, type Goal, type Settings,
} from "./types";

// 計算式（仕様書 §5）。画面はここの関数だけを使い、自分では計算しない

// ---------- 残高 ----------

/** いちばん新しい残高の記録（同じ日なら、あとから入れたもの） */
export function latestBalance(balances: Balance[]): Balance | null {
  let best: Balance | null = null;
  for (const b of balances) if (!best || b.date > best.date || (b.date === best.date && (b.at ?? "") >= (best.at ?? ""))) best = b;
  return best;
}

/** 残高の記録 base のあとに起きたことか。同じ日なら、記録のあとに入れたもの */
const afterBase = (e: { date: string; at?: string }, base: Balance) => e.date > base.date || (e.date === base.date && !!e.at && !!base.at && e.at > base.at);

const signedAmount = (e: AccountEntry) => (e.direction === "in" ? e.amount : -e.amount);

/**
 * いまの口座と財布（§5.4）。最後に入れた（直した）残高に、そのあと今日までの確定した口座明細を足し引きする。
 * rows は、そのあとの口座の動き（履歴）
 */
export function accountNow(d: Data, today: string) {
  const base = latestBalance(d.balances);
  if (!base) return null;
  const done = d.accounts.filter((e) => e.status === "confirmed" && e.date <= today && afterBase(e, base)).sort(byDate);
  let bank = base.bank || 0;
  const rows: FlowRow[] = [];
  for (const e of done.filter((e) => e.account === "bank")) { bank += signedAmount(e); rows.push({ date: e.date, entry: e, delta: signedAmount(e), balance: bank }); }
  const wallet = done.filter((e) => e.account === "wallet").reduce((a, e) => a + signedAmount(e), base.cash || 0);
  return { base, bank, wallet, rows };
}

/** 日付の順。同じ日は入金を先に */
const byDate = (a: AccountEntry, b: AccountEntry) => a.date.localeCompare(b.date) || (a.direction === b.direction ? 0 : a.direction === "in" ? -1 : 1);

// ---------- クレカの請求（§3.3・§5.3） ----------

export const billRef = (card: string, payDate: string) => `bill:${card}:${payDate}`;

export interface Bill {
  card: CardDef;
  date: string; // 引落日
  closingYm: string; // どの締め月の分か
  items: CardEntry[]; // 請求に入るクレカ明細（予定を含む。分割（購入）を除く）
  estimate: number; // 見込み
  row: AccountEntry | null; // 口座明細のクレカ支払いの行
  amount: number; // 確定していれば確定の額、なければ見込み
}

/** 引落月 payYm の、カードごとの請求 */
export function billsFor(d: Data, payYm: string): Bill[] {
  const s = d.settings;
  return s.cards.map((c) => {
    const closingYm = closingFor(payYm, s, c.id);
    const date = cardPayDate(closingYm, s, c.id);
    // 分割（返済）は引落日の日付で持つので、引落月で入れる。ほかは利用日の締め月で入れる
    const items = d.cards.filter((e) => isLive(e) && e.group !== "purchase" && cardOf(s, e.card).id === c.id && (e.group === "installment" ? ymOf(e.date) === payYm : closingMonth(e.date, s, c.id) === closingYm)).sort((a, b) => a.date.localeCompare(b.date));
    const estimate = items.reduce((a, e) => a + e.amount, 0);
    const row = d.accounts.find((e) => e.source_ref === billRef(c.id, date)) ?? null;
    const amount = row && (row.status === "confirmed" || row.locked) ? row.amount : estimate;
    return { card: c, date, closingYm, items, estimate, row, amount };
  });
}

export const billName = (b: { card: CardDef; closingYm: string }) => `${b.card.name} ${+b.closingYm.slice(5)}月分`;

/** 請求の行を口座明細の形にする（まだ保存していないとき） */
function billEntry(b: Bill, today: string): Omit<AccountEntry, "id"> {
  return {
    account: "bank", direction: "out", status: b.date <= today ? "confirmed" : "plan", group: "card", category: null, name: billName(b), memo: "",
    date: b.date, amount: b.estimate, source: "card_bill", source_ref: billRef(b.card.id, b.date), recurring_id: null, goal_id: null,
    card: b.card.id, pair_id: null, locked: false,
  };
}

/**
 * 口座明細のクレカ支払いの行を、クレカ明細に合わせる。
 * - なければ作る（見込みが0なら作らない）
 * - 予定のあいだ（本人が直していなければ）は、額を見込みに合わせる
 * - 引落日が来たら確定にする（確定の額がまだなら見込みで）
 */
export function syncBills(d: Data, today: string, payMonths: string[]) {
  const inserts: Omit<AccountEntry, "id">[] = [];
  const updates: { id: string; patch: Partial<AccountEntry> }[] = [];
  for (const ym of payMonths) {
    for (const b of billsFor(d, ym)) {
      if (!b.row) { if (b.estimate > 0) inserts.push(billEntry(b, today)); continue; }
      if (b.row.status === "confirmed") continue;
      const patch: Partial<AccountEntry> = {};
      if (!b.row.locked && b.row.amount !== b.estimate) patch.amount = b.estimate;
      if (b.date <= today) patch.status = "confirmed";
      if (Object.keys(patch).length) updates.push({ id: b.row.id, patch });
    }
  }
  return { inserts, updates };
}

/** 保存していない請求の行も足した口座明細（計算用。来月の請求はまだ行がないことがある） */
export function accountsWithBills(d: Data, today: string, payMonths: string[]): AccountEntry[] {
  const extra = payMonths.flatMap((ym) => billsFor(d, ym)).filter((b) => !b.row && b.estimate > 0).map((b) => ({ id: `virtual:${b.card.id}:${b.date}`, ...billEntry(b, today) }));
  return [...d.accounts, ...extra];
}

// ---------- 目標（§3.4） ----------

export interface GoalMonth { ym: string; pay: number; lump: number; left: number }

/** 返済の目標の、その月の支払い日（カードなら引落日、口座なら goal.day） */
export function goalPayDate(g: Goal, ym: string, s: Settings): string {
  return g.card ? cardPayDate(closingFor(ym, s, g.card), s, g.card) : shiftBusiness(dayOf(ym, g.day || 27), "next");
}

/**
 * 目標の月ごとの額。返済は残高が0になるまで、積立は目標額に届くまで（終わる月があればそこまで）。
 * left は、返済ならその月の支払いのあとの残高、積立ならその月までにたまった額
 */
export function goalSchedule(g: Goal, s: Settings, fromYm: string, n: number): GoalMonth[] {
  const out: GoalMonth[] = [];
  const start = g.start_month ?? fromYm;
  if (g.kind === "repay") {
    let left = g.balance;
    // 残高の日より後の支払いから数える
    let ym = g.as_of && ymOf(g.as_of) > start ? ymOf(g.as_of) : start;
    if (g.as_of && goalPayDate(g, ym, s) <= g.as_of) ym = addMonths(ym, 1);
    for (let k = 0; k < 240; k++, ym = addMonths(ym, 1)) {
      const lump = g.lumps.filter((l) => ymOf(l.date) === ym && (!g.as_of || l.date > g.as_of)).reduce((a, l) => a + l.amount, 0);
      const stop = g.end_month && ym > g.end_month;
      const pay = left > 0 && !stop ? Math.min(g.monthly, left) : 0;
      const l2 = Math.min(lump, Math.max(0, left - pay));
      left -= pay + l2;
      if (ym >= fromYm) out.push({ ym, pay, lump: l2, left });
      if (out.length >= n) break;
    }
    return out;
  }
  let saved = g.balance || 0;
  for (let k = 0, ym = start < fromYm ? start : fromYm; out.length < n && k < 240; k++, ym = addMonths(ym, 1)) {
    const active = ym >= start && (!g.end_month || ym <= g.end_month) && (!g.target || saved < g.target);
    const pay = active ? (g.target ? Math.min(g.monthly, g.target - saved) : g.monthly) : 0;
    const lump = active ? g.lumps.filter((l) => ymOf(l.date) === ym).reduce((a, l) => a + l.amount, 0) : 0;
    saved += pay + lump;
    if (ym >= fromYm) out.push({ ym, pay, lump, left: saved });
  }
  return out;
}

/** その月の目標用マイナスの自動の値 ＝ 動いている目標の毎月の額 ＋ 臨時の額 */
export function goalMinusAuto(d: Data, ym: string): number {
  return d.goals.filter((g) => g.active).reduce((a, g) => {
    const m = goalSchedule(g, d.settings, ym, 1)[0];
    return a + (m ? m.pay + m.lump : 0);
  }, 0);
}

export const goalRef = (g: Goal, ym: string) => `goal:${g.id}:${ym}`;
export const lumpRef = (g: Goal, date: string) => `goal:${g.id}:lump:${date}`;

/**
 * 返済の目標から、まだ作っていない返済の予定を作る（§3.4）。
 * カードがあればクレカ明細（分割（返済）。日付は引落日）、なければ口座明細の出金。臨時の返済は口座明細の出金。
 * 同じカードの同じ引落月に分割（返済）の明細がもうあれば（定期のお金や前の版から来たもの）、作らない
 */
export function missingGoalPlans(d: Data, months: string[]) {
  const s = d.settings;
  const have = new Set([...d.accounts, ...d.cards].map((e) => e.source_ref).filter(Boolean));
  const accounts: Omit<AccountEntry, "id">[] = [];
  const cards: Omit<CardEntry, "id">[] = [];
  for (const g of d.goals) {
    if (!g.active || g.kind !== "repay") continue;
    for (const m of goalSchedule(g, s, months[0], months.length)) {
      if (!months.includes(m.ym)) continue;
      if (m.pay > 0 && !have.has(goalRef(g, m.ym))) {
        if (g.card) {
          const c = cardOf(s, g.card).id;
          const dup = d.cards.some((e) => isLive(e) && e.group === "installment" && cardOf(s, e.card).id === c && ymOf(e.date) === m.ym && (!e.goal_id || e.goal_id === g.id));
          if (!dup) cards.push({ card: c, status: "plan", date: goalPayDate(g, m.ym, s), amount: m.pay, group: "installment", category: null, name: `${g.name}の返済`, shop: "", memo: "", tatekae: 0, source: "goal", source_ref: goalRef(g, m.ym), merged_into: null, not_dup: [], locked: false, recurring_id: null, goal_id: g.id });
        } else {
          accounts.push({ account: "bank", direction: "out", status: "plan", group: "other", category: null, name: `${g.name}の返済`, memo: "", date: goalPayDate(g, m.ym, s), amount: m.pay, source: "goal", source_ref: goalRef(g, m.ym), recurring_id: null, goal_id: g.id, card: null, pair_id: null, locked: false });
        }
      }
    }
    // 臨時の返済は、残っている額までにする（「賞与から全額」など）
    const sched = goalSchedule(g, s, months[0], months.length);
    for (const m of sched) {
      let room = m.lump;
      for (const l of g.lumps.filter((x) => ymOf(x.date) === m.ym && (!g.as_of || x.date > g.as_of)).sort((a, b) => a.date.localeCompare(b.date))) {
        const amount = Math.min(l.amount, room);
        room -= amount;
        if (amount <= 0 || have.has(lumpRef(g, l.date))) continue;
        accounts.push({ account: "bank", direction: "out", status: "plan", group: "other", category: null, name: `${g.name}（${l.memo || "臨時の返済"}）`, memo: "", date: l.date, amount, source: "goal", source_ref: lumpRef(g, l.date), recurring_id: null, goal_id: g.id, card: null, pair_id: null, locked: false });
      }
    }
  }
  return { accounts, cards };
}

export interface GoalOutlook { goal: Goal; months: GoalMonth[]; doneYm: string | null }

/** 目標の見通し（§5.7）。返済は残高が0になる月、積立は目標額に届く月 */
export function goalOutlook(d: Data, fromYm: string, n = 36): GoalOutlook[] {
  return d.goals.filter((g) => g.active).map((g) => {
    const months = goalSchedule(g, d.settings, fromYm, n);
    const hit = months.find((m) => (g.kind === "repay" ? m.left <= 0 : !!g.target && m.left >= g.target));
    return { goal: g, months, doneYm: g.kind === "repay" && g.balance <= 0 ? fromYm : hit?.ym ?? null };
  });
}

// ---------- 予算（§5.1・§5.2） ----------

/** その月の費目予算。その月になければ、いちばん近い前の月の予算を引き継ぐ */
export function budgetsFor(d: Data, ym: string): Map<string, number> {
  const catRows = d.budgets.filter((b) => !b.category.startsWith("#"));
  const months = [...new Set(catRows.map((b) => b.month))].filter((m) => m <= ym).sort();
  const src = months.length ? months[months.length - 1] : null;
  const map = new Map<string, number>();
  if (src) for (const b of catRows) if (b.month === src) map.set(b.category, b.amount);
  map.delete(RESERVE); // 予備はその月に計算する
  // 予算を入れていない固定費の費目は、その月の定期マスタの額、それもなければその月の固定費の明細の合計を初めの値にする
  for (const c of d.settings.fixCats) {
    if (map.has(c)) continue;
    const sum = d.recurring.filter((r) => r.active && r.kind === "expense" && r.category === c && (!r.start_month || r.start_month <= ym) && (!r.end_month || r.end_month >= ym)).reduce((a, r) => a + r.amount, 0)
      || spendOf(d, ym).filter((x) => x.category === c).reduce((a, x) => a + x.own, 0);
    if (sum) map.set(c, sum);
  }
  return map;
}

export interface MonthBase {
  salary: number; // 給与
  extra: number; // 追加予算
  fixed: number; // 固定費（固定費の費目の予算の合計）
  goal: number; // 目標用マイナス
  goalAuto: number; // 目標マスタから出した目標用マイナス
  goalManual: boolean; // 予算マスタで手で直したか
  T: number; // 今月の予算 ＝ 給与 ＋ 追加予算 − 固定費 − 目標用マイナス
}

/** その月の「予算の元」（§5.1） */
export function monthBase(d: Data, ym: string): MonthBase {
  let salary = 0, extra = 0;
  for (const e of d.accounts) {
    if (e.direction !== "in" || ymOf(e.date) !== ym) continue;
    if (e.group === "salary") salary += e.amount;
    else if (e.group === "extra") extra += e.amount;
  }
  const budgets = budgetsFor(d, ym);
  const fixed = d.settings.fixCats.reduce((a, c) => a + (budgets.get(c) || 0), 0);
  const goalAuto = goalMinusAuto(d, ym);
  const hit = d.budgets.find((b) => b.month === ym && b.category === GOAL_KEY);
  const goal = hit ? hit.amount : goalAuto;
  return { salary, extra, fixed, goal, goalAuto, goalManual: !!hit, T: salary + extra - fixed - goal };
}

/** 予算に数える出費の1件（クレカ明細か口座明細） */
export interface Spend {
  kind: "card" | "account";
  id: string;
  date: string;
  plan: boolean;
  fixed: boolean;
  category: string | null; // null は未分類
  own: number; // 予算に数える額（立替を除く）
  card?: CardEntry;
  account?: AccountEntry;
}

/** その月の、予算に数える出費（クレカ明細の変動費・固定費、口座明細の出金の変動費・固定費） */
export function spendOf(d: Data, ym: string): Spend[] {
  const out: Spend[] = [];
  for (const e of d.cards) {
    if (!isLive(e) || ymOf(e.date) !== ym || (e.group !== "variable" && e.group !== "fixed")) continue;
    out.push({ kind: "card", id: e.id, date: e.date, plan: e.status === "plan", fixed: e.group === "fixed", category: e.category, own: ownCost(e), card: e });
  }
  for (const e of d.accounts) {
    if (e.direction !== "out" || ymOf(e.date) !== ym || (e.group !== "variable" && e.group !== "fixed")) continue;
    out.push({ kind: "account", id: e.id, date: e.date, plan: e.status === "plan", fixed: e.group === "fixed", category: e.category, own: e.amount, account: e });
  }
  return out;
}

export interface CatRow {
  cat: string;
  fixed: boolean;
  budget: number;
  used: number;
  planned: number;
  rem: number;
  daily: number | null;
  items: Spend[]; // 実際の出費
  plans: Spend[];
  unclassified: number;
}

export interface MonthView {
  ym: string;
  when: "past" | "current" | "future";
  daysLeft: number;
  base: MonthBase;
  T: number;
  U: number; // 変動費で使った
  P: number; // 変動費の予定
  fixedOver: number; // 固定費が見込みをこえた分
  R: number; // 残り予算 ＝ T − U − P − fixedOver
  cats: CatRow[];
  reserveBudget: number;
  overAllocated: boolean;
  unclassified: Spend[];
  outsideCards: CardEntry[]; // 予算に入れないクレカ明細（立替・分割）
  outsideAccounts: AccountEntry[]; // 予算に入れない口座明細の出金（立替・クレカ支払い・その他）
  incomes: AccountEntry[];
}

export function computeMonth(d: Data, ym: string, today: string): MonthView {
  const s = d.settings;
  const cur = ymOf(today);
  const when = ym < cur ? "past" : ym > cur ? "future" : "current";
  const daysLeft = when === "current" ? lastDay(ym) - +today.slice(8) + 1 : when === "future" ? lastDay(ym) : 0;
  const cats = budgetCats(s);
  const rows = new Map<string, CatRow>();
  const budgets = budgetsFor(d, ym);
  for (const c of cats) rows.set(c, { cat: c, fixed: isFixedCat(s, c), budget: budgets.get(c) || 0, used: 0, planned: 0, rem: 0, daily: null, items: [], plans: [], unclassified: 0 });
  const unclassified: Spend[] = [];
  let U = 0, P = 0;
  for (const x of spendOf(d, ym)) {
    // 費目の一覧にない費目と未分類は、変動費なら予備、固定費ならそのまま固定費の行を作らずに予備で数える
    const c = x.category && rows.has(x.category) ? x.category : RESERVE;
    const row = rows.get(c)!;
    if (!x.category) { unclassified.push(x); row.unclassified += x.own; }
    if (x.plan) { row.planned += x.own; row.plans.push(x); if (!row.fixed) P += x.own; }
    else { row.used += x.own; row.items.push(x); if (!row.fixed) U += x.own; }
  }
  const base = monthBase(d, ym);
  const T = base.T;
  const fixedOver = [...rows.values()].filter((r) => r.fixed).reduce((a, r) => a + Math.max(0, r.used + r.planned - r.budget), 0);
  const others = cats.filter((c) => c !== RESERVE && !isFixedCat(s, c)).reduce((a, c) => a + rows.get(c)!.budget, 0);
  const reserveRow = rows.get(RESERVE)!;
  reserveRow.budget = T - others;
  for (const r of rows.values()) {
    r.rem = r.budget - r.used - r.planned;
    r.daily = s.dailyCats.includes(r.cat) && when !== "past" ? (r.rem > 0 && daysLeft > 0 ? Math.floor(r.rem / daysLeft) : 0) : null;
    r.items.sort((a, b) => b.date.localeCompare(a.date));
    r.plans.sort((a, b) => a.date.localeCompare(b.date));
  }
  const inMonth = (e: { date: string }) => ymOf(e.date) === ym;
  return {
    ym, when, daysLeft, base, T, U, P, fixedOver, R: T - U - P - fixedOver, cats: cats.map((c) => rows.get(c)!),
    reserveBudget: reserveRow.budget, overAllocated: reserveRow.budget < 0, unclassified,
    outsideCards: d.cards.filter((e) => isLive(e) && inMonth(e) && e.group !== "variable" && e.group !== "fixed").sort((a, b) => b.date.localeCompare(a.date)),
    outsideAccounts: d.accounts.filter((e) => e.direction === "out" && inMonth(e) && e.group !== "variable" && e.group !== "fixed").sort((a, b) => b.date.localeCompare(a.date)),
    incomes: d.accounts.filter((e) => e.direction === "in" && inMonth(e)).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---------- 口座の今後の動き（§5.5） ----------

/** 今日より後で、いちばん近い給料日（土日祝なら後の平日） */
export function nextPayday(s: Settings, today: string): string {
  const ym = ymOf(today);
  const p = shiftBusiness(dayOf(ym, s.payday), "next");
  return p > today ? p : shiftBusiness(dayOf(addMonths(ym, 1), s.payday), "next");
}

export interface FlowRow { date: string; entry: AccountEntry; delta: number; balance: number; overdue?: boolean }

/**
 * いまの口座残高から、明日〜 to の前日（指定がなければ次の給料日の前日）の口座明細（口座）を日付の順に並べる。
 * 予定のまま計上日を過ぎたものは今日に数える。保存していないクレカ支払いの行も入れる
 */
export function accountFlow(d: Data, today: string, to?: string) {
  const now = accountNow(d, today);
  if (!now) return null;
  const end = to ?? nextPayday(d.settings, today);
  const cur = ymOf(today);
  const all = accountsWithBills(d, today, [cur, addMonths(cur, 1), addMonths(cur, 2)]);
  const ahead = all.filter((e) => e.account === "bank" && ((e.date > today && e.date < end) || (e.status === "plan" && e.date <= today)));
  const items = ahead.map((e) => ({ e, date: e.date > today ? e.date : today, overdue: e.date <= today }));
  items.sort((a, b) => a.date.localeCompare(b.date) || byDate(a.e, b.e));
  let v = now.bank;
  const rows: FlowRow[] = items.map(({ e, date, overdue }) => ({ date, entry: e, delta: signedAmount(e), balance: (v += signedAmount(e)), overdue }));
  return { now, end, rows, last: v, short: v < d.settings.safety ? d.settings.safety - v : 0 };
}

// ---------- 来月の支払い予定（§5.6） ----------

export interface PaymentPart { label: string; amount: number }
export interface Payment {
  date: string;
  name: string;
  amount: number;
  state: "予定" | "見込み" | "確定";
  entry: AccountEntry; // 口座明細の行（クレカ支払いは、まだ保存していない行のこともある）
  parts: PaymentPart[]; // クレカ支払いの中身（大費目ごと）
}

/**
 * 来月の支払い予定（§5.6）：来月 ym に口座から出るお金を、引落日の順に1件ずつ。
 * クレカ支払いは、中身を大費目ごとの合計（固定費・変動費・分割の返済・立替）に分ける
 */
export function nextPayments(d: Data, ym: string, today: string): { ym: string; rows: Payment[]; total: number } {
  const bills = billsFor(d, ym);
  const all = accountsWithBills(d, today, [ym]).filter((e) => e.account === "bank" && e.direction === "out" && ymOf(e.date) === ym);
  const rows: Payment[] = all.map((e) => {
    const b = e.group === "card" ? bills.find((x) => x.card.id === e.card && x.date === e.date) : undefined;
    const parts: PaymentPart[] = [];
    if (b) {
      // 大費目ごとの合計（一部の立替は立替に数える）
      const sum = { fixed: 0, variable: 0, installment: 0, tatekae: 0 };
      for (const x of b.items) {
        if (x.group === "fixed" || x.group === "variable") { sum[x.group] += ownCost(x); sum.tatekae += x.amount - ownCost(x); }
        else if (x.group === "installment") sum.installment += x.amount;
        else sum.tatekae += x.amount;
      }
      const labels = [["fixed", "固定費"], ["variable", "変動費"], ["installment", "分割の返済"], ["tatekae", "立替"]] as const;
      for (const [k, label] of labels) if (sum[k]) parts.push({ label, amount: sum[k] });
      if (b.amount !== b.estimate) parts.push({ label: "確定の額との差", amount: b.amount - b.estimate });
    }
    const amount = b ? b.amount : e.amount;
    const state: Payment["state"] = e.group === "card" ? (e.locked ? "確定" : "見込み") : e.status === "plan" ? "予定" : "確定";
    return { date: e.date, name: e.name || e.category || "出金", amount, state, entry: e, parts };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { ym, rows, total: rows.reduce((a, r) => a + r.amount, 0) };
}

// ---------- 計画をつくる（§5.7） ----------

export interface PlanInput { from: string; monthly: number; useBonus: boolean; saved: number; target: number; months?: number }
export interface PlanRow { ym: string; put: number; bonus: number; debtLeft: number; saved: number; free: number }
export interface PlanResult { rows: PlanRow[]; payoffYm: string | null; reachYm: string | null; minFree: number }

/** 返済・積立に回す賞与か（入金・その他のうち、名称に「賞与」とあるもの） */
export const isBonus = (e: AccountEntry) => e.direction === "in" && e.group === "other" && /賞与|ボーナス/.test(e.name);

/** 返済の目標の、その月の返済の予定の合計 */
function repayDue(d: Data, ym: string): number {
  return d.goals.filter((g) => g.active && g.kind === "repay").reduce((a, g) => a + (goalSchedule(g, d.settings, ym, 1)[0]?.pay ?? 0), 0);
}

/**
 * 毎月 monthly を回したときの見通し。リボが残っている間は max(monthly, その月の返済の予定)。賞与を回すなら、その月の賞与も足す。
 * 回した額はまずリボの残りに、なくなったら貯金に入れる。利息・手数料は入れない
 */
export function planGoals(d: Data, p: PlanInput): PlanResult {
  const n = p.months ?? 36;
  let debt = d.goals.filter((g) => g.active && g.kind === "repay").reduce((a, g) => a + g.balance, 0);
  let saved = p.saved;
  const rows: PlanRow[] = [];
  let payoffYm: string | null = debt <= 0 ? p.from : null, reachYm: string | null = null, minFree = Infinity;
  for (let k = 0; k < n; k++) {
    const ym = addMonths(p.from, k);
    const b = monthBase(d, ym);
    const bonus = p.useBonus ? d.accounts.filter((e) => isBonus(e) && ymOf(e.date) === ym).reduce((a, e) => a + e.amount, 0) : 0;
    const put = debt > 0 ? Math.max(p.monthly, repayDue(d, ym)) : p.monthly;
    let pool = put + bonus;
    const toDebt = Math.min(debt, pool);
    debt -= toDebt; pool -= toDebt; saved += pool;
    const free = (b.salary || d.settings.salaryEstimate) + b.extra - b.fixed - put;
    minFree = Math.min(minFree, free);
    rows.push({ ym, put, bonus, debtLeft: debt, saved, free });
    if (!payoffYm && debt <= 0) payoffYm = ym;
    if (!reachYm && debt <= 0 && saved >= p.target) reachYm = ym;
  }
  return { rows, payoffYm, reachYm, minFree: minFree === Infinity ? 0 : minFree };
}

/** by の月までに目標に届く、いちばん少ない毎月の額（1,000円単位）。届かなければ null */
export function monthlyFor(d: Data, p: Omit<PlanInput, "monthly">, by: string, max = 1_000_000): number | null {
  const ok = (m: number) => { const r = planGoals(d, { ...p, monthly: m }); return !!r.reachYm && r.reachYm <= by; };
  if (!ok(max)) return null;
  let lo = 0, hi = max / 1000;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (ok(mid * 1000)) hi = mid; else lo = mid + 1; }
  return lo * 1000;
}

/** 日付が過ぎたのに予定のままの手入力の予定（口座明細）。自動で作ったものは計上日に自動で確定する */
export function overduePlans(d: Data, today: string): AccountEntry[] {
  return d.accounts.filter((e) => e.status === "plan" && e.source === "manual" && e.date < today);
}

