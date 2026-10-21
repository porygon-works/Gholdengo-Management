import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMonths, categorize, computeMonth, DEFAULT_SETTINGS, findMerges, GOAL_KEY, groupOfCat, missingGoalPlans, missingRecurring, RESERVE, ruleFor, syncBills, todayJST, ymOf,
  type AccountEntry, type Balance, type Budget, type CardEntry, type Data, type Goal, type Recurring, type Rule, type Settings,
} from "../engine";
import { backend, newId, type Raw, type Row } from "./backend";
import { SEED_RULES } from "./seed";
import { convertBill, convertDebt, convertEntry, recurringFromRow } from "./v2";

export interface ReviewRow { id: string; kind: string; title: string; body: string; resolved: boolean; created_at: string }
export interface AppData extends Data { review: ReviewRow[] }

const num = (v: unknown) => (v == null || v === "" ? 0 : Math.round(Number(v)) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));
const day = (v: unknown) => str(v).slice(0, 10);
const opt = (v: unknown) => (v == null || v === "" ? null : String(v));

function settingsOf(raw: Raw): Settings {
  const saved = (raw.settings[0]?.data as Partial<Settings> & { cardClosingDay?: number; cardPayDay?: number }) || {};
  const s: Settings = { ...DEFAULT_SETTINGS, ...saved };
  // v2 の版2まではカードが1枚（cardClosingDay・cardPayDay）
  if (!saved.cards?.length) s.cards = DEFAULT_SETTINGS.cards.map((c, i) => (i === 0 ? { ...c, closingDay: saved.cardClosingDay ?? c.closingDay, payDay: saved.cardPayDay ?? c.payDay } : c));
  return s;
}

function toData(raw: Raw): AppData {
  const settings = settingsOf(raw);
  const accounts: AccountEntry[] = raw.account_entries.map((r) => ({
    id: str(r.id), account: r.account === "wallet" ? "wallet" : "bank", direction: r.direction === "in" ? "in" : "out", status: r.status === "plan" ? "plan" : "confirmed",
    group: (r.group as AccountEntry["group"]) || "other", category: opt(r.category), name: str(r.name), memo: str(r.memo), date: day(r.date), amount: num(r.amount),
    source: (r.source as AccountEntry["source"]) || "manual", source_ref: opt(r.source_ref), recurring_id: opt(r.recurring_id), goal_id: opt(r.goal_id),
    card: opt(r.card), pair_id: opt(r.pair_id), locked: !!r.locked, at: str(r.created_at) || undefined,
  }));
  const cards: CardEntry[] = raw.card_entries.map((r) => ({
    id: str(r.id), card: str(r.card) || settings.cards[0].id, status: r.status === "plan" ? "plan" : "confirmed", date: day(r.date), amount: num(r.amount),
    group: (r.group as CardEntry["group"]) || "variable", category: opt(r.category), name: str(r.name), shop: str(r.shop), memo: str(r.memo), tatekae: num(r.tatekae),
    source: (r.source as CardEntry["source"]) || "manual", source_ref: opt(r.source_ref), merged_into: opt(r.merged_into),
    not_dup: Array.isArray(r.not_dup) ? (r.not_dup as string[]) : [], locked: !!r.locked, recurring_id: opt(r.recurring_id), goal_id: opt(r.goal_id), at: str(r.created_at) || undefined,
  }));
  const balances: Balance[] = raw.balances.map((r) => ({ id: str(r.id), date: day(r.date), bank: num(r.bank), cash: num(r.cash), paypay: num(r.paypay), memo: str(r.memo), at: str(r.created_at) }));
  const recurring: Recurring[] = raw.recurring.map((r) => recurringFromRow(r, settings));
  const goals: Goal[] = [...raw.goals].sort((a, b) => num(a.sort) - num(b.sort)).map((r) => ({
    id: str(r.id), kind: r.kind === "save" ? "save" : "repay", name: str(r.name), card: opt(r.card), balance: num(r.balance), as_of: r.as_of ? day(r.as_of) : null,
    target: num(r.target), monthly: num(r.monthly), day: num(r.day) || 27, start_month: opt(r.start_month), end_month: opt(r.end_month),
    lumps: Array.isArray(r.lumps) ? (r.lumps as Goal["lumps"]).map((l) => ({ date: day(l.date), amount: num(l.amount), memo: str(l.memo) })) : [], active: r.active !== false, sort: num(r.sort),
  }));
  const budgets: Budget[] = raw.budgets.map((r) => ({ month: str(r.month), category: str(r.category), amount: num(r.amount) }));
  const rules: Rule[] = raw.rules.map((r) => ({ id: str(r.id), pattern: str(r.pattern), category: str(r.category) }));
  const review: ReviewRow[] = raw.review.map((r) => ({ id: str(r.id), kind: str(r.kind), title: str(r.title), body: str(r.body), resolved: !!r.resolved, created_at: str(r.created_at) }));
  return { accounts, cards, balances, recurring, goals, budgets, rules, settings, review };
}

