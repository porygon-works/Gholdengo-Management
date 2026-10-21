import { daysBetween } from "./dates";
import { normalizeShop } from "./rules";
import type { Entry } from "./types";

// 重複の処理（仕様書 §6）。信頼度の高い明細が、低い明細を吸収する

/** 信頼度。予定 0 ＜ 手入力 1 ＜ カード速報 2 ＜ カード明細 3 */
export function rank(e: Entry): number {
  if (e.status === "plan") return 0;
  if (e.source === "card_statement") return 3;
  if (e.source === "card_flash") return 2;
  return 1;
}

export interface Merge {
  keep: Entry;
  absorb: Entry;
  patch: Partial<Entry>; // keep に書き足す項目（本人が入れた値）
}

export interface ReviewItem {
  entry: Entry;
  candidates: Entry[];
  reason: string;
}

export const isLive = (e: Entry) => !e.merged_into;

const absDays = (a: Entry, b: Entry) => Math.abs(daysBetween(a.date, b.date));
const notDup = (a: Entry, b: Entry) => a.not_dup?.includes(b.id) || b.not_dup?.includes(a.id);

type Match = "auto" | "near" | null;

function match(hi: Entry, lo: Entry): Match {
  if (hi.kind !== lo.kind || notDup(hi, lo)) return null;
  const d = absDays(hi, lo);
  if (lo.status === "plan") {
    // 予定は金種を問わない。見込みの金額なので ±20% まで。ただし 3,000円未満は取り違えやすい（サブスクなど）ので、ぴったりのときだけ
    const ratio = lo.amount > 0 ? Math.abs(hi.amount - lo.amount) / lo.amount : 1;
    const tol = lo.amount >= 3000 ? 0.2 : 0;
    if (d > 7 || ratio > tol) return null;
    // 予定に「お店の名前のヒント」があり、明細のお店に入っていれば、費目が違ってもまとめる（定期代のSuicaが「交通」で入るときなど）
    const hint = normalizeShop(lo.shop);
    if (hint && normalizeShop(hi.shop).includes(hint)) return "auto";
    // それ以外は、費目が同じか、どちらかが未分類のときだけ
    if (hi.category && lo.category && hi.category !== lo.category) return null;
    // 定期のお金（サブスク・通信など）の予定は自動でまとめる。
    // 一回きりの予定（飲み会・買い物など）は、同じ費目で似た金額の別の買い物と取り違えやすいので、要確認で聞く
    return lo.source === "recurring" ? "auto" : "near";
  }
  if (hi.method !== lo.method) return null;
  if (hi.amount === lo.amount) {
    if (d <= 3) return "auto";
    if (d <= 7) return "near";
    return null;
  }
  // 金額が少し違うのは、手で入れた金額がずれているときだけ。メールの明細どうしなら別の買い物
  if (lo.source !== "manual") return null;
  const ratio = lo.amount > 0 ? Math.abs(hi.amount - lo.amount) / lo.amount : 1;
  if (d <= 3 && ratio <= 0.1) return "near";
  return null;
}

/** 吸収するときに、低いほうから引き継ぐ値 */
function inherit(keep: Entry, lo: Entry): Partial<Entry> {
  const p: Partial<Entry> = {};
  const userSet = lo.locked || (lo.status !== "plan" && lo.source === "manual");
  // 本人が入れた費目と、予定の費目（何の支払いか本人が決めたもの）を、ルールで付いた費目より優先する
  if ((userSet || lo.status === "plan") && lo.category && !keep.locked && lo.category !== keep.category) p.category = lo.category;
  else if (!keep.category && lo.category) p.category = lo.category;
  if (userSet && !keep.locked) p.locked = true;
  if (!keep.item && lo.item) p.item = lo.item;
  if (!keep.memo && lo.memo) p.memo = lo.memo;
  if (!keep.tatekae && lo.tatekae) p.tatekae = lo.tatekae;
  if (lo.status === "plan" && lo.recurring_id && !keep.recurring_id) p.recurring_id = lo.recurring_id;
  return p;
}

/**
 * まだ吸収されていない明細どうしを比べ、自動でまとめるものと要確認のものを返す。
 * 信頼度の高い明細から順に、それより低い明細の中で相手を探す。
 */
export function findMerges(entries: Entry[]): { merges: Merge[]; review: ReviewItem[] } {
  // 吸収で引き継いだ値を、続く吸収にも渡すため写しで持つ
  const live = entries.filter((e) => isLive(e) && e.kind !== "transfer").map((e) => ({ ...e }));
  const taken = new Set<string>();
  const merges: Merge[] = [];
  const review: ReviewItem[] = [];
  // 低い信頼度から順に処理する。手入力→予定、速報→手入力、明細→速報 と段を上がるように吸収する
  const order = live.filter((e) => rank(e) >= 1).sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const hi of order) {
    if (taken.has(hi.id)) continue;
    const lows = live.filter((lo) => lo.id !== hi.id && !taken.has(lo.id) && rank(lo) < rank(hi));
    const autos: Entry[] = [], nears: Entry[] = [];
    for (const lo of lows) {
      const m = match(hi, lo);
      if (m === "auto") autos.push(lo);
      else if (m === "near") nears.push(lo);
    }
    // いちばん信頼度の高い候補だけを見る（明細なら、手入力より速報を相手にする）
    const top = autos.length ? Math.max(...autos.map(rank)) : -1;
    const pick = autos.filter((e) => rank(e) === top);
    if (pick.length === 1) {
      const lo = pick[0];
      const patch = inherit(hi, lo);
      merges.push({ keep: hi, absorb: lo, patch });
      Object.assign(hi, patch);
      taken.add(lo.id);
    } else if (pick.length > 1) {
      review.push({ entry: hi, candidates: pick, reason: "同じものの候補が2件以上あります" });
    } else if (nears.length) {
      const plans = nears.filter((e) => e.status === "plan");
      const reason = plans.length === nears.length
        ? `予定「${plans.map((p) => p.item || p.shop || p.category || "予定").join("」「")}」の支払いかもしれません`
        : "日付か金額が少し違う、同じかもしれない明細があります";
      review.push({ entry: hi, candidates: nears, reason });
    }
  }
  return { merges, review };
}

/** クレカで手入力したのに、7日たってもメールから入ってこない明細 */
export function missingCardEntries(entries: Entry[], today: string): Entry[] {
  return entries.filter((e) => isLive(e) && e.kind === "expense" && e.status !== "plan" && e.method === "card" && e.source === "manual" && daysBetween(e.date, today) > 7);
}
