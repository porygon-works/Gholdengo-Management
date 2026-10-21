import { addMonths, dayOf, shiftBusiness, ymOf } from "./dates";
import { groupOfCat, type AccountEntry, type AccountGroup, type CardDef, type CardEntry, type CardGroup, type Recurring, type Settings } from "./types";

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

/** 引落月 payYm の請求に入る締め月 */
export const closingFor = (payYm: string, s: Settings, card?: string | null) => addMonths(payYm, -cardOf(s, card).payMonths);

/** 締め月 ym の最後の日（その月の請求に入る、いちばん遅い利用日） */
export const closingEnd = (ym: string, s: Settings, card?: string | null) => dayOf(ym, cardOf(s, card).closingDay);

/** 予算に数える額（立替を除く） */
export const ownCost = (e: { amount: number; tatekae?: number }) => Math.max(0, e.amount - (e.tatekae || 0));

/** 定期のお金から、その月の予定の日付を出す */
export function recurringDate(r: Recurring, ym: string): string {
  return shiftBusiness(dayOf(ym, r.day), r.shift);
}

export const recurringRef = (r: Recurring, ym: string) => `rec:${r.id}:${ym}`;

/** 定期のお金の大費目。指定がなければ費目から決める */
function groupOf(r: Recurring, s: Settings): AccountGroup | CardGroup {
  if (r.group) return r.group;
  return r.kind === "income" ? "salary" : groupOfCat(s, r.category);
}

/** months の各月について、まだ作られていない定期の予定を、口座明細とクレカ明細に分けて返す */
export function missingRecurring(d: { recurring: Recurring[]; accounts: AccountEntry[]; cards: CardEntry[]; settings: Settings }, months: string[]) {
  const have = new Set([...d.accounts, ...d.cards].map((e) => e.source_ref).filter(Boolean));
  const accounts: Omit<AccountEntry, "id">[] = [];
  const cards: Omit<CardEntry, "id">[] = [];
  for (const r of d.recurring) {
    if (!r.active) continue;
    for (const ym of months) {
      if (r.start_month && ym < r.start_month) continue;
      if (r.end_month && ym > r.end_month) continue;
      const ref = recurringRef(r, ym);
      if (have.has(ref)) continue;
      const date = recurringDate(r, ym);
      const group = groupOf(r, d.settings);
      if (r.pay === "card" && r.kind === "expense") {
        cards.push({
          card: cardOf(d.settings, r.card).id, status: "plan", date, amount: r.amount, group: group as CardGroup, category: r.category,
          name: r.name, shop: r.shop || "", memo: "", tatekae: 0, source: "recurring", source_ref: ref, merged_into: null, not_dup: [],
          locked: false, recurring_id: r.id, goal_id: null,
        });
      } else {
        accounts.push({
          account: r.pay === "wallet" ? "wallet" : "bank", direction: r.kind === "income" ? "in" : "out", status: "plan", group: group as AccountGroup,
          category: r.kind === "income" ? null : r.category, name: r.name, memo: "", date, amount: r.amount, source: "recurring", source_ref: ref,
          recurring_id: r.id, goal_id: null, card: null, pair_id: null, locked: false,
        });
      }
    }
  }
  return { accounts, cards };
}
