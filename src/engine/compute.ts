import { addDays, addMonths, daysBetween, lastDay, ymOf } from "./dates";
import { isLive } from "./merge";
import { cardPayDate, cashDate, ownCost } from "./schedule";
import { budgetCats, nonBudgetCats, RESERVE, type Balance, type Data, type Entry, type Settings } from "./types";

// 仕様書 §5 の計算式

/** 予算でどの費目に数えるか。null は予算に数えない */
export function budgetCat(e: Entry, s: Settings): string | null {
  if (e.kind !== "expense" || !isLive(e) || e.method === "revo") return null;
  if (e.category && nonBudgetCats.includes(e.category)) return null;
  if (!e.category) return RESERVE;
  return budgetCats(s).includes(e.category) ? e.category : RESERVE;
}

export function latestBalance(balances: Balance[]): Balance | null {
  let best: Balance | null = null;
  for (const b of balances) if (!best || b.date > best.date) best = b;
  return best;
}

export const balanceTotal = (b: Balance) => (b.bank || 0) + (b.cash || 0) + (b.paypay || 0);

export interface AssetEvent {
  date: string;
  delta: number;
  label: string;
  entry?: Entry;
  bill?: boolean;
  cardSum?: number; // 請求額で置きかえたときの、その日のクレカ明細の合計
}

export interface Projection {
  base: Balance;
  events: AssetEvent[]; // 日付順。同じ日は収入が先
}

/** 予測資産 A(t) の元になる出来事の並び（§5.1） */
export function projection(d: Data, today: string): Projection | null {
  const base = latestBalance(d.balances);
  if (!base) return null;
  const s = d.settings;
  const soon = today > base.date ? today : addDays(base.date, 1);
  const events: AssetEvent[] = [];
  for (const e of d.entries) {
    if (!isLive(e)) continue;
    let cd = cashDate(e, s);
    if (!cd) continue;
    // 残高の報告日までに資産が動くはずだった分は、起きていれば報告した残高に入っている。二重に数えない
    // （予定のまま残っていても、画面には「日付が過ぎた予定」として出るので、本人が確定か削除をする）
    if (cd <= base.date) continue;
    // 報告日より後で、まだ起きていない予定は、遅れていても今日以降に起きるものとして数える
    if (e.status === "plan" && cd < soon) cd = soon;
    const label = e.item || e.shop || (e.kind === "income" ? "入金" : "支出");
    events.push({ date: cd, delta: e.kind === "income" ? e.amount : -e.amount, label, entry: e });
  }
  // カード請求額が分かっている引落日は、明細の合計の代わりに請求額で数える
  for (const b of d.cardBills) {
    if (b.pay_date <= base.date) continue;
    let cardSum = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.date === b.pay_date && ev.entry?.method === "card" && ev.entry.kind === "expense") { cardSum -= ev.delta; events.splice(i, 1); }
    }
    events.push({ date: b.pay_date, delta: -b.amount, label: "クレカ引落（請求額）", bill: true, cardSum });
  }
  const isCard = (e: AssetEvent) => (e.entry?.method === "card" ? 1 : 0);
  events.sort((a, b) => a.date.localeCompare(b.date) || Math.sign(b.delta) - Math.sign(a.delta) || isCard(a) - isCard(b));
  return { base, events };
}

/** 日付 t の終わりの予測資産 */
export function assetAt(p: Projection, t: string): number {
  let v = balanceTotal(p.base);
  for (const ev of p.events) {
    if (ev.date > t) break;
    v += ev.delta;
  }
  return v;
}

/** from〜to の間で、日の終わりの予測資産がいちばん少ない日 */
export function minAsset(p: Projection, from: string, to: string): { value: number; date: string } {
  let v = assetAt(p, from);
  let best = { value: v, date: from };
  const evs = p.events;
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    if (ev.date <= from) continue;
    if (ev.date > to) break;
    v += ev.delta;
    // 同じ日の出来事をすべて足したあとの値で比べる
    if (evs[i + 1]?.date === ev.date) continue;
    if (v < best.value) best = { value: v, date: ev.date };
  }
  return best;
}

export interface MonthForecast {
  ym: string;
  from: string; // 判定する期間の始め＝この月にクレカで使った分の引落日 H
  payDate: string; // H
  to: string; // 判定する期間の終わり＝次の月の引落日
  R: number; // この月まだ使える額
  min: { value: number; date: string }; // 期間中のいちばん少ない資産（それより前の月の R を使ったあと）
  spendDate: string; // この月の R が資産から出ると考える日（＝H）
}

