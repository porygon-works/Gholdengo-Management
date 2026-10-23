import { addMonths, dayOf, lastDay, shiftBusiness, ymOf } from "./dates";
import { isLive } from "./merge";
import { cardOf, cardPayDate, closingFor, closingMonth, ownCost, recurringDue } from "./schedule";
import { planMinus } from "./plans";
import {
  ACCOUNT_GROUP_LABEL, budgetCats, CARD_GROUP_LABEL, isFixedCat, RESERVE,
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
    const items = d.cards.filter((e) => isLive(e) && e.group !== "purchase" && cardOf(s, e.card).id === c.id && closingMonth(e.date, s, c.id) === closingYm).sort((a, b) => a.date.localeCompare(b.date));
    const estimate = items.reduce((a, e) => a + e.amount, 0);
    const row = d.accounts.find((e) => e.source_ref === billRef(c.id, date)) ?? null;
    const amount = row && (row.status === "confirmed" || row.locked) ? row.amount : estimate;
    return { card: c, date, closingYm, items, estimate, row, amount };
  });
}

export const billName = (b: { card: CardDef; closingYm: string }) => `${b.card.name} ${+b.closingYm.slice(5)}月分`;

/**
 * 計画の支払いのうち、カードの請求と一緒に引き落とされるもの（リボの毎月の支払いなど）。
 * カード会社の請求額（確定の額）にはこれが入っているので、クレカ支払いの行の額はこれを引いた額にする（二重に数えない）
 */
export function normalizeBills(accounts: AccountEntry[]): AccountEntry[] {
  const part = new Map<string, number>();
  for (const e of accounts) if (e.plan_id && e.plan_role === "pay" && e.card) part.set(`${e.card}:${e.date}`, (part.get(`${e.card}:${e.date}`) ?? 0) + e.amount);
  if (!part.size) return accounts;
  return accounts.map((e) => {
    const k = `${e.card}:${e.date}`;
    if (e.group !== "card" || e.source !== "card_bill" || !e.locked || !part.has(k)) return e;
    return { ...e, billTotal: e.amount, amount: Math.max(0, e.amount - part.get(k)!) };
  });
}

/** 請求の行を口座明細の形にする（まだ保存していないとき） */
function billEntry(b: Bill, today: string): Omit<AccountEntry, "id"> {
  return {
    account: "bank", direction: "out", status: b.date <= today ? "confirmed" : "plan", group: "card", category: null, name: billName(b), memo: "",
    date: b.date, amount: b.estimate, source: "card_bill", source_ref: billRef(b.card.id, b.date), recurring_id: null, goal_id: null,
    card: b.card.id, pair_id: null, locked: false,
  };
}

/**
 * クレカ支払いの行は、口座のお金が動いたこと（引き落とし）か、カード会社の確定の額だけを保存する（§3.3）。
 * まだ確定していない先の請求は保存せず、毎回クレカ明細から出す（accountsWithBills）。
 * - 引落日が来て確定の額がなければ、見込みの額で確定の行を作る
 * - 前の版で作った、先の日付の見込みの行（予定・本人が直していない）は消す
 */
export function syncBills(d: Data, today: string, payMonths: string[]) {
  const inserts: Omit<AccountEntry, "id">[] = [];
  const updates: { id: string; patch: Partial<AccountEntry> }[] = [];
  const removes = d.accounts.filter((e) => e.source === "card_bill" && e.status === "plan" && !e.locked && e.date > today).map((e) => e.id);
  for (const ym of payMonths) {
    for (const b of billsFor(d, ym)) {
      if (b.date > today) continue;
      if (!b.row) { if (b.estimate > 0 && !d.removedRefs?.includes(billRef(b.card.id, b.date))) inserts.push(billEntry(b, today)); continue; }
      if (b.row.status === "plan") updates.push({ id: b.row.id, patch: b.row.locked ? { status: "confirmed" } : { status: "confirmed", amount: b.estimate } });
    }
  }
  return { inserts, updates, removes };
}

