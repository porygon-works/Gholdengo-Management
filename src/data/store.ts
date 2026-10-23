import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMonths, applyLabels, budgetFundDate, cardPayDate, categorize, closingEnd, closingFor, computeMonth, DEFAULT_SETTINGS, findMerges, goalPayDate, goalSchedule, groupOfCat, missingRecurring, normalizeBills, RESERVE, ruleFor, syncBills, syncLumps, todayJST, ymOf,
  type AccountEntry, type Balance, type Budget, type CardEntry, type Data, type FundSource, type Goal, type MonthSetting, type Plan, type PlanDebt, type PlanFund, type PlanKind, type Recurring, type Rule, type Settings, type Status,
} from "../engine";
import { backend, newId, type Raw, type Row } from "./backend";
import { SEED_RULES } from "./seed";
import { snapshot } from "./snapshot";
import { convertBill, convertDebt, convertEntry, recurringFromRow } from "./v2";

export interface ReviewRow { id: string; kind: string; title: string; body: string; resolved: boolean; created_at: string }
export interface AppData extends Data { review: ReviewRow[]; missing: string[] }

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
  applyLabels(settings);
  // 消した明細（deleted）は計算にも画面にも出さない。source_ref だけ覚えておき、また作らない
  const removedRefs = [...raw.account_entries, ...raw.card_entries].filter((r) => r.deleted && r.source_ref).map((r) => str(r.source_ref));
  const accounts: AccountEntry[] = raw.account_entries.filter((r) => !r.deleted).map((r) => ({
    id: str(r.id), account: r.account === "wallet" ? "wallet" : "bank", direction: r.direction === "in" ? "in" : "out", status: r.status === "plan" ? "plan" : "confirmed",
    group: (r.group as AccountEntry["group"]) || "other", category: opt(r.category), name: str(r.name), memo: str(r.memo), date: day(r.date), amount: num(r.amount),
    source: (r.source as AccountEntry["source"]) || "manual", source_ref: opt(r.source_ref), recurring_id: opt(r.recurring_id), goal_id: opt(r.goal_id),
    card: opt(r.card), pair_id: opt(r.pair_id), locked: !!r.locked, at: str(r.created_at) || undefined,
    plan_id: opt(r.plan_id), debt_id: opt(r.debt_id), plan_role: r.plan_role === "pay" || r.plan_role === "lump" ? r.plan_role : null, budget_month: opt(r.budget_month),
  }));
  const cards: CardEntry[] = raw.card_entries.filter((r) => !r.deleted).map((r) => ({
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
  const plans: Plan[] = [...(raw.plans ?? [])].sort((a, b) => num(a.sort) - num(b.sort) || str(a.created_at).localeCompare(str(b.created_at))).map((r) => ({
    id: str(r.id), kind: (r.kind === "buy" || r.kind === "save" ? r.kind : "repay") as PlanKind, name: str(r.name), use_date: r.use_date ? day(r.use_date) : null, target: num(r.target), done: !!r.done, sort: num(r.sort),
  }));
  const debts: PlanDebt[] = (raw.plan_debts ?? []).map((r) => ({ id: str(r.id), plan_id: str(r.plan_id), name: str(r.name), balance: num(r.balance), as_of: day(r.as_of) || day(r.created_at), sort: num(r.sort) }));
  const funds: PlanFund[] = (raw.plan_funds ?? []).map((r) => ({
    id: str(r.id), plan_id: str(r.plan_id), source: (r.source === "bonus" || r.source === "spare" ? r.source : "budget") as FundSource, name: str(r.name), date: day(r.date), budget_month: opt(r.budget_month), amount: num(r.amount), status: r.status === "confirmed" ? "confirmed" : "plan",
  }));
  const months: MonthSetting[] = (raw.months ?? []).map((r) => ({ month: str(r.month), budget: r.budget == null || r.budget === "" ? null : num(r.budget), memo: str(r.memo) }));
  const budgets: Budget[] = raw.budgets.map((r) => ({ month: str(r.month), category: str(r.category), amount: num(r.amount) }));
  const rules: Rule[] = raw.rules.map((r) => ({ id: str(r.id), pattern: str(r.pattern), category: str(r.category) }));
  const review: ReviewRow[] = raw.review.map((r) => ({ id: str(r.id), kind: str(r.kind), title: str(r.title), body: str(r.body), resolved: !!r.resolved, created_at: str(r.created_at) }));
  return { accounts: normalizeBills(accounts), cards, balances, recurring, goals, plans, debts, funds, months, budgets, rules, settings, review, removedRefs, missing: raw.missing ?? [] };
}

const CACHE = "gholdengo.cache.v4";

/**
 * Claude が読むための書き出しを Supabase に保存する（GAS が1時間に1回 Google ドライブに置く）。
 * 前に保存したものと同じなら書かない。保存できなくても（SQL を流す前など）、アプリの動きは止めない
 */
let lastSnapshot = "";
async function saveSnapshot(d: AppData, today: string) {
  try {
    const snap = snapshot(d, today);
    const key = JSON.stringify({ ...snap, exportedAt: "" });
    if (key === lastSnapshot) return;
    await backend.upsertKeyed("snapshots", [{ data: snap }]);
    lastSnapshot = key;
  } catch (e) {
    console.warn("書き出しを保存できませんでした", e);
  }
}
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
/**
 * 版5 → 版6：版5でクレカ明細の分割（返済）を引落日の日付にしたのを、締め期間の最後の日に戻す
 * （分割（返済）も利用日で請求に入れる決め方に戻したため）
 */
async function migrate6(raw: Raw, d: AppData): Promise<boolean> {
  const saved = raw.settings[0]?.data as Partial<Settings> | undefined;
  if (!saved || saved.version !== 5) return false;
  const s = d.settings;
  for (const e of d.cards) {
    if (e.group !== "installment") continue;
    const closing = closingFor(ymOf(e.date), s, e.card);
    if (e.date !== cardPayDate(closing, s, e.card)) continue;
    await backend.update("card_entries", e.id, { date: closingEnd(closing, s, e.card) });
  }
  await backend.upsertKeyed("settings", [{ data: { ...s, version: 6 } }]);
  return true;
}

/**
 * v4：前の版の目標マスタを計画に写す（1回だけ。docs/SPEC.md §3.4）。
 * - 返済の目標は、臨時の返済の日が同じものを1つの計画にまとめる（まとめて返す日 ＝ その日）。残高は今日の見込みにする
 * - 毎月の返済は、計画の支払い（口座明細の予定）にする。カードの支払いはカードの引落日に、カードの請求と一緒に出る
 * - 積立の目標は貯蓄の計画にして、毎月の額は「予算から」確保額に入れる分にする
 * - 目標から作った予定（まだ予定のもの）は消し、目標は止める
 */
async function migratePlans(raw: Raw, d: AppData, today: string): Promise<boolean> {
  // 写した目標は止めるので、動いている目標があるときだけ写す（前の版の取り込みで目標が入ったときも）
  const active = d.goals.filter((g) => g.active);
  if (raw.missing?.length || !active.length) return false;
  const s = d.settings, cur = ymOf(today);
  const accounts: Row[] = [], debts: Row[] = [], funds: Row[] = [], plans: Row[] = [];
  const groups = new Map<string, Goal[]>();
  for (const g of active.filter((g) => g.kind === "repay")) {
    const use = g.lumps.map((l) => l.date).filter((x) => x >= today).sort()[0];
    const k = use ?? `none:${g.id}`;
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  let sort = 0;
  for (const [k, gs] of groups) {
    const planId = newId(), use = k.startsWith("none:") ? null : k;
    plans.push({ id: planId, kind: "repay", name: gs.length > 1 ? "リボを全額返す" : `${gs[0].name}を返す`, use_date: use, target: 0, done: false, sort: sort++ });
    gs.forEach((g, i) => {
      const debtId = newId();
      // 残高は今日の見込み（入れた日のあと、今日までに来た毎月の返済を引く）
      let left = g.balance;
      for (const m of goalSchedule(g, s, g.as_of ? ymOf(g.as_of) : cur, 24)) { const pd = goalPayDate(g, m.ym, s); if (pd > today) break; if (!g.as_of || pd > g.as_of) left -= m.pay; }
      debts.push({ id: debtId, plan_id: planId, name: g.name, balance: Math.max(0, left), as_of: today, sort: i });
      for (const m of goalSchedule(g, s, cur, 6)) {
        const date = goalPayDate(g, m.ym, s);
        if (!m.pay || date <= today || (use && date >= use)) continue;
        accounts.push({ id: newId(), account: "bank", direction: "out", status: "plan", group: "other", category: null, name: `${g.name}の支払い`, memo: "", date, amount: m.pay, source: "plan", source_ref: `plan:${planId}:${g.id}:${m.ym}`, recurring_id: null, goal_id: null, card: g.card, pair_id: null, locked: false, plan_id: planId, debt_id: debtId, plan_role: "pay", budget_month: m.ym });
      }
    });
  }
  for (const g of active.filter((g) => g.kind === "save")) {
    const planId = newId();
    plans.push({ id: planId, kind: "save", name: g.name, use_date: null, target: g.target, done: false, sort: sort++ });
    if (g.balance > 0) funds.push({ id: newId(), plan_id: planId, source: "spare", name: "これまでの分", date: today, budget_month: null, amount: g.balance, status: "confirmed" });
    for (const m of goalSchedule(g, s, cur, 6)) if (m.pay) funds.push({ id: newId(), plan_id: planId, source: "budget", name: `${+m.ym.slice(5)}月の予算から`, date: budgetFundDate(d, m.ym), budget_month: m.ym, amount: m.pay, status: "plan" });
  }
  if (plans.length) await backend.insert("plans", plans);
  if (debts.length) await backend.insert("plan_debts", debts);
  if (funds.length) await backend.insert("plan_funds", funds);
  if (accounts.length) await backend.insert("account_entries", accounts, { onConflict: "source_ref" });
  for (const e of d.accounts) if (e.source === "goal" && e.status === "plan" && !e.locked) await backend.remove("account_entries", e.id);
  for (const e of d.cards) if (e.source === "goal" && e.status === "plan" && !e.locked && !e.merged_into) await backend.remove("card_entries", e.id);
  for (const g of active) await backend.update("goals", g.id, { active: false });
  await backend.upsertKeyed("settings", [{ data: { ...s, plansFrom: new Date().toISOString() } }]);
  return true;
}

async function maintain(raw: Raw, d: AppData, today: string): Promise<boolean> {
  if (!raw.settings.length) { await backend.upsertKeyed("settings", [{ data: DEFAULT_SETTINGS }]); return true; }
  if (await migrate4(raw, d)) return true;
  if (await migrate6(raw, d)) return true;
  if (await copyV2(raw, d)) return true;
  if (await migratePlans(raw, d, today)) return true;
  let wrote = false;
  if (!raw.rules.length) { await backend.insert("rules", SEED_RULES.map(([pattern, category]) => ({ pattern, category })), { onConflict: "pattern" }); wrote = true; }

  const cur = ymOf(today);
  const months = [0, 1, 2, 3, 4, 5].map((k) => addMonths(cur, k));
  // 計画に写したあとに残った、前の版の目標から作った予定（臨時の返済など）は消す（計画のまとめて払う行と二重になるため）
  if (d.plans.length && !d.goals.some((g) => g.active)) {
    for (const e of d.accounts) if (e.source === "goal" && e.status === "plan" && e.date > today) { await backend.remove("account_entries", e.id); wrote = true; }
  }
  // まとめて払う（使う）行を、計画の残高・使う日に合わせる
  const ls = syncLumps(d);
  if (ls.inserts.length) { await backend.insert("account_entries", ls.inserts as unknown as Row[], { onConflict: "source_ref" }); wrote = true; }
  for (const u of ls.updates) { await backend.update("account_entries", u.id, u.patch as Row); wrote = true; }
  for (const id of ls.removes) { await backend.remove("account_entries", id); wrote = true; }
  for (const m of [missingRecurring(d, months)]) {
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
    if (e.status === "plan" && (e.source === "recurring" || e.source === "goal" || e.source === "plan") && e.date <= today) { await backend.update("account_entries", e.id, { status: "confirmed" }); wrote = true; }
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
  // 読み直しは1つずつ順番に行う。読み直しの最中に頼まれたら、終わってからもう1回読む（保存や削除のあとに古い画面が残らないように）
  const chain = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
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
      const d = toData(raw);
      setData(d);
      setError(null);
      await saveSnapshot(d, today);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // 新しい表・列がまだないとき（SQL を流す前）
      setError(/(account_entries|card_entries|goals|deleted|every|plan_id|plan_role|budget_month|plans|months)/.test(m) ? `${m}（Supabase の SQL Editor で supabase/migrations/ の新しい SQL を実行してください）` : m);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback((): Promise<void> => {
    // まだ始まっていない読み直しがあれば、それにまとめる
    if (queued.current) return queued.current;
    const p = chain.current.then(() => { queued.current = null; return load(); });
    queued.current = p;
    chain.current = p.catch(() => undefined);
    return p;
  }, [load]);

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

/**
 * 明細を消す。メールや定期・目標から作った行（source_ref がある）は、行を残して deleted にする。
 * 消してしまうと、メールの取り込みや予定づくりで、また同じものが作られるため
 */
async function removeRow(t: "account_entries" | "card_entries", e: { id: string; source_ref: string | null }) {
  if (e.source_ref) await backend.update(t, e.id, t === "card_entries" ? { deleted: true, merged_into: null } : { deleted: true });
  else await backend.remove(t, e.id);
}

/** 自動で作った予定（定期・目標・クレカ請求）を今月以降で消す（作り直すため。作り直すので、行ごと消す） */
async function removeFuturePlans(d: AppData, pred: (e: { source: string; recurring_id: string | null; goal_id: string | null }) => boolean, today: string) {
  for (const e of d.accounts) if (e.status === "plan" && !e.locked && e.date >= today.slice(0, 7) && pred(e)) await backend.remove("account_entries", e.id);
  for (const e of d.cards) if (e.status === "plan" && !e.locked && !e.merged_into && e.date >= today.slice(0, 7) && pred(e)) await backend.remove("card_entries", e.id);
}

export const actions = {
  addAccount: (e: NewAccount) => backend.insert("account_entries", [{ memo: "", ...e, source: "manual", locked: true }]),
  updateAccount: (id: string, patch: Partial<AccountEntry>) => backend.update("account_entries", id, { ...patch, locked: true } as Row),
  /** 口座明細を消す。ATM の相手の行も消す */
  async deleteAccount(d: AppData, id: string) {
    const e = d.accounts.find((x) => x.id === id);
    await removeRow("account_entries", e ?? { id, source_ref: null });
    const pair = e?.pair_id ? d.accounts.find((x) => x.id === e.pair_id) : undefined;
    if (pair) await removeRow("account_entries", pair);
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
  /** クレカ明細を消す。この明細にまとめた明細（速報・手入力・予定）も一緒に消す（残すと、まとめが外れてまた出てくる） */
  async deleteCard(d: AppData, id: string) {
    const e = d.cards.find((x) => x.id === id);
    for (const a of d.cards.filter((x) => x.merged_into === id)) await removeRow("card_entries", a);
    await removeRow("card_entries", e ?? { id, source_ref: null });
  },
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
  /** その月の予算を決める。null なら目安（給与 − 固定費 − 計画の分）に戻す */
  saveMonthBudget: (month: string, budget: number | null) => backend.upsertKeyed("months", [{ month, budget }]),

  saveSettings: (s: Settings) => backend.upsertKeyed("settings", [{ data: s }]),

  /** 費目の名前を変える。明細・予算・ルール・定期・設定の一覧に入っている費目も一緒に変える */
  async renameCategory(d: AppData, from: string, to: string) {
    for (const e of d.cards) if (e.category === from) await backend.update("card_entries", e.id, { category: to });
    for (const e of d.accounts) if (e.category === from) await backend.update("account_entries", e.id, { category: to });
    for (const r of d.recurring) if (r.category === from) await backend.update("recurring", r.id, { category: to });
    for (const r of d.rules) if (r.category === from) await backend.update("rules", r.id, { category: to });
    const budgets = d.budgets.filter((b) => b.category === from);
    if (budgets.length) await backend.upsertKeyed("budgets", budgets.map((b) => ({ ...b, category: to })));
    for (const b of budgets) await backend.removeBudget(b.month, from);
    const s = d.settings, ren = (xs: string[]) => xs.map((x) => (x === from ? to : x));
    await backend.upsertKeyed("settings", [{ data: { ...s, varCats: ren(s.varCats), fixCats: ren(s.fixCats), dailyCats: ren(s.dailyCats) } }]);
  },

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

  // ---------- 計画（§3.4） ----------

  /** 計画を作る。返済は残高と毎月の支払い、買い物・貯蓄は毎月予算から入れる分。賞与から入れる分も作れる */
  async createPlan(d: AppData, x: NewPlan) {
    const id = newId();
    await backend.insert("plans", [{ id, kind: x.kind, name: x.name, use_date: x.kind === "save" ? null : x.use_date, target: x.kind === "repay" ? 0 : x.amount, done: false, sort: d.plans.length }]);
    const months = Array.from({ length: Math.max(0, x.months) }, (_, k) => addMonths(x.start, k));
    if (x.kind === "repay") {
      const debtId = newId();
      await backend.insert("plan_debts", [{ id: debtId, plan_id: id, name: x.debtName || x.name, balance: x.amount, as_of: x.today, sort: 0 }]);
      const rows = x.monthly ? months.map((m) => {
        const date = x.card ? cardPayDate(closingFor(m, d.settings, x.card), d.settings, x.card) : `${m}-${String(Math.min(28, x.day || 27)).padStart(2, "0")}`;
        return { id: newId(), account: "bank", direction: "out", status: "plan", group: "other", category: null, name: `${x.debtName || x.name}の支払い`, memo: "", date, amount: x.monthly, source: "plan", source_ref: null, recurring_id: null, goal_id: null, card: x.card, pair_id: null, locked: false, plan_id: id, debt_id: debtId, plan_role: "pay", budget_month: m };
      }).filter((r) => !x.use_date || r.date < x.use_date) : [];
      if (rows.length) await backend.insert("account_entries", rows);
    } else if (x.monthly) {
      const rows = months.map((m) => ({ id: newId(), plan_id: id, source: "budget", name: `${+m.slice(5)}月の予算から`, date: budgetFundDate(d, m), budget_month: m, amount: x.monthly, status: "plan" }))
        .filter((r) => x.kind === "save" || !x.use_date || r.date < x.use_date);
      if (rows.length) await backend.insert("plan_funds", rows);
    }
    if (x.bonus) await backend.insert("plan_funds", [{ id: newId(), plan_id: id, source: "bonus", name: "賞与から", date: x.bonusDate, budget_month: null, amount: x.bonus, status: "plan" }]);
    return id;
  },
  updatePlan: (id: string, patch: Partial<Plan>) => backend.update("plans", id, patch as Row),
  /** 計画を消す。計画の取引のうち、まだ予定のものは消す（確定したものは残し、つながりだけ外れる） */
  async deletePlan(d: AppData, id: string) {
    for (const e of d.accounts) if (e.plan_id === id && e.status === "plan") await backend.remove("account_entries", e.id);
    await backend.remove("plans", id);
  },
  addDebt: (planId: string, name: string, balance: number, today: string, sort: number) => backend.insert("plan_debts", [{ plan_id: planId, name, balance, as_of: today, sort }]),
  /** 残高を直す（見た日は今日にする） */
  updateDebt: (id: string, patch: Partial<PlanDebt>) => backend.update("plan_debts", id, patch as Row),
  deleteDebt: (id: string) => backend.remove("plan_debts", id),
  /** 計画の支払いを足す（口座明細の予定） */
  addPlanPay: (p: Plan, x: { name: string; date: string; amount: number; card: string | null; debt_id: string | null; budget_month: string }) =>
    backend.insert("account_entries", [{ account: "bank", direction: "out", status: "plan", group: "other", category: null, memo: "", source: "plan", source_ref: null, recurring_id: null, goal_id: null, pair_id: null, locked: false, plan_id: p.id, plan_role: "pay", ...x }]),
  /** 計画の取引を直す（名前・額・日・予定か確定か）。自動で直さないように locked にする */
  updatePlanEntry: (id: string, patch: Partial<AccountEntry>) => backend.update("account_entries", id, { ...patch, locked: true } as Row),
  deletePlanEntry: (id: string) => backend.remove("account_entries", id),
  addFund: (p: Plan, x: { source: FundSource; name: string; date: string; budget_month: string | null; amount: number }) => backend.insert("plan_funds", [{ plan_id: p.id, status: "plan", ...x }]),
  updateFund: (id: string, patch: Partial<PlanFund>) => backend.update("plan_funds", id, patch as Row),
  deleteFund: (id: string) => backend.remove("plan_funds", id),
  setStatus: (t: "account_entries" | "plan_funds", id: string, status: Status) => backend.update(t, id, t === "account_entries" ? { status, locked: true } : { status }),

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

export interface NewPlan {
  kind: PlanKind;
  name: string;
  amount: number; // 返済：いまの残高・買い物：金額・貯蓄：目標額
  use_date: string | null;
  monthly: number; // 返済：毎月の支払い・買い物と貯蓄：毎月予算から入れる額
  start: string; // 始める月
  months: number; // 何か月分作るか
  card: string | null; // 返済：どのカードの請求と一緒に払うか（null は口座から）
  day: number; // 返済：口座から払う日
  debtName: string;
  bonus: number;
  bonusDate: string;
  today: string;
}

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
