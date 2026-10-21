import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMonths, BASE_KEYS, debitsFor, REPAY, categorize, computeMonth, DEFAULT_SETTINGS, FIXED_DEBIT, findMerges, missingRecurring, RESERVE, ruleFor, todayJST, ymOf, type BaseKey,
  type Balance, type Budget, type CardBill, type Data, type Debt, type Entry, type Recurring, type Rule, type Settings,
} from "../engine";
import { backend, type Raw, type Row } from "./backend";
import { SEED_RULES } from "./seed";

export interface ReviewRow { id: string; kind: string; title: string; body: string; resolved: boolean; created_at: string }
export interface AppData extends Data { review: ReviewRow[] }

const num = (v: unknown) => (v == null || v === "" ? 0 : Math.round(Number(v)) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));
const day = (v: unknown) => str(v).slice(0, 10);

function toData(raw: Raw): AppData {
  const entries: Entry[] = raw.entries.map((r) => ({
    id: str(r.id), kind: r.kind as Entry["kind"], status: r.status as Entry["status"], date: day(r.date), amount: num(r.amount),
    method: r.method as Entry["method"], category: (r.category as string) || null, shop: str(r.shop), item: str(r.item), memo: str(r.memo),
    tatekae: num(r.tatekae), source: r.source as Entry["source"], source_ref: (r.source_ref as string) || null,
    merged_into: (r.merged_into as string) || null, recurring_id: (r.recurring_id as string) || null,
    not_dup: Array.isArray(r.not_dup) ? (r.not_dup as string[]) : [], locked: !!r.locked, card: (r.card as string) || null, at: str(r.created_at) || undefined,
  }));
  const balances: Balance[] = raw.balances.map((r) => ({ id: str(r.id), date: day(r.date), bank: num(r.bank), cash: num(r.cash), paypay: num(r.paypay), memo: str(r.memo), at: str(r.created_at) }));
  const saved = (raw.settings[0]?.data as Partial<Settings>) || {};
  const settings: Settings = { ...DEFAULT_SETTINGS, ...saved };
  if (!settings.cards?.length) settings.cards = DEFAULT_SETTINGS.cards;
  const cardBills: CardBill[] = raw.card_bills.map((r) => ({ id: str(r.id), card: (r.card as string) || settings.cards[0].id, pay_date: day(r.pay_date), amount: num(r.amount) }));
  const recurring: Recurring[] = raw.recurring.map((r) => ({
    id: str(r.id), name: str(r.name), kind: r.kind as Recurring["kind"], category: (r.category as string) || null, amount: num(r.amount),
    day: num(r.day) || 1, shift: (r.shift as Recurring["shift"]) || "next", method: (r.method as Recurring["method"]) || "bank", card: (r.card as string) || null, shop: str(r.shop),
    start_month: (r.start_month as string) || null, end_month: (r.end_month as string) || null, active: r.active !== false,
  }));
  const budgets: Budget[] = raw.budgets.map((r) => ({ month: str(r.month), category: str(r.category), amount: num(r.amount) }));
  const rules: Rule[] = raw.rules.map((r) => ({ id: str(r.id), pattern: str(r.pattern), category: str(r.category) }));
  const debts: Debt[] = [...raw.debts].sort((a, b) => num(a.sort) - num(b.sort)).map((r) => ({
    id: str(r.id), name: str(r.name), balance: num(r.balance), as_of: r.as_of ? day(r.as_of) : null, rate: str(r.rate),
    min_payment: num(r.min_payment), note: str(r.note), planned: !!r.planned,
  }));
  const review: ReviewRow[] = raw.review.map((r) => ({ id: str(r.id), kind: str(r.kind), title: str(r.title), body: str(r.body), resolved: !!r.resolved, created_at: str(r.created_at) }));
  return { entries, balances, cardBills, recurring, budgets, rules, debts, settings, review };
}

