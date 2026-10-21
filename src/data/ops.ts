import { budgetsFor, groupOfCat, type AccountEntry, type CardEntry, type Goal, type Recurring } from "../engine";
import { backend, type Row } from "./backend";
import { actions, type AppData } from "./store";

// Claude と相談して決めた内容を取り込む JSON（format: gholdengo-ops-v1）。書き方は docs/OPS.md

export type OpsTable = "budgets" | "goals" | "recurring" | "rules" | "account_entries" | "card_entries" | "balances" | "settings";

export interface Op {
  op: "set" | "delete";
  table: OpsTable;
  key?: Record<string, unknown>;
  data?: Record<string, unknown>;
}
export interface OpsFile { format: string; note?: string; ops: Op[] }

/** 取り込む前に見せる1件の変更。apply で実行する */
export interface Change {
  label: string; // 画面に出す説明
  kind: "add" | "update" | "delete";
  table: OpsTable;
  id?: string; // 直す・消す行
  key?: Record<string, unknown>;
  data: Record<string, unknown>;
}

/** 表ごとに、書いてよい列（ほかの列は無視せずエラーにする。user_id や deleted などを書かせないため） */
const FIELDS: Record<OpsTable, string[]> = {
  budgets: ["amount"],
  goals: ["kind", "name", "card", "balance", "as_of", "target", "monthly", "day", "start_month", "end_month", "lumps", "active", "sort"],
  recurring: ["name", "kind", "group", "category", "amount", "day", "shift", "pay", "card", "shop", "every", "start_month", "end_month", "active"],
  rules: ["pattern", "category"],
  account_entries: ["account", "direction", "status", "group", "category", "name", "memo", "date", "amount"],
  card_entries: ["card", "status", "date", "amount", "group", "category", "name", "shop", "memo", "tatekae"],
  balances: ["date", "bank", "cash", "memo"],
  settings: ["safety", "payday", "salaryEstimate", "varCats", "fixCats", "dailyCats", "cards", "labels", "carryFrom", "budgetDefault"],
};
const NAME: Record<OpsTable, string> = { budgets: "予算", goals: "目標", recurring: "定期", rules: "ルール", account_entries: "口座明細", card_entries: "クレカ明細", balances: "残高", settings: "設定" };

/** 金額の項目だけ ¥ をつける */
const MONEY = ["amount", "balance", "target", "monthly", "bank", "cash", "safety", "salaryEstimate", "tatekae"];
const fmt = (v: unknown, k = "amount") => (typeof v === "number" ? (MONEY.includes(k) ? `¥${v.toLocaleString("ja-JP")}` : String(v)) : Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : v == null ? "なし" : String(v));
const diff = (before: Record<string, unknown>, data: Record<string, unknown>) =>
  Object.entries(data).filter(([k, v]) => JSON.stringify(before[k]) !== JSON.stringify(v)).map(([k, v]) => `${k}：${fmt(before[k], k)} → ${fmt(v, k)}`).join("、");

/**
 * JSON を読んで、取り込むとどう変わるかを出す（まだ何も書かない）。
 * 読めないところは errors に入れる。errors があるときは、取り込まない
 */
