import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// データの置き場所。Supabase の設定があれば Supabase、なければブラウザの中（お試しモード）

// entries・card_bills・debts は前の版（v2）の表。新しい表（account_entries・card_entries・goals）へ写すために読む
export type Table = "account_entries" | "card_entries" | "goals" | "entries" | "balances" | "card_bills" | "recurring" | "budgets" | "rules" | "debts" | "settings" | "review" | V4Table;
/** v4 の表（0007_plans_months.sql）。まだ作っていなければ空として読む */
export type V4Table = "plans" | "plan_debts" | "plan_funds" | "months";
export const V4_TABLES: V4Table[] = ["plans", "plan_debts", "plan_funds", "months"];
/** 書くだけで読まない表（Claude が読むための書き出し） */
export type WriteOnly = "snapshots";
export const TABLES: Table[] = ["account_entries", "card_entries", "goals", "entries", "balances", "card_bills", "recurring", "budgets", "rules", "debts", "settings", "review", ...V4_TABLES];

export type Row = Record<string, unknown>;
export type Raw = Record<Table, Row[]> & { missing?: V4Table[] };

export interface Backend {
  mode: "supabase" | "local";
  load(): Promise<Raw>;
  /** onConflict の列が同じ行がすでにあれば、何もしない（ignore）か上書き（merge）する */
  insert(t: Table, rows: Row[], opts?: { onConflict?: string; merge?: boolean }): Promise<void>;
  update(t: Table, id: string, patch: Row): Promise<void>;
  remove(t: Table, id: string): Promise<void>;
  /** budgets・settings・snapshots のように id のない表の書き込み */
  upsertKeyed(t: "budgets" | "settings" | "months" | WriteOnly, rows: Row[]): Promise<void>;
  removeBudget(month: string, category: string): Promise<void>;
}

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Supabase プロジェクト porygon-works には複数のアプリの DB があるので、この家計簿の表は ggmg スキーマに置く */
export const SCHEMA = "ggmg";

export const supabase = (URL && KEY
  ? createClient(URL, KEY, { db: { schema: SCHEMA }, auth: { persistSession: true, autoRefreshToken: true } })
  : null) as SupabaseClient | null;

const check = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

function supabaseBackend(sb: SupabaseClient): Backend {
  const uid = async () => (await sb.auth.getUser()).data.user?.id;
  return {
    mode: "supabase",
    async load() {
      const out = {} as Raw;
      const missing: V4Table[] = [];
      await Promise.all(TABLES.map(async (t) => {
        // 1000行ずつ全部読む
        const rows: Row[] = [];
        for (let from = 0; ; from += 1000) {
          const r = await sb.from(t).select("*").range(from, from + 999);
          // v4 の表がまだなければ（SQL を流す前）、空として読む
          if (r.error && (V4_TABLES as string[]).includes(t)) { missing.push(t as V4Table); break; }
          check(r);
          rows.push(...(r.data as Row[]));
          if ((r.data?.length ?? 0) < 1000) break;
        }
        out[t] = rows;
      }));
      if (missing.length) out.missing = missing;
      return out;
    },
    async insert(t, rows, opts) {
      if (!rows.length) return;
      const user_id = await uid();
      const data = rows.map((r) => ({ ...r, user_id }));
      const q = opts?.onConflict ? sb.from(t).upsert(data, { onConflict: `user_id,${opts.onConflict}`, ignoreDuplicates: !opts.merge }) : sb.from(t).insert(data);
      check(await q);
    },
    async update(t, id, patch) { check(await sb.from(t).update(patch).eq("id", id)); },
    async remove(t, id) { check(await sb.from(t).delete().eq("id", id)); },
    async upsertKeyed(t, rows) {
      if (!rows.length) return;
      const user_id = await uid();
      check(await sb.from(t).upsert(rows.map((r) => ({ ...r, user_id })), { onConflict: t === "budgets" ? "user_id,month,category" : t === "months" ? "user_id,month" : "user_id" }));
    },
    async removeBudget(month, category) { check(await sb.from("budgets").delete().eq("month", month).eq("category", category)); },
  };
}

// ---------- お試しモード（localStorage） ----------