const CACHE = "gholdengo.cache.v1";
function saveCache(raw: Raw) { try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), raw })); } catch { /* 容量オーバーなど */ } }
function readCache(): Raw | null { try { return JSON.parse(localStorage.getItem(CACHE) || "null")?.raw ?? null; } catch { return null; } }

/**
 * 読み込んだあとの自動処理。何か書いたら true を返す（読み直す）
 * 0. 古い版のデータを今の形に直す（migrate）
 * 1. 初めての起動なら設定とルールの初めの値を入れる
 * 2. 定期のお金から、今月〜5か月先の予定を作る（3か月先の月の判定に、その先の給与まで要るため）
 * 3. 未分類の明細に、あとから覚えたルールを当てる。そのあと重複を自動でまとめる
 * 4. 今月の費目予算がまだなければ、前の月から引き継いだ値を保存する
 */
/**
 * 版1 → 版2：固定費を「固定引落」1つから、家賃・奨学金・保険・共済などの費目に分けた。
 * 大項目（固定費／変動費）は settings.fixCats / varCats で決める。
 */
async function migrate(raw: Raw, d: AppData): Promise<boolean> {
  const saved = raw.settings[0]?.data as Partial<Settings> | undefined;
  if (!saved || (saved.version ?? 1) >= 2) return false;
  const to = (name: string) => (/家賃/.test(name) ? "家賃" : /奨学金/.test(name) ? "奨学金" : /共済|保険/.test(name) ? "保険・共済" : null);
  let leftover = false;
  for (const e of d.entries) {
    if (e.category !== FIXED_DEBIT) continue;
    const c = to(e.item || e.shop);
    if (c) await backend.update("entries", e.id, { category: c }); else leftover = true;
  }
  for (const r of d.recurring) {
    if (r.category !== FIXED_DEBIT) continue;
    const c = to(r.name);
    if (c) await backend.update("recurring", r.id, { category: c }); else leftover = true;
  }
  for (const b of d.budgets) if (b.category === "#固定費") await backend.removeBudget(b.month, b.category);
  const fix = [...["家賃", "奨学金", "保険・共済"].filter((c) => !d.settings.fixCats.includes(c) && !d.settings.varCats.includes(c)), ...d.settings.fixCats];
  if (leftover && !fix.includes(FIXED_DEBIT)) fix.push(FIXED_DEBIT);
  await backend.upsertKeyed("settings", [{ data: { ...d.settings, fixCats: fix, version: 2 } }]);
  return true;
}

/**
 * 版2 → 版3：クレカを複数持てるようにした（settings.cards）。
 * 前の版のカードの締め日・引落日は1枚目のカードに移す。
 * 名前に「セゾン」とある口座払いの返済は、セゾンの引き落としと一緒に出るので、金種をセゾンのカードにする。
 */
async function migrate3(raw: Raw, d: AppData): Promise<boolean> {
  const saved = raw.settings[0]?.data as (Partial<Settings> & { cardClosingDay?: number; cardPayDay?: number }) | undefined;
  if (!saved || (saved.version ?? 1) !== 2) return false;
  const { cardClosingDay, cardPayDay, ...rest } = saved;
  const cards = DEFAULT_SETTINGS.cards.map((c, i) => (i === 0 ? { ...c, closingDay: cardClosingDay ?? c.closingDay, payDay: cardPayDay ?? c.payDay } : c));
  const saison = cards.find((c) => c.id === "saison");
  if (saison) {
    for (const e of d.entries) if (e.category === REPAY && e.method === "bank" && /セゾン/.test(e.item + e.shop)) await backend.update("entries", e.id, { method: "card", card: saison.id });
    for (const r of d.recurring) if (r.category === REPAY && r.method === "bank" && /セゾン/.test(r.name)) await backend.update("recurring", r.id, { method: "card", card: saison.id });
  }
  await backend.upsertKeyed("settings", [{ data: { ...d.settings, ...rest, cards, version: 3 } }]);
  return true;
}