const CACHE = "gholdengo.cache.v3";
function saveCache(raw: Raw) { try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), raw })); } catch { /* 容量オーバーなど */ } }
function readCache(): Raw | null { try { return JSON.parse(localStorage.getItem(CACHE) || "null")?.raw ?? null; } catch { return null; } }

/**
 * v3 にする（docs/SPEC.md §3.8）。1回だけ：設定・借金→返済の目標・毎月の貯金→積立の目標・予算の #給与 #追加予算 の始末。
 */
async function migrate4(raw: Raw, d: AppData): Promise<boolean> {
  const saved = raw.settings[0]?.data as (Partial<Settings> & { savingMonthly?: number; savingStart?: string | null; reserveGoal?: number }) | undefined;
  if (!saved || (saved.version ?? 1) >= 4) return false;
  const s = d.settings;
  // v1：固定費を家賃・奨学金・保険・共済に分けた
  const fixCats = (saved.version ?? 1) < 2 ? [...["家賃", "奨学金", "保険・共済"].filter((c) => !s.fixCats.includes(c) && !s.varCats.includes(c)), ...s.fixCats] : s.fixCats;
  const goals = raw.debts.map((r) => convertDebt(r, s));
  if (saved.savingMonthly) goals.push({ kind: "save", name: "給料1か月分の積立", card: null, balance: 0, as_of: null, target: saved.reserveGoal || s.salaryEstimate || 0, monthly: saved.savingMonthly, day: 27, start_month: saved.savingStart ?? null, end_month: null, lumps: [], active: true, sort: 99, source_ref: "v2saving" });
  if (goals.length) await backend.insert("goals", goals as unknown as Row[], { onConflict: "source_ref" });
  // リボ・分割の返済の定期のお金は止める（これからは返済の目標が、残高が0になるまで予定を作る）
  for (const r of raw.recurring) if (r.category === "返済" && r.active !== false) await backend.update("recurring", str(r.id), { active: false });
  // 予算の元の #給与・#追加予算 は、その月の口座明細の額にそろえる（足りない分を「調整」の入金で入れる）
  const accounts = raw.entries.flatMap((r) => convertEntry(r, s).accounts);
  for (const [key, group, label] of [["#給与", "salary", "給与の調整"], ["#追加予算", "extra", "追加予算の調整"]] as const) {
    for (const b of d.budgets.filter((x) => x.category === key)) {
      const have = accounts.filter((e) => e.direction === "in" && e.group === group && ymOf(e.date) === b.month).reduce((a, e) => a + e.amount, 0);
      if (b.amount > have) await backend.insert("account_entries", [{ account: "bank", direction: "in", status: "confirmed", group, name: label, date: `${b.month}-01`, amount: b.amount - have, source: "migration", source_ref: `v2base:${key}:${b.month}`, locked: true }], { onConflict: "source_ref" });
      await backend.removeBudget(b.month, key);
    }
  }
  const { savingMonthly: _a, savingStart: _b, reserveGoal: _c, ...rest } = saved as Record<string, unknown>;
  await backend.upsertKeyed("settings", [{ data: { ...rest, cards: s.cards, fixCats, version: 4 } }]);
  return true;
}

