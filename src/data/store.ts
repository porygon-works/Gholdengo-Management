import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMonths, applyLabels, guideOf, cardPayDate, categorize, closingEnd, closingFor, budgetsFor, DEFAULT_SETTINGS, findMerges, withBills, groupOfCat, missingRecurring, normalizeBills, RESERVE, ruleFor, syncBills, todayJST, ymOf,
  type AccountEntry, type Balance, type Budget, type Loan, type LoanBalance, type PlanMove, type V5Data, type V5Month, type V5Plan, type CardEntry, type Data, type FundSource, type Goal, type MonthSetting, type Plan, type PlanDebt, type PlanFund, type PlanKind, type Recurring, type Rule, type Settings,
} from "../engine";
import { backend, newId, V4_TABLES, type Raw, type Row } from "./backend";
import { SEED_RULES } from "./seed";
import { snapshot } from "./snapshot";
import { convertBill, convertDebt, convertEntry, recurringFromRow } from "./v2";
import { atmRow, handover, handoverPatch, revolvingPatch, splitRows } from "./v5ops";

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

/** v4 の表（0007）がまだないか。v5 の表（0008）がないだけなら false */
export const v4Missing = (raw: Raw) => !!raw.missing?.some((t) => (V4_TABLES as string[]).includes(t));

export function toData(raw: Raw): AppData {
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
    revolved_at: r.revolved_at ? day(r.revolved_at) : null,
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
  return { accounts: normalizeBills(accounts), cards, balances, recurring, goals, plans, debts, funds, months, budgets, rules, settings, review, removedRefs, missing: raw.missing ?? [], v5: v5Of(raw) };
}

