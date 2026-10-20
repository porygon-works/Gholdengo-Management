import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// データの置き場所。Supabase の設定があれば Supabase、なければブラウザの中（お試しモード）

export type Table = "entries" | "balances" | "card_bills" | "recurring" | "budgets" | "rules" | "debts" | "settings" | "review";
export const TABLES: Table[] = ["entries", "balances", "card_bills", "recurring", "budgets", "rules", "debts", "settings", "review"];

export type Row = Record<string, unknown>;
export type Raw = Record<Table, Row[]>;

export interface Backend {
  mode: "supabase" | "local";
  load(): Promise<Raw>;
  /** onConflict の列が同じ行がすでにあれば、何もしない（ignore）か上書き（merge）する */
  insert(t: Table, rows: Row[], opts?: { onConflict?: string; merge?: boolean }): Promise<void>;
  update(t: Table, id: string, patch: Row): Promise<void>;
  remove(t: Table, id: string): Promise<void>;
  /** budgets と settings のように id のない表の書き込み */
  upsertKeyed(t: "budgets" | "settings", rows: Row[]): Promise<void>;
  removeBudget(month: string, category: string): Promise<void>;
}

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = URL && KEY ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

const check = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

function supabaseBackend(sb: SupabaseClient): Backend {
  const uid = async () => (await sb.auth.getUser()).data.user?.id;
  return {
    mode: "supabase",
    async load() {
      const out = {} as Raw;
      await Promise.all(TABLES.map(async (t) => {
        // 1000行ずつ全部読む
        const rows: Row[] = [];
        for (let from = 0; ; from += 1000) {
          const r = await sb.from(t).select("*").range(from, from + 999);
          check(r);
          rows.push(...(r.data as Row[]));
          if ((r.data?.length ?? 0) < 1000) break;
        }
        out[t] = rows;
      }));
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
      check(await sb.from(t).upsert(rows.map((r) => ({ ...r, user_id })), { onConflict: t === "budgets" ? "user_id,month,category" : "user_id" }));
    },
    async removeBudget(month, category) { check(await sb.from("budgets").delete().eq("month", month).eq("category", category)); },
  };
}

// ---------- お試しモード（localStorage） ----------

const LS = "gholdengo.local.v1";
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

function readLocal(): Raw {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || "null");
    if (v) return { ...Object.fromEntries(TABLES.map((t) => [t, []])), ...v } as Raw;
  } catch { /* 読めなければ空から */ }
  return Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Raw;
}
function writeLocal(d: Raw) { try { localStorage.setItem(LS, JSON.stringify(d)); } catch { /* 保存できない環境 */ } }

const ENTRY_DEFAULTS = { shop: "", item: "", memo: "", tatekae: 0, merged_into: null, recurring_id: null, not_dup: [], locked: false, source_ref: null };

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
        d[t].push({ ...(t === "entries" ? ENTRY_DEFAULTS : {}), id: uuid(), created_at: new Date().toISOString(), ...r });
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
      if (t === "entries") for (const e of d.entries) if (e.merged_into === id) e.merged_into = null;
      writeLocal(d);
    },
    async upsertKeyed(t, rows) {
      const d = readLocal();
      for (const r of rows) {
        const i = t === "budgets" ? d.budgets.findIndex((x) => x.month === r.month && x.category === r.category) : 0;
        if (t === "settings") d.settings = [{ ...(d.settings[0] || {}), ...r }];
        else if (i >= 0) d.budgets[i] = { ...d.budgets[i], ...r };
        else d.budgets.push(r);
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