/**
 * 前の版の表（entries・card_bills）に、前に写したあとで入った行を v3 の表へ写す。
 * GAS を貼り替えるまでは、前の版の GAS がそちらに書くため。source_ref が同じものは二重に入れない
 */
async function copyV2(raw: Raw, d: AppData): Promise<boolean> {
  const since = d.settings.v2CopiedAt ?? "";
  const newer = (r: Row) => str(r.created_at) > since || !r.created_at;
  const entries = raw.entries.filter((r) => newer(r) && !r.merged_into);
  const bills = raw.card_bills.filter(newer);
  if (!entries.length && !bills.length) return false;
  const accounts: Row[] = [], cards: Row[] = [];
  for (const r of entries) {
    const c = convertEntry(r, d.settings);
    // まとめて入れる行は列をそろえる（Supabase は、ない列を null にするため。id もいつも入れる）
    const ids = c.accounts.map(() => newId());
    c.accounts.forEach((e, i) => accounts.push({ ...e, id: ids[i], pair_id: c.accounts.length === 2 ? ids[1 - i] : null }));
    cards.push(...c.cards.map((e) => ({ ...e, id: newId() })));
  }
  for (const b of bills) accounts.push({ ...convertBill(b, d.settings), id: newId() });
  // 前の版の請求額（確定）は、v3 の行があっても額を入れる（メールから入った請求額のため）
  await backend.insert("account_entries", accounts.filter((a) => a.source !== "card_bill"), { onConflict: "source_ref" });
  await backend.insert("account_entries", accounts.filter((a) => a.source === "card_bill"), { onConflict: "source_ref", merge: true });
  await backend.insert("card_entries", cards, { onConflict: "source_ref" });
  const latest = [...entries, ...bills].map((r) => str(r.created_at)).sort().pop() || new Date().toISOString();
  await backend.upsertKeyed("settings", [{ data: { ...d.settings, v2CopiedAt: latest > since ? latest : new Date().toISOString() } }]);
  return true;
}

/**
 * 読み込んだあとの自動処理。何か書いたら true を返す（読み直す）
 * 0. 初めての起動なら設定とルールの初めの値を入れる。v3 にする・前の版の表から写す
 * 1. 定期マスタと目標マスタから、今月〜5か月先の予定を作る
 * 2. 未分類のクレカ明細に、あとから覚えたルールを当てる
 * 3. 自動で作った予定は計上日が来たら確定（口座明細。セゾンなどメールの来ないカードの予定も）
 * 4. 口座明細のクレカ支払いの行をクレカ明細に合わせる
 * 5. クレカ明細の重複を自動でまとめる
 * 6. 今月の費目予算がまだなければ、前の月から引き継いだ値を保存する
 */