/** v5 の表（0008_v5.sql）。表がまだなければ全部空 */
function v5Of(raw: Raw): V5Data {
  const plans: V5Plan[] = [...(raw.v5_plans ?? [])].sort((a, b) => num(a.sort) - num(b.sort) || str(a.created_at).localeCompare(str(b.created_at))).map((r) => ({
    id: str(r.id), kind: (r.kind === "buy" || r.kind === "save" ? r.kind : "repay") as PlanKind, name: str(r.name), target: num(r.target), due_date: r.due_date ? day(r.due_date) : null,
    monthly: num(r.monthly), start_month: opt(r.start_month), draw_order: num(r.draw_order), no_draw: !!r.no_draw, done: !!r.done, sort: num(r.sort),
  }));
  const loans: Loan[] = [...(raw.v5_loans ?? [])].sort((a, b) => num(a.sort) - num(b.sort)).map((r) => ({
    id: str(r.id), plan_id: opt(r.plan_id), name: str(r.name), card: opt(r.card), monthly: num(r.monthly), pay_day: r.pay_day == null || r.pay_day === "" ? null : num(r.pay_day), sort: num(r.sort),
  }));
  const balances: LoanBalance[] = (raw.v5_loan_balances ?? []).map((r) => ({ id: str(r.id), loan_id: str(r.loan_id), date: day(r.date), balance: num(r.balance), at: str(r.created_at) || undefined }));
  const moves: PlanMove[] = (raw.v5_moves ?? []).map((r) => ({
    id: str(r.id), plan_id: str(r.plan_id), kind: (r.kind === "bonus" || r.kind === "draw" || r.kind === "spend" ? r.kind : "manual") as PlanMove["kind"], amount: num(r.amount), date: day(r.date),
    bonus_entry_id: opt(r.bonus_entry_id), entry_kind: r.entry_kind === "card" || r.entry_kind === "account" ? r.entry_kind : null, entry_id: opt(r.entry_id), memo: str(r.memo),
  }));
  const months: V5Month[] = (raw.v5_months ?? []).map((r) => ({ month: str(r.month), budget: num(r.budget), source: r.source === "guide" ? "guide" : "decided" }));
  return { plans, loans, balances, moves, months };
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

async function maintain(raw: Raw, d: AppData, today: string): Promise<boolean> {
  if (!raw.settings.length) { await backend.upsertKeyed("settings", [{ data: DEFAULT_SETTINGS }]); return true; }
  if (await migrate4(raw, d)) return true;
  if (await migrate6(raw, d)) return true;
  if (await copyV2(raw, d)) return true;
  let wrote = false;
  if (!raw.rules.length) { await backend.insert("rules", SEED_RULES.map(([pattern, category]) => ({ pattern, category })), { onConflict: "pattern" }); wrote = true; }
  // v5：ATM で引き出した分を入れる費目「現金」（設計書 §3.6）
  if (!d.settings.varCats.includes("現金")) { await backend.upsertKeyed("settings", [{ data: { ...d.settings, varCats: [...d.settings.varCats, "現金"] } }]); wrote = true; }

  const cur = ymOf(today);
  // 見通しの全期間（今月〜6か月先）に定期の予定があるように、7か月分作る
  const months = [0, 1, 2, 3, 4, 5, 6].map((k) => addMonths(cur, k));
  // お金の動き1つにつき行は1つ（§3.4）
  // - 目標マスタは使わない（計画に写した）。目標から作った予定は計画の取引に置き換わったので持たない
  // - 計画の支払いと同じもの（クレカ明細の分割（返済））は、消した印をつけて残す
  if (!d.goals.some((g) => g.active)) {
    for (const e of d.accounts) if (e.source === "goal" && e.status === "plan") { await backend.remove("account_entries", e.id); wrote = true; }
    for (const e of d.cards) if (e.source === "goal" && e.status === "plan" && !e.merged_into) { await backend.remove("card_entries", e.id); wrote = true; }
  }
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
  for (const id of bills.removes) await backend.remove("account_entries", id);
  if (bills.inserts.length || bills.updates.length || bills.removes.length) return true;

  const { merges } = findMerges(d.cards);
  for (const m of merges) {
    if (Object.keys(m.patch).length) await backend.update("card_entries", m.keep.id, m.patch as Row);
    await backend.update("card_entries", m.absorb.id, { merged_into: m.keep.id });
    wrote = true;
  }

  if (!wrote && !d.budgets.some((b) => b.month === cur && !b.category.startsWith("#"))) {
    // 今月の費目予算がまだなければ、前の月から引き継いだ値を今月の分として保存する（あとで前の月を直しても、過ぎた月の予算が変わらないように）
    const rows = [...budgetsFor(d, cur)].filter(([c, amount]) => c !== RESERVE && amount).map(([category, amount]) => ({ month: cur, category, amount }));
    if (rows.length) await backend.upsertKeyed("budgets", rows);
  }
  // v5：今月の予算を決めていなければ、月の初めの目安額をその月の予算として保存する（あとで見込みが変わっても予算は動かない。設計書 §3.2）
  if (!wrote && !raw.missing?.includes("v5_months") && !d.v5.months.some((m) => m.month === cur)) {
    await backend.upsertKeyed("v5_months", [{ month: cur, budget: guideOf(d, cur).amount, source: "guide" }]);
    return true;
  }
  return wrote;
}

export function useStore() {
  // 画面には、保存していない先のクレカ支払い（見込み）も足して渡す
  const [data, setData] = useState<AppData | null>(() => { const c = readCache(); return c ? withBills(toData(c), todayJST()) : null; });
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
      const d = withBills(toData(raw), today);
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

  async saveBudgets(month: string, map: Record<string, number>) {
    await backend.upsertKeyed("budgets", Object.entries(map).filter(([c]) => c !== RESERVE).map(([category, amount]) => ({ month, category, amount })));
  },

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

 
  saveRule: (pattern: string, category: string) => backend.insert("rules", [{ pattern, category }], { onConflict: "pattern", merge: true }),
  deleteRule: (id: string) => backend.remove("rules", id),

  resolveReview: (id: string) => backend.update("review", id, { resolved: true }),

};

// ---------- v5（設計書 docs/superpowers/specs/2026-10-23-v5-yoyuugaku-design.md） ----------

export const actions5 = {
  addLoan: (x: Omit<Loan, "id">, balance: number, date: string) => {
    const id = newId();
    return backend.insert("v5_loans", [{ id, ...x }]).then(() => backend.insert("v5_loan_balances", [{ loan_id: id, date, balance }]));
  },
  updateLoan: (id: string, patch: Partial<Loan>) => backend.update("v5_loans", id, patch as Row),
  removeLoan: (id: string) => backend.remove("v5_loans", id),
  /** 借入残高を直す（カードのサイトで見た額）。前の記録から計算した額との差が「借入残高の修正」になる */
  setLoanBalance: (loanId: string, date: string, balance: number) => backend.insert("v5_loan_balances", [{ loan_id: loanId, date, balance }]),

  addPlan: (x: Omit<V5Plan, "id">) => { const id = newId(); return backend.insert("v5_plans", [{ id, ...x }]).then(() => id); },
  updatePlan: (id: string, patch: Partial<V5Plan>) => backend.update("v5_plans", id, patch as Row),
  removePlan: (id: string) => backend.remove("v5_plans", id),
  addMove: (m: Omit<PlanMove, "id">) => backend.insert("v5_moves", [m as unknown as Row]),
  removeMove: (id: string) => backend.remove("v5_moves", id),
  /** 取崩順を並べ直す（ids の順に 1, 2, 3 …） */
  async setDrawOrder(ids: string[]) { for (const [i, id] of ids.entries()) await backend.update("v5_plans", id, { draw_order: i + 1 }); },

  /** その月の予算を決める。null なら目安額に戻す（目安額で保存する） */
  decideBudget: (d: Data, month: string, amount: number | null) =>
    backend.upsertKeyed("v5_months", [amount == null ? { month, budget: guideOf(d, month).amount, source: "guide" } : { month, budget: amount, source: "decided" }]),

  /** クレカ明細をリボに回す・戻す */
  toRevolving: (d: Data, e: CardEntry, on: boolean, today: string) => backend.update("card_entries", e.id, { ...revolvingPatch(d.settings, e, on), revolved_at: on ? today : null, locked: true }),
  /** 口座明細を費目ごとの行に分ける */
  async splitAccount(d: Data, e: AccountEntry, parts: { category: string; amount: number }[]) {
    const r = splitRows(d.settings, e, parts);
    await backend.update("account_entries", r.update.id, { ...r.update.patch, locked: true });
    if (r.inserts.length) await backend.insert("account_entries", r.inserts.map((x) => ({ ...x, source: "manual", locked: true })));
  },
  /** ATM で引き出した額を、その日に使ったものとして入れる（財布は持たない） */
  addAtm: (date: string, amount: number) => backend.insert("account_entries", [{ ...atmRow(date, amount), source: "manual", locked: true }]),
  /** v4 から引き継ぐ（設計書 §7.3）。予定の行と調整の行は消し、確定した行は計画とのつながりだけ外す */
  async handover(d: AppData) {
    const h = handover(d.accounts);
    for (const e of h.remove) await backend.remove("account_entries", e.id);
    for (const e of h.unlink) await backend.update("account_entries", e.id, handoverPatch as unknown as Row);
  },
};