export function planOps(d: AppData, json: unknown): { note: string; changes: Change[]; errors: string[] } {
  const errors: string[] = [], changes: Change[] = [];
  const f = json as OpsFile;
  if (!f || f.format !== "gholdengo-ops-v1" || !Array.isArray(f.ops)) return { note: "", changes, errors: ["format が gholdengo-ops-v1 で、ops が並んでいるファイルではありません"] };
  f.ops.forEach((o, i) => {
    const at = `${i + 1}件目`;
    if (!o || (o.op !== "set" && o.op !== "delete") || !FIELDS[o.table]) { errors.push(`${at}：op は set か delete、table は ${Object.keys(FIELDS).join("・")} のどれか`); return; }
    const data = o.data ?? {};
    const bad = Object.keys(data).filter((k) => !FIELDS[o.table].includes(k));
    if (bad.length) { errors.push(`${at}：${NAME[o.table]}に書けない項目 ${bad.join("・")}`); return; }
    const key = o.key ?? {};
    const t = o.table;

    if (t === "settings") {
      if (o.op === "delete") { errors.push(`${at}：設定は消せません`); return; }
      const before = d.settings as unknown as Record<string, unknown>;
      changes.push({ label: `設定を直す（${diff(before, data) || "変わらない"}）`, kind: "update", table: t, data });
      return;
    }
    if (t === "budgets") {
      const month = String(key.month ?? ""), category = String(key.category ?? "");
      if (!/^\d{4}-\d{2}$/.test(month) || !category) { errors.push(`${at}：予算の key は { month: "YYYY-MM", category }`); return; }
      const own = d.budgets.find((b) => b.month === month && b.category === category);
      if (o.op === "delete") { if (!own) { errors.push(`${at}：${month} の ${category} の予算はありません`); return; } changes.push({ label: `予算 ${month} ${category} を消す（引き継ぎに戻す）`, kind: "delete", table: t, key: { month, category }, data: {} }); return; }
      if (typeof data.amount !== "number") { errors.push(`${at}：予算の data は { amount: 数 }`); return; }
      const now = own?.amount ?? (category.startsWith("#") ? undefined : budgetsFor(d, month).get(category));
      changes.push({ label: `予算 ${month} ${category}：${now == null ? "なし" : fmt(now)} → ${fmt(data.amount)}`, kind: own ? "update" : "add", table: t, key: { month, category }, data });
      return;
    }
    if (t === "balances") {
      if (o.op === "delete") {
        const b = d.balances.find((x) => x.id === key.id);
        if (!b) { errors.push(`${at}：残高の記録 ${String(key.id)} はありません`); return; }
        changes.push({ label: `残高の記録 ${b.date} を消す`, kind: "delete", table: t, id: b.id, data: {} });
        return;
      }
      if (typeof data.date !== "string" || typeof data.bank !== "number") { errors.push(`${at}：残高は data に date と bank（財布は cash）`); return; }
      changes.push({ label: `残高を入れる ${data.date}：口座 ${fmt(data.bank)}${typeof data.cash === "number" ? `・財布 ${fmt(data.cash)}` : ""}`, kind: "add", table: t, data });
      return;
    }

    // ほかの表は、key に id か、名前（目標・定期）・pattern（ルール）・ref（明細の source_ref）で行を決める
    const rows: { id: string; label: string; row: Record<string, unknown> }[] =
      t === "goals" ? d.goals.map((g) => ({ id: g.id, label: g.name, row: g as unknown as Record<string, unknown> }))
        : t === "recurring" ? d.recurring.map((r) => ({ id: r.id, label: r.name, row: r as unknown as Record<string, unknown> }))
          : t === "rules" ? d.rules.map((r) => ({ id: r.id, label: r.pattern, row: r as unknown as Record<string, unknown> }))
            : t === "account_entries" ? d.accounts.map((e) => ({ id: e.id, label: `${e.date} ${e.name || e.category || ""}`, row: e as unknown as Record<string, unknown> }))
              : d.cards.map((e) => ({ id: e.id, label: `${e.date} ${e.name || e.shop || e.category || ""}`, row: e as unknown as Record<string, unknown> }));
    const nameKey = t === "goals" || t === "recurring" ? "name" : t === "rules" ? "pattern" : "ref";
    const rowKey = nameKey === "ref" ? "source_ref" : nameKey;
    if (key.id == null && key[nameKey] == null) { errors.push(`${at}：${NAME[t]}の key は { id } か { ${nameKey} }`); return; }
    const hits = rows.filter((r) => (key.id != null ? r.id === key.id : r.row[rowKey] === key[nameKey]));
    if (hits.length > 1) { errors.push(`${at}：${NAME[t]}「${String(key[nameKey])}」が ${hits.length}件あります。id で指定してください`); return; }
    const hit = hits[0];
    if (o.op === "delete") {
      if (!hit) { errors.push(`${at}：消す${NAME[t]}「${String(key.id ?? key[nameKey])}」がありません`); return; }
      changes.push({ label: `${NAME[t]}「${hit.label}」を消す`, kind: "delete", table: t, id: hit.id, data: {} });
      return;
    }
    if (hit) { changes.push({ label: `${NAME[t]}「${hit.label}」を直す（${diff(hit.row, data) || "変わらない"}）`, kind: "update", table: t, id: hit.id, key, data }); return; }
    if (key.id != null) { errors.push(`${at}：${NAME[t]}の id ${String(key.id)} はありません（足すときは id ではなく ${nameKey} で指定）`); return; }
    const need: Record<string, string[]> = { goals: ["kind"], recurring: ["kind", "amount", "day"], rules: ["category"], account_entries: ["date", "amount", "direction", "group"], card_entries: ["date", "amount"] };
    const miss = (need[t] ?? []).filter((k) => data[k] == null);
    if (miss.length) { errors.push(`${at}：${NAME[t]}を足すには ${miss.join("・")} が要ります`); return; }
    changes.push({ label: `${NAME[t]}「${String(key[nameKey])}」を足す（${Object.entries(data).map(([k, v]) => `${k}：${fmt(v, k)}`).join("、")}）`, kind: "add", table: t, key, data });
  });
  return { note: f.note ?? "", changes, errors };
}