async function maintain(raw: Raw, d: AppData, today: string): Promise<boolean> {
  if (!raw.settings.length) { await backend.upsertKeyed("settings", [{ data: DEFAULT_SETTINGS }]); return true; }
  if (await migrate4(raw, d)) return true;
  if (await copyV2(raw, d)) return true;
  let wrote = false;
  if (!raw.rules.length) { await backend.insert("rules", SEED_RULES.map(([pattern, category]) => ({ pattern, category })), { onConflict: "pattern" }); wrote = true; }

  const cur = ymOf(today);
  const months = [0, 1, 2, 3, 4, 5].map((k) => addMonths(cur, k));
  for (const m of [missingRecurring(d, months), missingGoalPlans(d, months)]) {
    if (m.accounts.length) { await backend.insert("account_entries", m.accounts as unknown as Row[], { onConflict: "source_ref" }); wrote = true; }
    if (m.cards.length) { await backend.insert("card_entries", m.cards as unknown as Row[], { onConflict: "source_ref" }); wrote = true; }
  }
  // メールから入ったクレカ明細：未分類ならルールを当て、大費目は費目から決める（GAS は費目だけ入れる）
  for (const e of d.cards) {
    if (e.locked || e.merged_into || (e.group !== "variable" && e.group !== "fixed") || (e.source !== "card_flash" && e.source !== "card_statement")) continue;
    const c = e.category || categorize(e.shop, d.rules);
    const patch: Row = {};
    if (c && c !== e.category) patch.category = c;
    if (groupOfCat(d.settings, c) !== e.group) patch.group = groupOfCat(d.settings, c);
    if (Object.keys(patch).length) { await backend.update("card_entries", e.id, patch); wrote = true; }
  }
  for (const e of d.accounts) {
    if (e.status === "plan" && (e.source === "recurring" || e.source === "goal") && e.date <= today) { await backend.update("account_entries", e.id, { status: "confirmed" }); wrote = true; }
  }
  const mailCard = d.settings.cards[0].id;
  for (const e of d.cards) {
    if (e.status === "plan" && !e.merged_into && e.card !== mailCard && (e.source === "recurring" || e.source === "goal") && e.date <= today) { await backend.update("card_entries", e.id, { status: "confirmed" }); wrote = true; }
  }
  if (wrote) return true;

  const bills = syncBills(d, today, [addMonths(cur, -1), cur, addMonths(cur, 1)]);
  if (bills.inserts.length) await backend.insert("account_entries", bills.inserts as unknown as Row[], { onConflict: "source_ref" });
  for (const u of bills.updates) await backend.update("account_entries", u.id, u.patch as Row);
  if (bills.inserts.length || bills.updates.length) return true;

  const { merges } = findMerges(d.cards);
  for (const m of merges) {
    if (Object.keys(m.patch).length) await backend.update("card_entries", m.keep.id, m.patch as Row);
    await backend.update("card_entries", m.absorb.id, { merged_into: m.keep.id });
    wrote = true;
  }

  if (!wrote && !d.budgets.some((b) => b.month === cur && !b.category.startsWith("#"))) {
    // 今月の費目予算がまだなければ、前の月から引き継いだ値を今月の分として保存する（あとで前の月を直しても、過ぎた月の予算が変わらないように）
    const v = computeMonth(d, cur, today);
    const rows = v.cats.filter((c) => c.cat !== RESERVE && c.budget).map((c) => ({ month: cur, category: c.cat, amount: c.budget }));
    if (rows.length) await backend.upsertKeyed("budgets", rows);
  }
  return wrote;
}

export function useStore() {
  const [data, setData] = useState<AppData | null>(() => { const c = readCache(); return c ? toData(c) : null; });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const today = todayJST();
      let raw = await backend.load();
      // 自動処理で書いたら読み直す（移し替え・予定づくり・重複のまとめが段になって続くので数回まで）
      for (let i = 0; i < 8; i++) {
        if (!(await maintain(raw, toData(raw), today))) break;
        raw = await backend.load();
      }
      saveCache(raw);
      setData(toData(raw));
      setError(null);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // v3 の表がまだないとき（SQL を流す前）
      setError(/(account_entries|card_entries|goals)/.test(m) ? `${m}（Supabase の SQL Editor で supabase/migrations/0004_v3_tables.sql を実行してください）` : m);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  /** 書いてから読み直す */
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    await refresh();
    return true;
  }, [refresh]);

  return { data, error, loading, refresh, run, setError };
}

export type Store = ReturnType<typeof useStore>;

// ---------- 画面からの操作 ----------

export type NewAccount = Pick<AccountEntry, "account" | "direction" | "status" | "group" | "category" | "name" | "date" | "amount"> & Partial<Pick<AccountEntry, "memo">>;
export type NewCard = Pick<CardEntry, "card" | "status" | "group" | "category" | "date" | "amount"> & Partial<Pick<CardEntry, "name" | "shop" | "memo" | "tatekae">>;

