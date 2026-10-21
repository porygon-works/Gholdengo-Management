import type { Rule } from "./types";

// お店→費目のルール。GAS（gas/Code.gs）にも同じ正規化を書いている。変えるときは両方直す

/** 全角英数を半角にし、決済手段の後ろ書き（／ｉＤ など）を取り、小文字にする */
export function normalizeShop(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .replace(/[/／](iD|NFC|QUICPay|Apple Pay|Google Pay)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 中身が分からないお店の名前。ルールを覚えない */
const GENERIC = [/^mastercard加盟店/, /^visa加盟店/, /^jcb加盟店/, /加盟店$/, /^$/];

export const isGenericShop = (s: string) => GENERIC.some((re) => re.test(normalizeShop(s)));

/** いちばん長く一致したルールの費目 */
export function categorize(shop: string, rules: Rule[]): string | null {
  const n = normalizeShop(shop);
  if (!n || isGenericShop(shop)) return null;
  let best: Rule | null = null;
  for (const r of rules) {
    const p = normalizeShop(r.pattern);
    if (p && n.includes(p) && (!best || p.length > normalizeShop(best.pattern).length)) best = r;
  }
  return best?.category ?? null;
}

/** 本人が費目を直したときに覚えるルールの形（お店の名前そのもの） */
export function ruleFor(shop: string): string | null {
  if (isGenericShop(shop)) return null;
  const n = normalizeShop(shop);
  return n || null;
}
