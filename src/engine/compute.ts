import { addMonths, ymOf } from "./dates";
import { isLive } from "./merge";
import { cardOf, cardPayDate, closingFor, closingMonth, ownCost, recurringDue } from "./schedule";
import {
  ACCOUNT_GROUP_LABEL, CARD_GROUP_LABEL, RESERVE,
  type AccountEntry, type Balance, type CardDef, type CardEntry, type Data, type Settings,
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

/** 保存していない請求の行も足した口座明細（計算用。来月の請求はまだ行がないことがある） */
export function accountsWithBills(d: Data, today: string, payMonths: string[]): AccountEntry[] {
  const extra = payMonths.flatMap((ym) => billsFor(d, ym)).filter((b) => !b.row && b.estimate > 0).map((b) => ({ id: `virtual:${b.card.id}:${b.date}`, ...billEntry(b, today) }));
  return [...d.accounts, ...extra];
}

// ---------- 目標（§3.4） ----------

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

export interface FlowRow { date: string; entry: AccountEntry; delta: number; balance: number; overdue?: boolean }

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

/** 日付が過ぎたのに予定のままの手入力の予定（口座明細）。自動で作ったものは計上日に自動で確定する */
export function overduePlans(d: Data, today: string): AccountEntry[] {
  return d.accounts.filter((e) => e.status === "plan" && e.source === "manual" && e.date < today);
}

