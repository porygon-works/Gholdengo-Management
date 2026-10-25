import { budgetsFor, groupOfCat, monthBudget, todayJST, type AccountEntry, type CardEntry, type Data, type PlanMove, type Recurring, type V5Plan } from "../engine";
import { backend, type Row } from "./backend";
import { actions, actions5, type AppData } from "./store";

// Claude と相談して決めた内容を取り込む JSON（format: gholdengo-ops-v2）。書き方は docs/OPS.md

export const OPS_FORMAT = "gholdengo-ops-v2";
export type OpsTable = "budgets" | "v5_months" | "v5_plans" | "v5_loans" | "v5_loan_balances" | "v5_moves" | "recurring" | "rules" | "account_entries" | "card_entries" | "balances" | "settings";

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
  v5_months: ["budget"],
  v5_plans: ["kind", "name", "target", "due_date", "monthly", "start_month", "draw_order", "no_draw", "done", "sort"],
  v5_loans: ["name", "card", "monthly", "pay_day", "plan"],
  v5_loan_balances: ["loan", "date", "balance"],
  v5_moves: ["plan", "kind", "amount", "date", "bonus_ref", "memo"],
  recurring: ["name", "kind", "group", "category", "amount", "day", "shift", "pay", "card", "shop", "every", "start_month", "end_month", "active"],
  rules: ["pattern", "category"],
  account_entries: ["account", "direction", "status", "group", "category", "name", "memo", "date", "amount"],
  card_entries: ["card", "status", "date", "amount", "group", "category", "name", "shop", "memo", "tatekae"],
  balances: ["date", "bank", "cash", "memo"],
  settings: ["safety", "payday", "salaryEstimate", "varCats", "fixCats", "dailyCats", "cards", "labels"],
};
const NAME: Record<OpsTable, string> = { budgets: "費目の予算", v5_months: "月の予算", v5_plans: "計画", v5_loans: "借入", v5_loan_balances: "借入残高", v5_moves: "計画のお金の出し入れ", recurring: "定期", rules: "ルール", account_entries: "口座明細", card_entries: "クレカ明細", balances: "残高", settings: "設定" };