/** 自動で作った予定（定期・目標・クレカ請求）を今月以降で消す（作り直すため） */
async function removeFuturePlans(d: AppData, pred: (e: { source: string; recurring_id: string | null; goal_id: string | null }) => boolean, today: string) {
  for (const e of d.accounts) if (e.status === "plan" && !e.locked && e.date >= today.slice(0, 7) && pred(e)) await backend.remove("account_entries", e.id);
  for (const e of d.cards) if (e.status === "plan" && !e.locked && !e.merged_into && e.date >= today.slice(0, 7) && pred(e)) await backend.remove("card_entries", e.id);
}

export const actions = {
  addAccount: (e: NewAccount) => backend.insert("account_entries", [{ memo: "", ...e, source: "manual", locked: true }]),
  updateAccount: (id: string, patch: Partial<AccountEntry>) => backend.update("account_entries", id, { ...patch, locked: true } as Row),
  async deleteAccount(d: AppData, id: string) {
    const e = d.accounts.find((x) => x.id === id);
    await backend.remove("account_entries", id);
    if (e?.pair_id) await backend.remove("account_entries", e.pair_id);
  },
  /** 予定を確定にする（金額と日付を実際の値にする） */
  confirmAccount: (id: string, amount: number, date: string) => backend.update("account_entries", id, { status: "confirmed", amount, date, locked: true }),

  addCard: (e: NewCard) => backend.insert("card_entries", [{ name: "", shop: "", memo: "", tatekae: 0, ...e, source: "manual", locked: e.status !== "plan" }]),
  async updateCard(d: AppData, id: string, patch: Partial<CardEntry>) {
    const before = d.cards.find((e) => e.id === id);
    await backend.update("card_entries", id, { ...patch, locked: true } as Row);
    // 費目を直したら、そのお店のルールとして覚える
    if (before && patch.category && patch.category !== before.category && before.source !== "manual") {
      const pattern = ruleFor(before.shop);
      if (pattern) await backend.insert("rules", [{ pattern, category: patch.category }], { onConflict: "pattern", merge: true });
    }
  },
  deleteCard: (id: string) => backend.remove("card_entries", id),
  confirmCard: (id: string, amount: number, date: string) => backend.update("card_entries", id, { status: "confirmed", amount, date, locked: true }),

  /** まとめを取り消し、以後は別のものとして扱う */
  async unmerge(d: AppData, absorbedId: string) {
    const a = d.cards.find((e) => e.id === absorbedId);
    if (!a?.merged_into) return;
    const keep = d.cards.find((e) => e.id === a.merged_into);
    await backend.update("card_entries", absorbedId, { merged_into: null, not_dup: [...new Set([...a.not_dup, a.merged_into])] });
    if (keep) await backend.update("card_entries", keep.id, { not_dup: [...new Set([...keep.not_dup, absorbedId])] });
  },
  async merge(keep: CardEntry, absorb: CardEntry) {
    const patch: Row = {};
    if (absorb.locked || absorb.source === "manual" || absorb.status === "plan") { if (absorb.category) patch.category = absorb.category; patch.group = absorb.group; patch.locked = true; }
    if (!keep.name && absorb.name) patch.name = absorb.name;
    if (!keep.memo && absorb.memo) patch.memo = absorb.memo;
    if (!keep.tatekae && absorb.tatekae) patch.tatekae = absorb.tatekae;
    await backend.update("card_entries", keep.id, patch);
    await backend.update("card_entries", absorb.id, { merged_into: keep.id });
  },
  async notDup(a: CardEntry, others: CardEntry[]) {
    await backend.update("card_entries", a.id, { not_dup: [...new Set([...a.not_dup, ...others.map((o) => o.id)])] });
    for (const o of others) await backend.update("card_entries", o.id, { not_dup: [...new Set([...o.not_dup, a.id])] });
  },

  /**
   * クレカ支払いの確定の額を入れる（三井はメールから自動）。null なら見込みに戻す（引落日が来ていなければ予定に戻る）
   * row がなければ（まだ見込みだけ）作る
   */
  async setBill(row: AccountEntry | null, bill: { card: string; date: string; name: string }, amount: number | null, today: string) {
    if (amount == null) { if (row) await backend.update("account_entries", row.id, { locked: false, status: row.date <= today ? "confirmed" : "plan" }); return; }
    if (row && !row.id.startsWith("virtual:")) { await backend.update("account_entries", row.id, { amount, status: "confirmed", locked: true }); return; }
    await backend.insert("account_entries", [{ account: "bank", direction: "out", status: "confirmed", group: "card", name: bill.name, date: bill.date, amount, source: "card_bill", source_ref: `bill:${bill.card}:${bill.date}`, card: bill.card, locked: true }], { onConflict: "source_ref", merge: true });
  },

  /**
   * 口座か財布の残高を直す。いまの両方の残高（アプリの計算）を記録として入れ、直したほうだけ本当の額にする。
   * memo に、アプリの計算と本当の額の差を残す（入れ忘れに気づけるように）
   */
  fixBalance: (date: string, now: { bank: number; wallet: number }, which: "bank" | "wallet", actual: number) => {
    const before = now[which];
    const name = which === "bank" ? "口座" : "財布";
    const diff = actual - before;
    const memo = diff ? `${name}を直した（アプリの計算 ${before.toLocaleString("ja-JP")}円、差 ${diff > 0 ? "+" : ""}${diff.toLocaleString("ja-JP")}円）` : `${name}を確かめた（アプリの計算どおり）`;
    return backend.insert("balances", [{ date, bank: which === "bank" ? actual : now.bank, cash: which === "wallet" ? actual : now.wallet, paypay: 0, memo }]);
  },
  deleteBalance: (id: string) => backend.remove("balances", id),

  /** ATMで引き出す：口座・出金 と 財布・入金 の2行 */
  async addAtm(date: string, amount: number) {
    const a = newId(), b = newId();
    const row = { status: "confirmed", group: "other", category: null, name: "ATMで引き出し", memo: "", date, amount, source: "manual", locked: true };
    await backend.insert("account_entries", [{ ...row, id: a, account: "bank", direction: "out", pair_id: b }, { ...row, id: b, account: "wallet", direction: "in", pair_id: a }]);
  },

  async saveBudgets(month: string, map: Record<string, number>) {
    await backend.upsertKeyed("budgets", Object.entries(map).filter(([c]) => c !== RESERVE).map(([category, amount]) => ({ month, category, amount })));
  },
  /** その月の目標用マイナスを手で直す。null なら目標マスタから出す値に戻す */
  saveGoalMinus: (month: string, amount: number | null) =>
    amount == null ? backend.removeBudget(month, GOAL_KEY) : backend.upsertKeyed("budgets", [{ month, category: GOAL_KEY, amount }]),

  saveSettings: (s: Settings) => backend.upsertKeyed("settings", [{ data: s }]),

  async saveRecurring(d: AppData, r: Partial<Recurring> & { id?: string }, today: string) {
    const { id, ...rest } = r;
    if (!id) { await backend.insert("recurring", [rest as Row]); return; }
    await backend.update("recurring", id, rest as Row);
    // まだ予定のままの今月以降の分は、新しい金額・日付で作り直す
    await removeFuturePlans(d, (e) => e.source === "recurring" && e.recurring_id === id, today);
  },
  async deleteRecurring(d: AppData, id: string, today: string) {
    await removeFuturePlans(d, (e) => e.source === "recurring" && e.recurring_id === id, today);
    await backend.remove("recurring", id);
  },

  async saveGoal(d: AppData, g: Partial<Goal> & { id?: string }, today: string) {
    const { id, ...rest } = g;
    if (!id) { await backend.insert("goals", [rest as Row]); return; }
    await backend.update("goals", id, rest as Row);
    await removeFuturePlans(d, (e) => e.source === "goal" && e.goal_id === id, today);
  },
  async deleteGoal(d: AppData, id: string, today: string) {
    await removeFuturePlans(d, (e) => e.source === "goal" && e.goal_id === id, today);
    await backend.remove("goals", id);
  },

  saveRule: (pattern: string, category: string) => backend.insert("rules", [{ pattern, category }], { onConflict: "pattern", merge: true }),
  deleteRule: (id: string) => backend.remove("rules", id),

  resolveReview: (id: string) => backend.update("review", id, { resolved: true }),

  /**
   * 移行用の JSON（format: gholdengo-import-v1。前の版の形）を取り込む。前の版の表に入れ、開いたときに v3 の表へ写す。
   * 2回取り込んでも二重にならない
   */
  async importJson(d: AppData, json: ImportFile): Promise<string> {
    if (json.format !== "gholdengo-import-v1") throw new Error("取り込める形のファイルではありません");
    const has = (xs: { [k: string]: unknown }[], k: string, v: unknown) => xs.some((x) => x[k] === v);
    await backend.insert("entries", json.entries ?? [], { onConflict: "source_ref" });
    const balances = (json.balances ?? []).filter((b) => !d.balances.some((x) => x.date === b.date && x.bank === b.bank));
    await backend.insert("balances", balances);
    await backend.insert("card_bills", json.card_bills ?? [], { onConflict: "pay_date", merge: true });
    // リボ・分割の返済の定期のお金は止めて入れる（返済の目標が予定を作る）
    const rec = (json.recurring ?? []).filter((r) => !has(d.recurring as never, "name", r.name)).map((r) => (r.category === "返済" ? { ...r, active: false } : r));
    await backend.insert("recurring", rec);
    const goals = (json.debts ?? []).map((r) => convertDebt(r, d.settings)).filter((g) => !has(d.goals as never, "name", g.name));
    await backend.insert("goals", goals as unknown as Row[], { onConflict: "source_ref" });
    const budgets = (json.budgets ?? []).filter((b) => b.category !== "#給与" && b.category !== "#追加予算" && b.category !== "#固定費");
    await backend.upsertKeyed("budgets", budgets);
    if (json.rules?.length) await backend.insert("rules", json.rules, { onConflict: "pattern" });
    if (json.settings) {
      const { savingMonthly, savingStart, reserveGoal, version: _v, ...rest } = json.settings as Record<string, unknown>;
      await backend.upsertKeyed("settings", [{ data: { ...d.settings, ...rest } }]);
      if (savingMonthly) await backend.insert("goals", [{ kind: "save", name: "給料1か月分の積立", monthly: savingMonthly, start_month: savingStart ?? null, target: reserveGoal || d.settings.salaryEstimate || 0, source_ref: "v2saving" }], { onConflict: "source_ref", merge: true });
    }
    // 予算の元の #給与・#追加予算 は、その月の口座明細の調整の入金にする
    for (const b of json.budgets ?? []) {
      const key = b.category as string, month = b.month as string, amount = num(b.amount);
      if (key !== "#給与" && key !== "#追加予算") continue;
      const group = key === "#給与" ? "salary" : "extra";
      const have = [...d.accounts.filter((e) => e.direction === "in" && e.group === group && ymOf(e.date) === month).map((e) => e.amount), ...(json.entries ?? []).filter((e) => e.kind === "income" && (group === "salary" ? e.category === "給与" || (!e.category && e.recurring_id) : e.category === "追加予算") && str(e.date).slice(0, 7) === month).map((e) => num(e.amount))].reduce((a, x) => a + x, 0);
      if (amount > have) await backend.insert("account_entries", [{ account: "bank", direction: "in", status: "confirmed", group, name: group === "salary" ? "給与の調整" : "追加予算の調整", date: `${month}-01`, amount: amount - have, source: "migration", source_ref: `v2base:${key}:${month}`, locked: true }], { onConflict: "source_ref", merge: true });
    }
    return `明細・予定 ${json.entries?.length ?? 0}件、残高 ${balances.length}件、定期 ${rec.length}件、目標 ${goals.length}件を取り込みました`;
  },
};

export interface ImportFile {
  format: string;
  entries?: Row[];
  balances?: (Row & { date: string; bank: number })[];
  card_bills?: Row[];
  recurring?: (Row & { name: string })[];
  budgets?: Row[];
  debts?: Row[];
  rules?: Row[];
  settings?: Partial<Settings>;
}