/** 画面で使う口座明細：保存していない先のクレカ支払い（見込み）も足す。前の月〜6か月先 */
export function withBills<T extends Data>(d: T, today: string): T {
  const cur = ymOf(today);
  return { ...d, accounts: accountsWithBills(d, today, Array.from({ length: 8 }, (_, k) => addMonths(cur, k - 1))) };
}

/**
 * 計画の支払いと同じものの、クレカ明細の分割（返済）。
 * 計画の支払い（カードの請求と一緒に出る）があれば、その請求に入る分割（返済）の明細は同じ支払いなので、明細から外す（消した印をつけて残す）
 */
export function duplicateInstallments(d: Data): CardEntry[] {
  const s = d.settings;
  const pays = new Set(d.accounts.filter((e) => e.plan_id && e.plan_role === "pay" && e.card).map((e) => `${e.card}:${e.date}`));
  return d.cards.filter((e) => isLive(e) && e.group === "installment" && pays.has(`${cardOf(s, e.card).id}:${cardPayDate(closingMonth(e.date, s, e.card), s, e.card)}`));
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
  // 始める月がなければ、返済は残高の日の月から（見ている月からにすると、先の月でも残高が減っていない）
  const start = g.start_month ?? (g.kind === "repay" && g.as_of ? ymOf(g.as_of) : fromYm);
  if (g.kind === "repay") {
    let left = g.balance;
    // 残高の日より後の支払いから数える
    let ym = g.as_of && ymOf(g.as_of) > start ? ymOf(g.as_of) : start;
    if (g.as_of && goalPayDate(g, ym, s) <= g.as_of) ym = addMonths(ym, 1);
    for (let k = 0; k < 240; k++, ym = addMonths(ym, 1)) {
      // 額を入れていない臨時の返済は、残り全部
      const ls = g.lumps.filter((l) => ymOf(l.date) === ym && (!g.as_of || l.date > g.as_of));
      const lump = ls.some((l) => !l.amount) ? Infinity : ls.reduce((a, l) => a + l.amount, 0);
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
    const sum = d.recurring.filter((r) => r.kind === "expense" && r.category === c && recurringDue(r, ym)).reduce((a, r) => a + r.amount, 0)
      || spendOf(d, ym).filter((x) => x.category === c).reduce((a, x) => a + x.own, 0);
    if (sum) map.set(c, sum);
  }
  return map;
}

export interface MonthBase {
  salary: number; // 給与
  extra: number; // 追加予算
  fixed: number; // 固定費（固定費の費目の予算の合計）
  plan: number; // 計画の分（計画の支払い ＋ 予算から確保額に入れる分）
  auto: number; // 目安 ＝ 給与 ＋ 追加予算 − 固定費 − 計画の分
  manual: number | null; // その月に決めた予算（なければ null）
  T: number; // 今月の予算 ＝ 決めた予算、なければ目安
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
  const plan = planMinus(d, ym);
  const auto = salary + extra - fixed - plan;
  const manual = d.months.find((m) => m.month === ym)?.budget ?? null;
  return { salary, extra, fixed, plan, auto, manual, T: manual ?? auto };
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

export type PayGroup = "fixed" | "variable" | "installment" | "tatekae" | "other" | "diff";
export const PAY_GROUP_LABEL: Record<PayGroup, string> = { fixed: "固定費", variable: "変動費", installment: "計画の支払い", tatekae: "立替", other: "その他", diff: "クレカの確定の額との差" };

/** 大費目の名前の初めの値（設定の「区分」で変えられる。計算は id で行うので、名前を変えても計算は変わらない） */
export const GROUP_LABEL_DEFAULTS: Record<string, string> = {
  variable: "変動費", fixed: "固定費", tatekae: "立替", card: "クレカ支払い", other: "その他",
  salary: "給与", extra: "追加予算", refund: "立替の返金", bonus: "賞与", installment: "分割（旧）", purchase: "リボ",
};

/** 設定の大費目の名前を、画面で使う名前の表に入れる（読み込むたびに呼ぶ） */
export function applyLabels(s: Settings) {
  const l = { ...GROUP_LABEL_DEFAULTS, ...(s.labels ?? {}) };
  for (const k of Object.keys(ACCOUNT_GROUP_LABEL) as (keyof typeof ACCOUNT_GROUP_LABEL)[]) ACCOUNT_GROUP_LABEL[k] = l[k];
  for (const k of Object.keys(CARD_GROUP_LABEL) as (keyof typeof CARD_GROUP_LABEL)[]) CARD_GROUP_LABEL[k] = l[k];
  for (const k of ["fixed", "variable", "tatekae", "other"] as const) PAY_GROUP_LABEL[k] = l[k];
  PAY_GROUP_LABEL.installment = "計画の支払い";
}

export interface PayItem {
  date: string; // 口座から出る日（クレカは引落日）
  name: string;
  from: string; // 三井・セゾン・口座
  amount: number;
  plan: boolean;
  card?: CardEntry;
  account?: AccountEntry;
}
export interface PayGroupRow { group: PayGroup; amount: number; items: PayItem[] }

/**
 * 来月の支払い予定（§5.6）：来月 ym に口座から出るお金を、大費目ごとに分ける。
 * クレカ支払いは中身のクレカ明細に分けて数える（一部の立替は立替へ）。口座の出金は大費目のまま。クレカ支払いの行そのものは数えない
 */
export function nextPayments(d: Data, ym: string): { ym: string; groups: PayGroupRow[]; total: number } {
  const map = new Map<PayGroup, PayItem[]>();
  const add = (g: PayGroup, x: PayItem) => { if (x.amount) map.set(g, [...(map.get(g) ?? []), x]); };
  for (const b of billsFor(d, ym)) {
    for (const e of b.items) {
      const base = { date: b.date, name: e.name || e.shop || e.category || "クレカ", from: b.card.name, plan: e.status === "plan", card: e };
      const own = ownCost(e);
      if (e.group === "fixed" || e.group === "variable") { add(e.group, { ...base, amount: own }); add("tatekae", { ...base, amount: e.amount - own }); }
      else if (e.group === "installment") add("installment", { ...base, amount: e.amount });
      else add("tatekae", { ...base, amount: e.amount });
    }
    if (b.amount !== b.estimate) add("diff", { date: b.date, name: billName(b), from: b.card.name, amount: b.amount - b.estimate, plan: false, account: b.row ?? undefined });
  }
  for (const e of d.accounts) {
    if (e.account !== "bank" || e.direction !== "out" || e.group === "card" || ymOf(e.date) !== ym) continue;
    const g: PayGroup = e.group === "fixed" || e.group === "variable" || e.group === "tatekae" ? e.group : e.source === "goal" || e.source === "plan" ? "installment" : "other";
    add(g, { date: e.date, name: e.name || e.category || "出金", from: "口座", amount: e.amount, plan: e.status === "plan", account: e });
  }
  const order: PayGroup[] = ["fixed", "variable", "installment", "tatekae", "other", "diff"];
  const groups = order.filter((g) => map.has(g)).map((g) => {
    const items = map.get(g)!.sort((a, b) => a.date.localeCompare(b.date));
    return { group: g, amount: items.reduce((a, x) => a + x.amount, 0), items };
  });
  return { ym, groups, total: groups.reduce((a, g) => a + g.amount, 0) };
}

/** 賞与か（入金・その他のうち、名称に「賞与」とあるもの） */
export const isBonus = (e: AccountEntry) => e.direction === "in" && e.group === "other" && /賞与|ボーナス/.test(e.name);

/** 日付が過ぎたのに予定のままの手入力の予定（口座明細）。自動で作ったものは計上日に自動で確定する */
export function overduePlans(d: Data, today: string): AccountEntry[] {
  return d.accounts.filter((e) => e.status === "plan" && e.source === "manual" && e.date < today);
}