/** planOps で出した変更を書く。予定づくりなどの決め方は、画面から直したときと同じ */
export async function applyOps(d: AppData, changes: Change[], today: string) {
  for (const c of changes) {
    const data = c.data;
    switch (c.table) {
      case "settings": await actions.saveSettings({ ...d.settings, ...data }); break;
      case "budgets":
        if (c.kind === "delete") await backend.removeBudget(String(c.key!.month), String(c.key!.category));
        else await backend.upsertKeyed("budgets", [{ month: c.key!.month, category: c.key!.category, amount: data.amount }]);
        break;
      case "balances":
        if (c.kind === "delete") await actions.deleteBalance(c.id!);
        else await backend.insert("balances", [{ date: data.date, bank: data.bank, cash: data.cash ?? 0, paypay: 0, memo: data.memo ?? "Claude との相談から" }]);
        break;
      case "goals":
        if (c.kind === "delete") await actions.deleteGoal(d, c.id!, today);
        else await actions.saveGoal(d, { ...(c.kind === "add" ? { name: String(c.key!.name), lumps: [], active: true } : {}), ...(data as Partial<Goal>), ...(c.id ? { id: c.id } : {}) }, today);
        break;
      case "recurring":
        if (c.kind === "delete") await actions.deleteRecurring(d, c.id!, today);
        else await actions.saveRecurring(d, { ...(c.kind === "add" ? { name: String(c.key!.name), shift: "next" as const, pay: "bank" as const, every: 1, active: true, shop: "" } : {}), ...(data as Partial<Recurring>), ...(c.id ? { id: c.id } : {}) }, today);
        break;
      case "rules":
        if (c.kind === "delete") await actions.deleteRule(c.id!);
        else if (c.id) await backend.update("rules", c.id, data as Row);
        else await actions.saveRule(String(c.key!.pattern), String(data.category));
        break;
      case "account_entries":
      case "card_entries": {
        const card = c.table === "card_entries";
        if (c.kind === "delete") { await (card ? actions.deleteCard(d, c.id!) : actions.deleteAccount(d, c.id!)); break; }
        // 費目があって大費目がなければ、費目から決める
        const patch: Row = { ...data };
        if (data.category && !data.group && (card || data.direction === "out")) patch.group = groupOfCat(d.settings, String(data.category));
        if (c.id) { await backend.update(c.table, c.id, { ...patch, locked: true }); break; }
        const base = card
          ? { card: d.settings.cards[0].id, status: "plan", group: "variable", category: null, name: "", shop: "", memo: "", tatekae: 0 } satisfies Partial<CardEntry>
          : { account: "bank", status: "plan", category: null, name: "", memo: "" } satisfies Partial<AccountEntry>;
        await backend.insert(c.table, [{ ...base, ...patch, source: "manual", source_ref: c.key!.ref, locked: true }], { onConflict: "source_ref" });
        break;
      }
    }
  }
}