async function maintain(raw: Raw, d: AppData, today: string): Promise<boolean> {
  if (await migrate(raw, d)) return true;
  if (await migrate3(raw, d)) return true;
  let wrote = false;
  if (!raw.settings.length) { await backend.upsertKeyed("settings", [{ data: DEFAULT_SETTINGS }]); wrote = true; }
  if (!raw.rules.length) { await backend.insert("rules", SEED_RULES.map(([pattern, category]) => ({ pattern, category })), { onConflict: "pattern" }); wrote = true; }

  const cur = ymOf(today);
  const months = [0, 1, 2, 3, 4, 5].map((k) => addMonths(cur, k));
  const missing = missingRecurring(d.recurring, d.entries, months);
  if (missing.length) { await backend.insert("entries", missing as unknown as Row[], { onConflict: "source_ref" }); wrote = true; }

  for (const e of d.entries) {
    if (e.category || e.locked || e.kind !== "expense" || e.merged_into || (e.source !== "card_flash" && e.source !== "card_statement")) continue;
    const c = categorize(e.shop, d.rules);
    if (c) { await backend.update("entries", e.id, { category: c }); wrote = true; }
  }
  // 口座からの自動の引き落とし・入金（定期のお金から作った、金種が口座の予定）は、日付が来たら確定にする
  for (const e of d.entries) {
    if (e.status !== "plan" || e.source !== "recurring" || e.method !== "bank" || e.merged_into || e.date > today) continue;
    await backend.update("entries", e.id, { status: "confirmed" });
    wrote = true;
  }
  // カードの引落日が来たら、請求額がまだなければ見込みの額で確定する（あとから届いた明細で、過ぎた日の残高が変わらないように）
  for (const ym of [addMonths(cur, -1), cur]) {
    for (const c of debitsFor(d, ym).cards) {
      if (c.date > today || c.bill != null || !c.estimate) continue;
      await backend.insert("card_bills", [{ card: c.card.id, pay_date: c.date, amount: c.estimate, source_ref: `auto:${c.card.id}:${c.date}` }], { onConflict: "pay_date" });
      wrote = true;
    }
  }
  if (wrote) return true;

  const { merges } = findMerges(d.entries);
  for (const m of merges) {
    if (Object.keys(m.patch).length) await backend.update("entries", m.keep.id, m.patch as Row);
    await backend.update("entries", m.absorb.id, { merged_into: m.keep.id });
    wrote = true;
  }

  if (!wrote && !d.budgets.some((b) => b.month === cur && !b.category.startsWith("#"))) {
    // 今月の費目予算がまだなければ、前の月から引き継いだ値を今月の分として保存する
    // （あとで前の月の予算を直しても、過ぎた月の予算が変わらないように）
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
      // 自動処理で書いたら読み直す（重複のまとめが段になって続くことがあるので数回まで）
      for (let i = 0; i < 4; i++) {
        if (!(await maintain(raw, toData(raw), today))) break;
        raw = await backend.load();
      }
      saveCache(raw);
      setData(toData(raw));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

export type NewEntry = Pick<Entry, "kind" | "status" | "date" | "amount" | "method" | "category"> & Partial<Pick<Entry, "shop" | "item" | "memo" | "tatekae" | "card">>;

export const actions = {
  addEntry: (e: NewEntry) => backend.insert("entries", [{ shop: "", item: "", memo: "", tatekae: 0, ...e, source: "manual", locked: e.status !== "plan" }]),

  async updateEntry(d: AppData, id: string, patch: Partial<Entry>) {
    const before = d.entries.find((e) => e.id === id);
    const userEdit = patch.category !== undefined || patch.item !== undefined || patch.tatekae !== undefined;
    await backend.update("entries", id, { ...patch, ...(userEdit ? { locked: true } : {}) } as Row);
    // 費目を直したら、そのお店のルールとして覚える
    if (before && patch.category && patch.category !== before.category && before.source !== "manual") {
      const pattern = ruleFor(before.shop);
      if (pattern) await backend.insert("rules", [{ pattern, category: patch.category }], { onConflict: "pattern", merge: true });
    }
  },

  deleteEntry: (id: string) => backend.remove("entries", id),

  /** まとめを取り消し、以後は別のものとして扱う */
  async unmerge(d: AppData, absorbedId: string) {
    const a = d.entries.find((e) => e.id === absorbedId);
    if (!a?.merged_into) return;
    const keep = d.entries.find((e) => e.id === a.merged_into);
    await backend.update("entries", absorbedId, { merged_into: null, not_dup: [...new Set([...a.not_dup, a.merged_into])] });
    if (keep) await backend.update("entries", keep.id, { not_dup: [...new Set([...keep.not_dup, absorbedId])] });
  },

  async merge(keep: Entry, absorb: Entry) {
    const patch: Row = {};
    if (absorb.locked || absorb.source === "manual") { if (absorb.category) patch.category = absorb.category; patch.locked = true; }
    if (!keep.item && absorb.item) patch.item = absorb.item;
    if (!keep.memo && absorb.memo) patch.memo = absorb.memo;
    if (!keep.tatekae && absorb.tatekae) patch.tatekae = absorb.tatekae;
    if (Object.keys(patch).length) await backend.update("entries", keep.id, patch);
    await backend.update("entries", absorb.id, { merged_into: keep.id });
  },

  async notDup(a: Entry, others: Entry[]) {
    await backend.update("entries", a.id, { not_dup: [...new Set([...a.not_dup, ...others.map((o) => o.id)])] });
    for (const o of others) await backend.update("entries", o.id, { not_dup: [...new Set([...o.not_dup, a.id])] });
  },

  /** 予定を確定にする（金額と日付を実際の値にする） */
  confirmPlan: (id: string, amount: number, date: string) => backend.update("entries", id, { status: "confirmed", amount, date, source: "manual", locked: true }),

  /** カードの請求額（確定）を入れる。null なら消して見込みに戻す */
  saveBill: async (card: string, pay_date: string, amount: number | null, id?: string) => {
    if (amount == null) { if (id) await backend.remove("card_bills", id); return; }
    await backend.insert("card_bills", [{ card, pay_date, amount, source_ref: `manual:${card}:${pay_date}` }], { onConflict: "pay_date", merge: true });
  },

  addBalance: (b: Omit<Balance, "id">) => backend.insert("balances", [b as unknown as Row]),

  /**
   * 口座か財布の残高を直す。いまの両方の残高（アプリの計算）を報告として入れ、直したほうだけ本当の額にする。
   * memo に、アプリの計算と本当の額の差を残す（入れ忘れに気づけるように）
   */
  fixBalance: (date: string, now: { bank: number; cash: number }, which: "bank" | "cash", actual: number) => {
    const before = now[which];
    const name = which === "bank" ? "口座" : "財布";
    const diff = actual - before;
    const memo = diff ? `${name}を直した（アプリの計算 ${before.toLocaleString("ja-JP")}円、差 ${diff > 0 ? "+" : ""}${diff.toLocaleString("ja-JP")}円）` : `${name}を確かめた（アプリの計算どおり）`;
    return backend.insert("balances", [{ date, bank: now.bank, cash: now.cash, paypay: 0, memo, [which]: actual }]);
  },

  /** ATMで引き出す：口座から財布へ */
  addAtm: (date: string, amount: number) => backend.insert("entries", [{ kind: "transfer", status: "confirmed", date, amount, method: "bank", category: null, shop: "", item: "ATMで引き出し", memo: "", tatekae: 0, source: "manual", locked: true }]),
  deleteBalance: (id: string) => backend.remove("balances", id),

  async saveBudgets(month: string, map: Record<string, number>) {
    await backend.upsertKeyed("budgets", Object.entries(map).filter(([c]) => c !== RESERVE).map(([category, amount]) => ({ month, category, amount })));
  },

  saveSettings: (s: Settings) => backend.upsertKeyed("settings", [{ data: s }]),

  /** その月の「予算の元」を手で直す。null なら自動（明細と予定から出す値）に戻す */
  saveBase: (month: string, key: BaseKey, amount: number | null) =>
    amount == null ? backend.removeBudget(month, BASE_KEYS[key]) : backend.upsertKeyed("budgets", [{ month, category: BASE_KEYS[key], amount }]),

  async saveRecurring(d: AppData, r: Partial<Recurring> & { id?: string }, today: string) {
    const { id, ...rest } = r;
    if (!id) { await backend.insert("recurring", [rest as Row]); return; }
    await backend.update("recurring", id, rest as Row);
    // まだ予定のままの今月以降の分は、新しい金額・日付で作り直す
    for (const e of d.entries) {
      if (e.recurring_id === id && e.source === "recurring" && e.status === "plan" && !e.merged_into && e.date >= today.slice(0, 7)) await backend.remove("entries", e.id);
    }
  },
  async deleteRecurring(d: AppData, id: string, today: string) {
    for (const e of d.entries) if (e.recurring_id === id && e.source === "recurring" && e.status === "plan" && !e.merged_into && e.date >= today) await backend.remove("entries", e.id);
    await backend.remove("recurring", id);
  },

  saveDebt: (x: Partial<Debt> & { id?: string }) => (x.id ? backend.update("debts", x.id, (({ id: _id, ...rest }) => rest)(x) as Row) : backend.insert("debts", [x as Row])),
  deleteDebt: (id: string) => backend.remove("debts", id),

  saveRule: (pattern: string, category: string) => backend.insert("rules", [{ pattern, category }], { onConflict: "pattern", merge: true }),
  deleteRule: (id: string) => backend.remove("rules", id),

  resolveReview: (id: string) => backend.update("review", id, { resolved: true }),

  /** 移行用の JSON（format: gholdengo-import-v1）を取り込む。2回取り込んでも二重にならない */
  async importJson(d: AppData, json: ImportFile): Promise<string> {
    if (json.format !== "gholdengo-import-v1") throw new Error("取り込める形のファイルではありません");
    const has = (xs: { [k: string]: unknown }[], k: string, v: unknown) => xs.some((x) => x[k] === v);
    await backend.insert("entries", json.entries ?? [], { onConflict: "source_ref" });
    const balances = (json.balances ?? []).filter((b) => !d.balances.some((x) => x.date === b.date && x.bank === b.bank));
    await backend.insert("balances", balances);
    await backend.insert("card_bills", json.card_bills ?? [], { onConflict: "pay_date", merge: true });
    const rec = (json.recurring ?? []).filter((r) => !has(d.recurring as never, "name", r.name));
    await backend.insert("recurring", rec);
    const debts = (json.debts ?? []).filter((x) => !has(d.debts as never, "name", x.name));
    await backend.insert("debts", debts);
    await backend.upsertKeyed("budgets", json.budgets ?? []);
    if (json.rules?.length) await backend.insert("rules", json.rules, { onConflict: "pattern" });
    if (json.settings) await backend.upsertKeyed("settings", [{ data: { ...d.settings, ...json.settings } }]);
    return `明細・予定 ${json.entries?.length ?? 0}件、残高 ${balances.length}件、定期 ${rec.length}件、借金 ${debts.length}件を取り込みました`;
  },
};

export interface ImportFile {
  format: string;
  entries?: Row[];
  balances?: (Row & { date: string; bank: number })[];
  card_bills?: Row[];
  recurring?: (Row & { name: string })[];
  budgets?: Row[];
  debts?: (Row & { name: string })[];
  rules?: Row[];
  settings?: Partial<Settings>;
}