/** 金額の項目だけ ¥ をつける */
const MONEY = ["amount", "balance", "target", "monthly", "bank", "cash", "safety", "salaryEstimate", "tatekae", "budget"];
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
  if (f?.format === "gholdengo-ops-v1") return { note: "", changes, errors: [`古い形式です（gholdengo-ops-v1）。docs/OPS.md の ${OPS_FORMAT} で書いてください`] };
  if (!f || f.format !== OPS_FORMAT || !Array.isArray(f.ops)) return { note: "", changes, errors: [`format が ${OPS_FORMAT} で、ops が並んでいるファイルではありません`] };
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
    if (t === "v5_months") {
      const month = String(key.month ?? "");
      if (!/^\d{4}-\d{2}$/.test(month)) { errors.push(`${at}：月の予算の key は { month: "YYYY-MM" }`); return; }
      const b = monthBudget(d, month);
      if (o.op === "delete" || data.budget == null) { changes.push({ label: `${month} の予算を目安額（${fmt(b.guide.amount)}）に戻す`, kind: "delete", table: t, key: { month }, data: {} }); return; }
      if (typeof data.budget !== "number") { errors.push(`${at}：月の予算の data は { budget: 数 }（null で目安額に戻す）`); return; }
      changes.push({ label: `${month} の予算：${fmt(b.amount)} → ${fmt(data.budget)}（目安額 ${fmt(b.guide.amount)}）`, kind: b.source === "decided" ? "update" : "add", table: t, key: { month }, data });
      return;
    }
    if (t === "v5_loan_balances") {
      if (o.op === "delete") { errors.push(`${at}：借入残高の記録は消せません（新しい額を入れてください）`); return; }
      const loan = d.v5.loans.find((l) => l.name === data.loan);
      if (!loan || typeof data.date !== "string" || typeof data.balance !== "number") { errors.push(`${at}：借入残高は data に loan（借入の名前）・date・balance`); return; }
      changes.push({ label: `借入「${loan.name}」の残高を ${data.date} に ${fmt(data.balance)} にする`, kind: "add", table: t, data: { loan_id: loan.id, date: data.date, balance: data.balance } });
      return;
    }
    if (t === "v5_moves") {
      if (o.op === "delete") {
        const m = d.v5.moves.find((x) => x.id === key.id);
        if (!m) { errors.push(`${at}：計画のお金の出し入れ ${String(key.id)} はありません`); return; }
        changes.push({ label: `計画のお金の出し入れ（${m.date} ${fmt(m.amount)}）を消す`, kind: "delete", table: t, id: m.id, data: {} });
        return;
      }
      const plan = d.v5.plans.find((p) => p.name === data.plan);
      if (!plan || plan.kind === "repay") { errors.push(`${at}：plan は購入・貯蓄の計画の名前`); return; }
      if (!["manual", "bonus", "draw"].includes(String(data.kind)) || typeof data.amount !== "number" || typeof data.date !== "string") { errors.push(`${at}：data は kind（manual・bonus・draw）・amount・date`); return; }
      const bonus = data.kind === "bonus" ? d.accounts.find((e) => e.source_ref === data.bonus_ref || e.id === data.bonus_ref) : undefined;
      if (data.kind === "bonus" && !bonus) { errors.push(`${at}：bonus_ref の賞与（口座明細の ref か id）がありません`); return; }
      const what = { manual: "余裕額から入れる", bonus: "賞与からの配分", draw: "取り崩す" }[String(data.kind) as "manual" | "bonus" | "draw"];
      changes.push({ label: `計画「${plan.name}」：${what} ${fmt(data.amount)}（${data.date}）`, kind: "add", table: t, data: { plan_id: plan.id, kind: data.kind, amount: data.amount, date: data.date, bonus_entry_id: bonus?.id ?? null, entry_kind: null, entry_id: null, memo: data.memo ?? "" } });
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
      t === "v5_plans" ? d.v5.plans.map((g) => ({ id: g.id, label: g.name, row: g as unknown as Record<string, unknown> }))
        : t === "v5_loans" ? d.v5.loans.map((g) => ({ id: g.id, label: g.name, row: g as unknown as Record<string, unknown> }))
        : t === "recurring" ? d.recurring.map((r) => ({ id: r.id, label: r.name, row: r as unknown as Record<string, unknown> }))
          : t === "rules" ? d.rules.map((r) => ({ id: r.id, label: r.pattern, row: r as unknown as Record<string, unknown> }))
            : t === "account_entries" ? d.accounts.map((e) => ({ id: e.id, label: `${e.date} ${e.name || e.category || ""}`, row: e as unknown as Record<string, unknown> }))
              : d.cards.map((e) => ({ id: e.id, label: `${e.date} ${e.name || e.shop || e.category || ""}`, row: e as unknown as Record<string, unknown> }));
    const nameKey = t === "v5_plans" || t === "v5_loans" || t === "recurring" ? "name" : t === "rules" ? "pattern" : "ref";
    if (t === "v5_loans" && data.plan != null) {
      const p = d.v5.plans.find((x) => x.name === data.plan && x.kind === "repay");
      if (!p) { errors.push(`${at}：plan は返済の計画の名前`); return; }
    }
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
    const need: Record<string, string[]> = { v5_plans: ["kind"], v5_loans: [], recurring: ["kind", "amount", "day"], rules: ["category"], account_entries: ["date", "amount", "direction", "group"], card_entries: ["date", "amount"] };
    const miss = (need[t] ?? []).filter((k) => data[k] == null);
    if (miss.length) { errors.push(`${at}：${NAME[t]}を足すには ${miss.join("・")} が要ります`); return; }
    changes.push({ label: `${NAME[t]}「${String(key[nameKey])}」を足す（${Object.entries(data).map(([k, v]) => `${k}：${fmt(v, k)}`).join("、")}）`, kind: "add", table: t, key, data });
  });
  return { note: f.note ?? "", changes, errors };
}

const newPlan = (d: Data, name: string): Omit<V5Plan, "id"> => ({ kind: "save", name, target: 0, due_date: null, monthly: 0, start_month: null, draw_order: d.v5.plans.length + 1, no_draw: false, done: false, sort: d.v5.plans.length });

/**
 * planOps で出した変更を、保存せずに Data の写しに当てる（取り込む前に、余裕額などがどう変わるかを出すため）。
 * 定期・ルールは、予定づくりなどが保存のときに動くので、ここでは当てない
 */
