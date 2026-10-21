import { addMonths, dayOf, shiftBusiness, ymOf } from "./dates";
import { REPAY, type CardDef, type Entry, type Recurring, type Settings } from "./types";

/** カードの設定。id がなければ（または見つからなければ）1枚目 */
export const cardOf = (s: Settings, id?: string | null): CardDef => s.cards.find((c) => c.id === id) ?? s.cards[0];

/** 締め月 ym にそのカードで使った分の引落日 */
export function cardPayDate(ym: string, s: Settings, card?: string | null): string {
  const c = cardOf(s, card);
  return shiftBusiness(dayOf(addMonths(ym, c.payMonths), c.payDay), "next");
}

/** 使った日 d のクレカ利用が属する締め月 */
export function closingMonth(d: string, s: Settings, card?: string | null): string {
  const ym = ymOf(d);
  return +d.slice(8) > cardOf(s, card).closingDay ? addMonths(ym, 1) : ym;
}

/**
 * 口座から減る（または口座に入る）日。null は口座が動かないもの。
 * - クレカ：そのカードの締め月の引落日。ただし「返済」はその日に請求される額なので、使った日そのもの
 * - 口座・PayPay（口座からチャージ）：その日
 * - 現金・交通系（現金でチャージ）：口座は動かない（財布が動く。walletDelta）
 * - ATMで引き出し（移動・金種「口座」）：その日に口座から出る
 * - ポイント・リボで買った物：口座は動かない（リボは返済の明細で数える）
 */
export function cashDate(e: Entry, s: Settings): string | null {
  if (e.kind === "transfer") return e.method === "bank" ? e.date : null;
  if (e.kind === "income") return e.method === "cash" ? null : e.date;
  switch (e.method) {
    case "point":
    case "revo":
    case "cash":
    case "ic":
      return null;
    case "card":
      return e.category === REPAY ? e.date : cardPayDate(closingMonth(e.date, s, e.card), s, e.card);
    default:
      return e.date;
  }
}

/** 財布（現金）の増減。現金で使った・現金で受け取った・ATMで引き出した */
export function walletDelta(e: Entry): number {
  if (e.kind === "transfer") return e.method === "bank" ? e.amount : 0;
  if (e.kind === "income") return e.method === "cash" ? e.amount : 0;
  return e.method === "cash" || e.method === "ic" ? -e.amount : 0;
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
        kind: r.kind, status: "plan", date: recurringDate(r, ym), amount: r.amount, method: r.method, card: r.method === "card" ? r.card : null,
        category: r.category, shop: r.shop || "", item: r.name, memo: "", tatekae: 0,
        source: "recurring", source_ref: ref, merged_into: null, recurring_id: r.id, not_dup: [], locked: false,
      });
    }
  }
  return out;
}