/**
 * 今月から n か月先までの R（§5.2, §5.5）。
 * 残りをカードで使うと考え、その引落日 H〜次の月の引落日 の間、資産が安全残高を下回らない額。
 * 前の月の R はそれぞれの H に出ていくものとして引く。
 * すでに使った分（カードも現金も）は A(t) に入っているので、使った分だけ R が減る。
 */
export function forecast(d: Data, today: string, n = 3): MonthForecast[] | null {
  const p = projection(d, today);
  if (!p) return null;
  const out: MonthForecast[] = [];
  const cur = ymOf(today);
  for (let k = 0; k <= n; k++) {
    const ym = addMonths(cur, k);
    const from = cardPayDate(ym, d.settings);
    const to = cardPayDate(addMonths(ym, 1), d.settings);
    // 前の月の R は、その月の H に出ていく。期間の始めにはどれも出ている
    const spent = out.reduce((a, f) => a + Math.max(0, f.R), 0);
    const m = minAsset(p, from, to);
    const min = { value: m.value - spent, date: m.date };
    out.push({ ym, from, payDate: from, to, R: min.value - d.settings.safety, min, spendDate: from });
  }
  return out;
}

/** 現金・PayPay で今日使えば、その日から出ていく。今日〜次の月の引落日 で判定した上限 */
export function cashLimit(d: Data, today: string): { value: number; date: string } | null {
  const p = projection(d, today);
  if (!p) return null;
  const to = cardPayDate(addMonths(ymOf(today), 1), d.settings);
  const m = minAsset(p, today, to);
  return { value: m.value - d.settings.safety, date: m.date };
}

/** 今月分の引落日より前に、使う額にかかわらず安全残高を下回る日 */
export function dipBefore(d: Data, today: string): { value: number; date: string } | null {
  const p = projection(d, today);
  if (!p) return null;
  const m = minAsset(p, today, addDays(cardPayDate(ymOf(today), d.settings), -1));
  return m.value < d.settings.safety ? m : null;
}

/** その月の費目予算。その月になければ、いちばん近い前の月の予算を引き継ぐ */
export function budgetsFor(d: Data, ym: string): Map<string, number> {
  const months = [...new Set(d.budgets.map((b) => b.month))].filter((m) => m <= ym).sort();
  const src = months.length ? months[months.length - 1] : null;
  const map = new Map<string, number>();
  if (src) for (const b of d.budgets) if (b.month === src) map.set(b.category, b.amount);
  if (src !== ym) map.delete(RESERVE); // 予備は引き継がない（その月に計算する）
  if (!src) {
    // 予算がまだ一度もないときは、定期の支出の見込みを固定費の初めの値にする
    for (const r of d.recurring) {
      if (!r.active || r.kind !== "expense" || !r.category || !d.settings.fixCats.includes(r.category)) continue;
      map.set(r.category, (map.get(r.category) || 0) + r.amount);
    }
  }
  return map;
}

export interface CatRow {
  cat: string;
  budget: number;
  used: number;
  planned: number;
  rem: number;
  daily: number | null;
  entries: Entry[]; // 実際の明細（速報・確定）
  plans: Entry[];
  unclassified: number; // 未分類から予備に数えている額
}

export interface MonthView {
  ym: string;
  when: "past" | "current" | "future";
  daysLeft: number; // 今日を含む月末までの日数（過ぎた月は 0）
  T: number | null; // 今月使える予算
  U: number;
  P: number;
  R: number | null; // 残り予算
  payDate: string;
  min: { value: number; date: string } | null;
  cats: CatRow[];
  reserveBudget: number;
  overAllocated: boolean;
  unclassified: Entry[];
  outside: Entry[]; // 予算に入れない支出
  incomes: Entry[];
  noBalance: boolean;
}