export function simulateOps(d: Data, changes: Change[]): Data {
  const x: Data = { ...d, accounts: [...d.accounts], cards: [...d.cards], balances: [...d.balances], budgets: [...d.budgets], settings: { ...d.settings }, v5: { plans: [...d.v5.plans], loans: [...d.v5.loans], balances: [...d.v5.balances], moves: [...d.v5.moves], months: [...d.v5.months] } };
  changes.forEach((c, i) => {
    const id = c.id ?? `sim:${i}`;
    const data = c.data;
    const upsert = <T extends { id: string }>(list: T[], row: T) => { const k = list.findIndex((r) => r.id === row.id); if (k >= 0) list[k] = { ...list[k], ...row }; else list.push(row); };
    switch (c.table) {
      case "settings": x.settings = { ...x.settings, ...data }; break;
      case "budgets": x.budgets = [...x.budgets.filter((b) => !(b.month === c.key!.month && b.category === c.key!.category)), ...(c.kind === "delete" ? [] : [{ month: String(c.key!.month), category: String(c.key!.category), amount: Number(data.amount) }])]; break;
      case "v5_months": x.v5.months = [...x.v5.months.filter((m) => m.month !== c.key!.month), ...(c.kind === "delete" ? [] : [{ month: String(c.key!.month), budget: Number(data.budget), source: "decided" as const }])]; break;
      case "v5_plans": if (c.kind === "delete") x.v5.plans = x.v5.plans.filter((p) => p.id !== id); else upsert(x.v5.plans, { ...(c.id ? x.v5.plans.find((p) => p.id === id)! : newPlan(x, String(c.key!.name))), ...(data as Partial<V5Plan>), id }); break;
      case "v5_loans": { const { plan, ...rest } = data; if (c.kind === "delete") x.v5.loans = x.v5.loans.filter((l) => l.id !== id); else upsert(x.v5.loans, { ...(x.v5.loans.find((l) => l.id === id) ?? { plan_id: null, name: String(c.key!.name), card: null, monthly: 0, pay_day: null, sort: 0 }), ...rest, ...(plan !== undefined ? { plan_id: x.v5.plans.find((p) => p.name === plan)?.id ?? null } : {}), id } as never); break; }
      case "v5_loan_balances": x.v5.balances.push({ id, loan_id: String(data.loan_id), date: String(data.date), balance: Number(data.balance), at: new Date().toISOString() }); break;
      case "v5_moves": if (c.kind === "delete") x.v5.moves = x.v5.moves.filter((m) => m.id !== id); else x.v5.moves.push({ ...(data as unknown as PlanMove), id }); break;
      case "balances": if (c.kind === "delete") x.balances = x.balances.filter((b) => b.id !== id); else x.balances.push({ id, date: String(data.date), bank: Number(data.bank), cash: Number(data.cash ?? 0), paypay: 0, memo: "", at: new Date().toISOString() }); break;
      case "account_entries": case "card_entries": {
        const card = c.table === "card_entries";
        const list = (card ? x.cards : x.accounts) as { id: string }[];
        if (c.kind === "delete") { if (card) x.cards = x.cards.filter((e) => e.id !== id); else x.accounts = x.accounts.filter((e) => e.id !== id); break; }
        const patch: Record<string, unknown> = { ...data };
        if (data.category && !data.group && (card || data.direction === "out")) patch.group = groupOfCat(x.settings, String(data.category));
        const before = list.find((e) => e.id === id) as { revolved_at?: string | null } | undefined;
        if (card && data.group === "purchase" && !before?.revolved_at) patch.revolved_at = todayJST();
        const base = card
          ? { card: x.settings.cards[0].id, status: "plan", group: "variable", category: null, name: "", shop: "", memo: "", tatekae: 0, source: "manual", source_ref: c.key?.ref ?? null, merged_into: null, not_dup: [], locked: true, recurring_id: null, goal_id: null }
          : { account: "bank", status: "plan", category: null, name: "", memo: "", source: "manual", source_ref: c.key?.ref ?? null, recurring_id: null, goal_id: null, card: null, pair_id: null, locked: true };
        upsert(list, { ...(before ?? base), ...patch, id } as never);
        break;
      }
      default: break;
    }
  });
  return x;
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
      case "v5_months":
        await actions5.decideBudget(d, String(c.key!.month), c.kind === "delete" ? null : Number(data.budget));
        break;
      case "v5_plans":
        if (c.kind === "delete") await actions5.removePlan(c.id!);
        else if (c.id) await actions5.updatePlan(c.id, data as Partial<V5Plan>);
        else await actions5.addPlan({ ...newPlan(d, String(c.key!.name)), ...(data as Partial<V5Plan>) });
        break;
      case "v5_loans": {
        const { plan, ...rest } = data;
        const patch = { ...rest, ...(plan !== undefined ? { plan_id: d.v5.plans.find((p) => p.name === plan)?.id ?? null } : {}) };
        if (c.kind === "delete") await actions5.removeLoan(c.id!);
        else if (c.id) await actions5.updateLoan(c.id, patch);
        else await backend.insert("v5_loans", [{ name: String(c.key!.name), plan_id: null, card: null, monthly: 0, pay_day: null, sort: d.v5.loans.length, ...patch }]);
        break;
      }
      case "v5_loan_balances": await actions5.setLoanBalance(String(data.loan_id), String(data.date), Number(data.balance)); break;
      case "v5_moves":
        if (c.kind === "delete") await actions5.removeMove(c.id!);
        else await backend.insert("v5_moves", [data as Row]);
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
        // リボに回したら、回した日を持つ（借入残高に足す日・予算に数えるかの目印。設計書 §3.4）
        if (card && data.group === "purchase" && !(c.id && d.cards.find((e) => e.id === c.id)?.revolved_at)) patch.revolved_at = today;
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

