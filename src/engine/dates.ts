// 日付は "YYYY-MM-DD" の文字列で扱う。時差の影響を受けないよう、計算は UTC で行う

export const ymOf = (d: string) => d.slice(0, 7);

export function addDays(d: string, k: number): string {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + k);
  return t.toISOString().slice(0, 10);
}

export function addMonths(ym: string, k: number): string {
  let [y, m] = ym.split("-").map(Number);
  m += k;
  y += Math.floor((m - 1) / 12);
  m = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function lastDay(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** その月の day 日。月末より大きければ月末 */
export function dayOf(ym: string, day: number): string {
  return `${ym}-${String(Math.min(day, lastDay(ym))).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

const weekday = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();

/** 日本時間の今日 */
export function todayJST(now = Date.now()): string {
  return new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
}

// ---------- 祝日（2000〜2099年。内閣府の規則による） ----------

function nthMonday(y: number, m: number, n: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const day = 1 + ((8 - first) % 7) + (n - 1) * 7;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const vernal = (y: number) => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const autumnal = (y: number) => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

const holidayCache = new Map<number, Set<string>>();

export function holidays(y: number): Set<string> {
  const hit = holidayCache.get(y);
  if (hit) return hit;
  const p = (m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const base = new Set<string>([
    p(1, 1), nthMonday(y, 1, 2), p(2, 11), p(2, 23), p(3, vernal(y)), p(4, 29), p(5, 3), p(5, 4), p(5, 5),
    nthMonday(y, 7, 3), p(8, 11), nthMonday(y, 9, 3), p(9, autumnal(y)), nthMonday(y, 10, 2), p(11, 3), p(11, 23),
  ]);
  const out = new Set(base);
  // 振替休日：祝日が日曜なら、その後の最初の祝日でない日
  for (const d of base) {
    if (weekday(d) !== 0) continue;
    let n = addDays(d, 1);
    while (base.has(n)) n = addDays(n, 1);
    out.add(n);
  }
  // 国民の休日：祝日にはさまれた平日
  for (const d of base) {
    const mid = addDays(d, 1), next = addDays(d, 2);
    if (!base.has(mid) && base.has(next) && weekday(mid) !== 0) out.add(mid);
  }
  holidayCache.set(y, out);
  return out;
}

/** 銀行の営業日か（土日・祝日・12/31〜1/3 は休み） */
export function isBusinessDay(d: string): boolean {
  const w = weekday(d);
  if (w === 0 || w === 6) return false;
  const md = d.slice(5);
  if (md === "12-31" || md === "01-01" || md === "01-02" || md === "01-03") return false;
  return !holidays(+d.slice(0, 4)).has(d);
}

export function shiftBusiness(d: string, how: "next" | "prev" | "none"): string {
  if (how === "none") return d;
  const step = how === "next" ? 1 : -1;
  while (!isBusinessDay(d)) d = addDays(d, step);
  return d;
}
