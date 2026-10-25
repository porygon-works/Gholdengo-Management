import type { Data, PlanMove } from "./types";

// 計画にひも付けた購入（v5_moves の spend）が、いまどの明細を指しているか（設計書 §3.3）

/**
 * ひも付けた明細が重複としてまとめられていれば、まとめた先の明細。消された明細なら null（ひも付けはなかったことにする）
 */
export function spendTarget(d: Data, m: PlanMove): string | null {
  if (m.kind !== "spend" || !m.entry_id) return null;
  if (m.entry_kind === "account") return d.accounts.some((e) => e.id === m.entry_id) ? `account:${m.entry_id}` : null;
  let e = d.cards.find((x) => x.id === m.entry_id);
  for (let k = 0; e?.merged_into && k < 5; k++) e = d.cards.find((x) => x.id === e!.merged_into);
  return e && !e.merged_into ? `card:${e.id}` : null;
}