const LS = "gholdengo.local.v1";
export const newId = () => uuid();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

function readLocal(): Raw {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || "null");
    if (v) return { ...Object.fromEntries(TABLES.map((t) => [t, []])), ...v } as Raw;
  } catch { /* 読めなければ空から */ }
  return Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Raw;
}
function writeLocal(d: Raw) { try { localStorage.setItem(LS, JSON.stringify(d)); } catch { /* 保存できない環境 */ } }

const DEFAULTS: Partial<Record<Table, Row>> = {
  entries: { card: null, shop: "", item: "", memo: "", tatekae: 0, merged_into: null, recurring_id: null, not_dup: [], locked: false, source_ref: null },
  account_entries: { account: "bank", category: null, name: "", memo: "", source: "manual", source_ref: null, recurring_id: null, goal_id: null, card: null, pair_id: null, locked: false },
  card_entries: { card: "smbc", group: "variable", category: null, name: "", shop: "", memo: "", tatekae: 0, source: "manual", source_ref: null, merged_into: null, not_dup: [], locked: false, recurring_id: null, goal_id: null },
  goals: { card: null, balance: 0, as_of: null, target: 0, monthly: 0, day: 27, start_month: null, end_month: null, lumps: [], active: true, sort: 0, source_ref: null },
  plans: { name: "", use_date: null, target: 0, done: false, sort: 0 },
  plan_debts: { name: "", balance: 0, sort: 0 },
  plan_funds: { name: "", budget_month: null, amount: 0, status: "plan" },
};

function localBackend(): Backend {
  return {
    mode: "local",
    async load() { return readLocal(); },
    async insert(t, rows, opts) {
      const d = readLocal();
      for (const r of rows) {
        const key = opts?.onConflict;
        const hit = key && r[key] != null ? d[t].find((x) => x[key] === r[key]) : undefined;
        if (hit) { if (opts?.merge) Object.assign(hit, r); continue; }
        d[t].push({ ...(DEFAULTS[t] ?? {}), id: uuid(), created_at: new Date().toISOString(), ...r });
      }
      writeLocal(d);
    },
    async update(t, id, patch) {
      const d = readLocal();
      const hit = d[t].find((x) => x.id === id);
      if (hit) Object.assign(hit, patch);
      writeLocal(d);
    },
    async remove(t, id) {
      const d = readLocal();
      d[t] = d[t].filter((x) => x.id !== id);
      if (t === "entries" || t === "card_entries") for (const e of d[t]) if (e.merged_into === id) e.merged_into = null;
      // 計画を消したら、残高と確保額に入れる分も消し、取引のつながりを外す（Supabase の on delete と同じ）
      if (t === "plans") {
        d.plan_debts = d.plan_debts.filter((x) => x.plan_id !== id);
        d.plan_funds = d.plan_funds.filter((x) => x.plan_id !== id);
        for (const e of d.account_entries) if (e.plan_id === id) { e.plan_id = null; e.debt_id = null; }
      }
      if (t === "plan_debts") for (const e of d.account_entries) if (e.debt_id === id) e.debt_id = null;
      writeLocal(d);
    },
    async upsertKeyed(t, rows) {
      const d = readLocal();
      if (t === "snapshots") { (d as unknown as Record<string, Row[]>).snapshots = rows.slice(-1); writeLocal(d); return; }
      for (const r of rows) {
        if (t === "settings") { d.settings = [{ ...(d.settings[0] || {}), ...r }]; continue; }
        const list = t === "months" ? d.months : d.budgets;
        const i = list.findIndex((x) => x.month === r.month && (t === "months" || x.category === r.category));
        if (i >= 0) list[i] = { ...list[i], ...r };
        else list.push(r);
      }
      writeLocal(d);
    },
    async removeBudget(month, category) {
      const d = readLocal();
      d.budgets = d.budgets.filter((x) => !(x.month === month && x.category === category));
      writeLocal(d);
    },
  };
}

export const backend: Backend = supabase ? supabaseBackend(supabase) : localBackend();

/** お試しモードのデータを消す */
export function resetLocal() { try { localStorage.removeItem(LS); } catch { /* なし */ } }