export function computeMonth(d: Data, ym: string, today: string): MonthView {
  const s = d.settings;
  const cur = ymOf(today);
  const when = ym < cur ? "past" : ym > cur ? "future" : "current";
  const daysLeft = when === "current" ? lastDay(ym) - +today.slice(8) + 1 : when === "future" ? lastDay(ym) : 0;
  const cats = budgetCats(s);
  const rows = new Map<string, CatRow>();
  const budgets = budgetsFor(d, ym);
  for (const c of cats) rows.set(c, { cat: c, budget: budgets.get(c) || 0, used: 0, planned: 0, rem: 0, daily: null, entries: [], plans: [], unclassified: 0 });

  const unclassified: Entry[] = [], outside: Entry[] = [], incomes: Entry[] = [];
  let U = 0, P = 0;
  for (const e of d.entries) {
    if (!isLive(e) || ymOf(e.date) !== ym) continue;
    if (e.kind === "income") { incomes.push(e); continue; }
    if (e.kind !== "expense") continue;
    const c = budgetCat(e, s);
    if (!c) { outside.push(e); continue; }
    const row = rows.get(c)!;
    if (!e.category && e.status !== "plan") { unclassified.push(e); row.unclassified += ownCost(e); }
    if (e.status === "plan") { row.planned += ownCost(e); row.plans.push(e); P += ownCost(e); }
    else { row.used += ownCost(e); row.entries.push(e); U += ownCost(e); }
  }

  let R: number | null = null, T: number | null = null, min = null as MonthView["min"];
  const payDate = cardPayDate(ym, s);
  let noBalance = false;
  if (when !== "past") {
    const fc = forecast(d, today, Math.max(0, monthsBetween(cur, ym)));
    if (fc) {
      const f = fc[fc.length - 1];
      R = f.R;
      min = f.min;
      T = U + P + R;
    } else noBalance = true;
  }
  const others = cats.filter((c) => c !== RESERVE).reduce((a, c) => a + rows.get(c)!.budget, 0);
  const reserveRow = rows.get(RESERVE)!;
  if (T != null) reserveRow.budget = T - others;
  else if (when === "past") T = others + reserveRow.budget;
  const reserveBudget = reserveRow.budget;

  for (const r of rows.values()) {
    r.rem = r.budget - r.used - r.planned;
    r.daily = s.dailyCats.includes(r.cat) && when !== "past" ? (r.rem > 0 && daysLeft > 0 ? Math.floor(r.rem / daysLeft) : 0) : null;
    r.entries.sort((a, b) => b.date.localeCompare(a.date));
    r.plans.sort((a, b) => a.date.localeCompare(b.date));
  }
  return {
    ym, when, daysLeft, T, U, P, R, payDate, min, cats: cats.map((c) => rows.get(c)!), reserveBudget,
    overAllocated: reserveBudget < 0, unclassified, outside, incomes, noBalance,
  };
}

const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

export interface PaydayCheck {
  date: string; // 給料日の前日
  value: number;
}

/** 目標③：給料日前日の予測資産（それまでの月の R をすべて使ったとして） */
export function paydayChecks(d: Data, today: string, n = 3): PaydayCheck[] {
  const p = projection(d, today);
  const fc = forecast(d, today, n);
  if (!p || !fc) return [];
  const out: PaydayCheck[] = [];
  const paydays = d.entries.filter((e) => isLive(e) && e.kind === "income" && e.recurring_id && e.date > today && /給与/.test(e.item)).map((e) => e.date).sort();
  for (const pd of [...new Set(paydays)].slice(0, n)) {
    const day = addDays(pd, -1);
    const spent = fc.filter((f) => f.spendDate <= day).reduce((a, f) => a + Math.max(0, f.R), 0);
    out.push({ date: day, value: assetAt(p, day) - spent });
  }
  return out;
}

/** 通帳の形：報告日から先の出来事と残高。同じ日のクレカ引落は1行にまとめる */
export function passbook(d: Data, today: string, to: string): { base: Balance; rows: (AssetEvent & { balance: number; count: number })[] } | null {
  const p = projection(d, today);
  if (!p) return null;
  const grouped: (AssetEvent & { count: number })[] = [];
  for (const ev of p.events) {
    if (ev.date > to) break;
    const card = ev.entry?.method === "card" && ev.entry.kind === "expense";
    const last = grouped[grouped.length - 1];
    if (card && last && last.date === ev.date && last.label === "クレカ引落") { last.delta += ev.delta; last.count++; continue; }
    grouped.push(card ? { date: ev.date, delta: ev.delta, label: "クレカ引落", count: 1 } : { ...ev, count: 1 });
  }
  let v = balanceTotal(p.base);
  const rows = grouped.map((ev) => { v += ev.delta; return { ...ev, balance: v }; });
  return { base: p.base, rows };
}

export const daysAgo = (d: string, today: string) => daysBetween(d, today);
