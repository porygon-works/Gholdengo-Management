import { addMonths, dayOf, shiftBusiness, ymOf } from "./dates";
import { REPAY, type Entry, type Recurring, type Settings } from "./types";

/** 予算月 ym にクレカで使った分の引落日 */
export function cardPayDate(ym: string, s: Settings): string {
  return shiftBusiness(dayOf(addMonths(ym, 1), s.cardPayDay), "next");
}

/** 使った日 d のクレカ利用が属する締め月 */
export function closingMonth(d: string, s: Settings): string {
  const ym = ymOf(d);
  return +d.slice(8) > s.cardClosingDay ? addMonths(ym, 1) : ym;
}

/**
 * 資産から減る（または増える）日。null は資産が動かないもの。
 * - クレカ：締め月の翌月の引落日。ただし「返済」はその日に請求される額なので、使った日そのもの
 * - 現金・PayPay・交通系・口座：その日
 * - ポイント・リボで買った物：資産は動かない（リボは返済の明細で数える）
 */
export function cashDate(e: Entry, s: Settings): string | null {
  if (e.kind === "transfer") return null;
  if (e.kind === "income") return e.date;
  switch (e.method) {
    case "point":
    case "revo":
      return null;
    case "card":
      return e.category === REPAY ? e.date : cardPayDate(closingMonth(e.date, s), s);
    default:
      return e.date;
  }
}

/** 予算に数える額（立替を除く） */
export const ownCost = (e: Entry) => Math.max(0, e.amount - (e.tatekae || 0));

/** 定期のお金から、その月の予定の日付を出す */
export function recurringDate(r: Recurring, ym: string): string {
  return shiftBusiness(dayOf(ym, r.day), r.shift);
}

export const recurringRef = (r: Recurring, ym: string) => `rec:${r.id}:${ym}`;

/** months の各月について、まだ作られていない定期の予定を返す */
export function missingRecurring(recurring: Recurring[], entries: Entry[], months: string[]): Omit<Entry, "id">[] {
  const have = new Set(entries.map((e) => e.source_ref).filter(Boolean));
  const out: Omit<Entry, "id">[] = [];
  for (const r of recurring) {
    if (!r.active) continue;
    for (const ym of months) {
      if (r.start_month && ym < r.start_month) continue;
      if (r.end_month && ym > r.end_month) continue;
      const ref = recurringRef(r, ym);
      if (have.has(ref)) continue;
      out.push({
        kind: r.kind, status: "plan", date: recurringDate(r, ym), amount: r.amount, method: r.method,
        category: r.kind === "income" ? null : r.category, shop: "", item: r.name, memo: "", tatekae: 0,
        source: "recurring", source_ref: ref, merged_into: null, recurring_id: r.id, not_dup: [], locked: false,
      });
    }
  }
  return out;
}
