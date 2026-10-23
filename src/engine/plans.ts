import { addDays, addMonths, dayOf, lastDay, shiftBusiness, ymOf } from "./dates";
import { isLive } from "./merge";
import { cardPayDate, closingMonth } from "./schedule";
import { accountNow, accountsWithBills, computeMonth } from "./compute";
import { type AccountEntry, type Data, type Plan, type PlanDebt, type PlanFund, type PlanKind } from "./types";

// 計画（§3.4）と口座の見通し（§5.5）の計算。画面はここの関数だけを使う

// ---------- 計画 ----------

export const planRef = (p: { id: string }) => `plan:${p.id}:lump`;

/** 計画の取引（口座明細のうち、その計画につないだもの） */
export const planEntries = (d: Data, p: Plan) => d.accounts.filter((e) => e.plan_id === p.id).sort((a, b) => a.date.localeCompare(b.date));
export const planPays = (d: Data, p: Plan) => planEntries(d, p).filter((e) => e.plan_role === "pay");
export const planLump = (d: Data, p: Plan) => planEntries(d, p).find((e) => e.plan_role === "lump") ?? null;
export const planDebts = (d: Data, p: Plan) => d.debts.filter((x) => x.plan_id === p.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
export const planFunds = (d: Data, p: Plan) => d.funds.filter((f) => f.plan_id === p.id).sort((a, b) => a.date.localeCompare(b.date));

/** 残高を見た日のあと、まとめて返す日より前に払う分 */
export function paidBefore(d: Data, p: Plan, debt: PlanDebt): number {
  return planPays(d, p).filter((e) => e.debt_id === debt.id && e.date > debt.as_of && (!p.use_date || e.date < p.use_date)).reduce((a, e) => a + e.amount, 0);
}
export const debtLeft = (d: Data, p: Plan, debt: PlanDebt) => Math.max(0, debt.balance - paidBefore(d, p, debt));

/** まとめて返す額（返済は残高の残り）・使う額（買い物）・目標額（貯蓄） */
export function planNeed(d: Data, p: Plan): number {
  return p.kind === "repay" ? planDebts(d, p).reduce((a, x) => a + debtLeft(d, p, x), 0) : p.target;
}

/** その日の、計画の確保額（入れた分の合計。使う日からは0。貯蓄は目標額まで） */
export function planBucket(d: Data, p: Plan, date: string): number {
  if (p.done || (p.use_date && date >= p.use_date)) return 0;
  const v = planFunds(d, p).filter((f) => f.date <= date).reduce((a, f) => a + f.amount, 0);
  return p.kind === "save" && p.target ? Math.min(v, p.target) : v;
}

/** 使う日の前の日までに確保額にたまる額（貯蓄は until の日まで） */
/** 使う日までにたまる額（使う日に入る分も数える。賞与の日にまとめて返すときなど）。貯蓄は until の日まで */
export function planCollected(d: Data, p: Plan, until: string): number {
  if (!p.use_date) return planBucket(d, p, until);
  return planFunds(d, p).filter((f) => f.date <= p.use_date!).reduce((a, f) => a + f.amount, 0);
}

/** その月の、計画の分（予算から引く額）＝ 計画の支払い ＋ 予算から確保額に入れる分 */
export function planMinus(d: Data, ym: string): number {
  const pays = d.accounts.filter((e) => e.plan_id && e.plan_role === "pay" && (e.budget_month ?? ymOf(e.date)) === ym).reduce((a, e) => a + e.amount, 0);
  const funds = d.funds.filter((f) => f.source === "budget" && f.budget_month === ym && d.plans.some((p) => p.id === f.plan_id && !p.done)).reduce((a, f) => a + f.amount, 0);
  return pays + funds;
}

/** その月の計画の分の内訳（予算の出し方に出す） */
export function planMinusItems(d: Data, ym: string): { plan: Plan; name: string; amount: number }[] {
  const out: { plan: Plan; name: string; amount: number }[] = [];
  for (const p of d.plans) {
    for (const e of planPays(d, p)) if ((e.budget_month ?? ymOf(e.date)) === ym) out.push({ plan: p, name: e.name || "支払い", amount: e.amount });
    if (p.done) continue;
    for (const f of planFunds(d, p)) if (f.source === "budget" && f.budget_month === ym) out.push({ plan: p, name: f.name || "確保額へ", amount: f.amount });
  }
  return out;
}

/** 予算から確保額に入れる分が、確保額に入る日（その月にカードで使わなかった分が、口座に残る日） */
export const budgetFundDate = (d: Data, ym: string) => cardPayDate(ym, d.settings, d.settings.cards[0]?.id);

export const lumpName = (k: PlanKind) => (k === "repay" ? "まとめて返す" : "使う");

/**
 * まとめて払う（使う）行を計画に合わせる。使う日のある計画にはその日の予定の行を1つ作り、額は残高の残り（買い物は金額）にする。
 * 確定にした行と、終わった計画は直さない
 */
export function syncLumps(d: Data) {
  const inserts: Omit<AccountEntry, "id">[] = [];
  const updates: { id: string; patch: Partial<AccountEntry> }[] = [];
  const removes: string[] = [];
  for (const p of d.plans) {
    const row = planLump(d, p);
    const want = p.kind !== "save" && p.use_date && !p.done;
    if (!want) { if (row && row.status === "plan" && !p.done) removes.push(row.id); continue; }
    const amount = planNeed(d, p);
    if (!row) {
      if (d.removedRefs?.includes(planRef(p))) continue;
      inserts.push({ account: "bank", direction: "out", status: "plan", group: "other", category: null, name: `${lumpName(p.kind)}（${p.name}）`, memo: "", date: p.use_date!, amount, source: "plan", source_ref: planRef(p), recurring_id: null, goal_id: null, card: null, pair_id: null, locked: false, plan_id: p.id, debt_id: null, plan_role: "lump", budget_month: null });
      continue;
    }
    if (row.status !== "plan") continue;
    const patch: Partial<AccountEntry> = {};
    if (row.amount !== amount) patch.amount = amount;
    if (row.date !== p.use_date) patch.date = p.use_date!;
    if (Object.keys(patch).length) updates.push({ id: row.id, patch });
  }
  return { inserts, updates, removes };
}

export interface PlanStatus {
  need: number; // 使う額
  got: number; // 使う日の前の日までにたまる額
  short: number; // 足りない額
  spare: number; // その日の予備（確保額 − 計画の確保額）
  ok: boolean; // そろう（足りない分も予備でまかなえる）
}

/** 計画のそろい具合。足りない分は、使う日の前の日の予備でまかなえるかを見る */
export function planStatus(d: Data, p: Plan, f: Forecast | null): PlanStatus {
  const need = planNeed(d, p);
  const until = f?.end ?? addMonths(ymOf(new Date().toISOString().slice(0, 10)), 6) + "-01";
  const got = planCollected(d, p, until);
  const short = p.use_date ? Math.max(0, need - got) : 0;
  // 予備は、使う日にまとめて払う前の口座残高から、この計画にたまった分とほかの計画の分を引いた額
  const day = p.use_date ?? until;
  const bank = f ? bankAt(f, day) : null;
  const lump = p.use_date ? planLump(d, p)?.amount ?? 0 : 0;
  const spare = bank == null ? 0 : bank + lump - got - d.plans.filter((q) => q.id !== p.id).reduce((a, q) => a + planBucket(d, q, day), 0);
  return { need, got, short, spare, ok: short <= 0 || spare >= short };
}

// ---------- 口座の見通し（§5.5） ----------

export interface DayPoint { date: string; bank: number; real: number }
export interface ForecastRow { date: string; entry: AccountEntry; delta: number; balance: number; overdue: boolean; virtual: boolean }
export interface Forecast {
  start: string;
  today: string;
  end: string;
  days: DayPoint[];
  rows: ForecastRow[]; // 明日から end までの口座の動き（見込みを含む）
  history: { date: string; entry: AccountEntry; delta: number }[]; // start から今日までの確定した口座の動き
  eves: string[]; // 給料日の前日
}

const sign = (e: AccountEntry) => (e.direction === "in" ? e.amount : -e.amount);

/** その月の給料日の前日（給料日が土日祝なら後の平日の前日） */
export const paydayEve = (d: Data, ym: string) => addDays(shiftBusiness(dayOf(ym, d.settings.payday), "next"), -1);

/**
 * 口座の見通し。前の月の1日から months か月先の月末まで、毎日の口座残高と実質残高を出す。
 * - 過ぎた日：いまの口座残高から、その日のあと今日までの確定した口座明細を戻す
 * - これから：予定の口座明細（定期・計画・クレカ支払いの見込み）に、これからカードで使う見込み（その月の残り予算）を足す
 * - 実質残高 ＝ 口座残高 − まだ引き落とされていないカードの分（使った日に減る。見込みは月の中で日割り）
 */
export function forecast(d: Data, today: string, months = 6): Forecast | null {
  const now = accountNow(d, today);
  if (!now) return null;
  const s = d.settings, cur = ymOf(today), main = s.cards[0]?.id;
  const start = `${addMonths(cur, -1)}-01`;
  const endYm = addMonths(cur, months - 1), end = dayOf(endYm, 31);
  const payMonths = Array.from({ length: months + 1 }, (_, k) => addMonths(cur, k));
  const all = accountsWithBills(d, today, payMonths).filter((e) => e.account === "bank");

  // これからカードで使う見込み（今月〜。今月は残り予算、先の月はその月の予算から予定を引いた額）
  const proj: { ym: string; amount: number; pay: string }[] = [];
  for (let k = 0; k < months; k++) {
    const ym = addMonths(cur, k);
    const amount = Math.max(0, computeMonth(d, ym, today).R);
    if (amount > 0) proj.push({ ym, amount, pay: cardPayDate(ym, s, main) });
  }
  const virt: AccountEntry[] = proj.filter((x) => x.pay <= end).map((x) => ({
    id: `proj:${x.ym}`, account: "bank", direction: "out", status: "plan", group: "card", category: null, name: `${+x.ym.slice(5)}月にカードで使う見込み（残り予算）`,
    memo: "", date: x.pay, amount: x.amount, source: "card_bill", source_ref: null, recurring_id: null, goal_id: null, card: main ?? null, pair_id: null, locked: false,
  }));

  // 過ぎた日の残高：いまの残高から、その日のあと今日までの確定した明細を戻す
  const past = all.filter((e) => e.status === "confirmed" && e.date > start && e.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const ahead = [...all.filter((e) => (e.date > today && e.date <= end) || (e.status === "plan" && e.date <= today)), ...virt]
    .map((e) => ({ e, date: e.date > today ? e.date : today, overdue: e.date <= today }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.e.direction === b.e.direction ? 0 : a.e.direction === "in" ? -1 : 1));
  let v = now.bank;
  const rows: ForecastRow[] = ahead.map(({ e, date, overdue }) => ({ date, entry: e, delta: sign(e), balance: (v += sign(e)), overdue, virtual: e.id.startsWith("proj:") || e.id.startsWith("virtual:") }));

  // まだ引き落とされていないカードの分（使った日 ≤ t ＜ 引落日）
  const cardItems = d.cards.filter((e) => isLive(e) && e.group !== "purchase").map((e) => ({ date: e.date, pay: cardPayDate(closingMonth(e.date, s, e.card), s, e.card), amount: e.amount }));
  const unpaid = (t: string) => {
    let u = 0;
    for (const c of cardItems) if (c.date <= t && c.pay > t) u += c.amount;
    for (const x of proj) {
      if (x.pay <= t) continue;
      const first = `${x.ym}-01`;
      if (t < first && x.ym !== cur) continue;
      // 今月の見込みは今日から月末まで、先の月は月の初めから日割りで増える
      const from = x.ym === cur ? today : first, n = x.ym === cur ? lastDay(cur) - +today.slice(8) + 1 : lastDay(x.ym);
      const done = t < from ? 0 : Math.min(n, Math.round((Date.parse(t) - Date.parse(from)) / 864e5) + 1);
      u += (x.amount * done) / n;
    }
    return u;
  };

  const days: DayPoint[] = [];
  let back = now.bank;
  const pastByDay = new Map<string, number>();
  for (const e of past) pastByDay.set(e.date, (pastByDay.get(e.date) ?? 0) + sign(e));
  // 今日から前の日へ戻る
  const before: DayPoint[] = [];
  for (let t = today; t >= start; t = addDays(t, -1)) {
    before.push({ date: t, bank: back, real: back - unpaid(t) });
    back -= pastByDay.get(t) ?? 0;
  }
  days.push(...before.reverse());
  let bal = now.bank, i = 0;
  while (i < rows.length && rows[i].date <= today) { bal = rows[i].balance; i++; }
  if (days.length) { days[days.length - 1].bank = bal; days[days.length - 1].real = bal - unpaid(today); }
  for (let t = addDays(today, 1); t <= end; t = addDays(t, 1)) {
    while (i < rows.length && rows[i].date <= t) { bal = rows[i].balance; i++; }
    days.push({ date: t, bank: bal, real: bal - unpaid(t) });
  }
  const eves: string[] = [];
  for (let k = -1; k < months; k++) { const e = paydayEve(d, addMonths(cur, k)); if (e >= start && e <= end) eves.push(e); }
  return { start, today, end, days, rows, eves, history: past.map((e) => ({ date: e.date, entry: e, delta: sign(e) })) };
}

export function bankAt(f: Forecast, date: string): number | null {
  const p = f.days.find((x) => x.date === date);
  return p ? p.bank : null;
}

export interface Reserve { date: string; total: number; byKind: Record<PlanKind, number>; spare: number }

/** 確保額（給料日の前日の口座残高）と、その内訳（計画の種類ごと・予備） */
export function reserveAt(d: Data, f: Forecast, date: string): Reserve | null {
  const total = bankAt(f, date);
  if (total == null) return null;
  const byKind: Record<PlanKind, number> = { repay: 0, buy: 0, save: 0 };
  for (const p of d.plans) byKind[p.kind] += planBucket(d, p, date);
  return { date, total, byKind, spare: total - byKind.repay - byKind.buy - byKind.save };
}

/** 給料日の前日から次の給料日の前日までの、口座の動き（確保額の増減の内訳） */
export function reserveMoves(f: Forecast, from: string, to: string): { date: string; entry: AccountEntry; delta: number }[] {
  return [...f.history, ...f.rows.map((r) => ({ date: r.date, entry: r.entry, delta: r.delta }))].filter((r) => r.date > from && r.date <= to);
}

export type { PlanFund };
