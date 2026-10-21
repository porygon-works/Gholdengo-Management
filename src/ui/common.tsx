import { useEffect, useRef, useState, type ReactNode } from "react";
import { cardOf, type Entry, type Method, type Settings, type Status } from "../engine";

export const yen = (n: number) => (Math.round(n) || 0).toLocaleString("ja-JP");
export const signed = (n: number) => (n < 0 ? "−" + yen(-n) : yen(n));
export const md = (s: string) => { const [, m, d] = s.split("-"); return `${+m}/${+d}`; };
export const ymLabel = (ym: string) => `${ym.slice(0, 4)}年${+ym.slice(5)}月`;

// PayPay と交通系は、チャージした額をその日の支出として数える（チャージしたあと何に使ったかは管理しない）
export const METHOD_LABEL: Record<Method, string> = { card: "クレカ", cash: "現金", paypay: "PayPayチャージ", ic: "交通系チャージ", point: "ポイント", bank: "口座", revo: "リボ" };
export const QUICK_METHODS: Method[] = ["card", "cash", "paypay", "ic"];

/** 金種の選択肢。クレカはカードごとに分けて "card:smbc" のように書く */
export const payKey = (s: Settings, method: Method, card: string | null) => (method === "card" ? `card:${cardOf(s, card).id}` : method);
export const fromPayKey = (k: string): { method: Method; card: string | null } => (k.startsWith("card:") ? { method: "card", card: k.slice(5) } : { method: k as Method, card: null });
export const payKeys = (s: Settings, ms: Method[]) => ms.flatMap((m) => (m === "card" ? s.cards.map((c) => `card:${c.id}`) : [m]));
export const payLabels = (s: Settings): Record<string, string> => ({ ...METHOD_LABEL, ...Object.fromEntries(s.cards.map((c) => [`card:${c.id}`, c.name])) });
export const ALL_METHODS: Method[] = ["card", "cash", "paypay", "ic", "bank", "revo"];
export const STATUS_LABEL: Record<Status, string> = { plan: "予定", flash: "速報", confirmed: "確定" };
export const SOURCE_LABEL: Record<Entry["source"], string> = { manual: "手入力", card_flash: "カード速報", card_statement: "カード明細", recurring: "定期", migration: "移行" };

export const entryTitle = (e: Entry) => e.item || e.shop || (e.kind === "income" ? "入金" : "支出");
export const ownCost = (e: Entry) => Math.max(0, e.amount - (e.tatekae || 0));

// ---------- 通知 ----------

let pushToast: ((m: string) => void) | null = null;
export const toast = (m: string) => pushToast?.(m);

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(0);
  useEffect(() => {
    pushToast = (m) => { setMsg(m); clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(null), 2600); };
    return () => { pushToast = null; };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

// ---------- 下から出るシート ----------

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sheetbg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="flabel">{label}</span>
      {children}
      {hint && <span className="note">{hint}</span>}
    </label>
  );
}

/** 数だけを入れる欄。空のときは "" を返す */
export function NumInput({ value, onChange, placeholder, autoFocus, id }: { value: number | ""; onChange: (v: number | "") => void; placeholder?: string; autoFocus?: boolean; id?: string }) {
  return (
    <input id={id} className="num" type="text" inputMode="numeric" pattern="[0-9]*" autoFocus={autoFocus} placeholder={placeholder}
      value={value === "" ? "" : String(value)}
      onChange={(e) => { const v = e.target.value.normalize("NFKC").replace(/[^0-9]/g, ""); onChange(v === "" ? "" : Number(v)); }} />
  );
}

export function Select<T extends string>({ value, options, onChange, labels }: { value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
    </select>
  );
}

export function Chip({ kind, children }: { kind?: "ok" | "warn" | "bad"; children: ReactNode }) {
  return <span className={`chip ${kind ?? ""}`}>{children}</span>;
}

export function StatusChip({ e }: { e: Entry }) {
  return <Chip kind={e.status === "confirmed" ? "ok" : e.status === "plan" ? "warn" : undefined}>{STATUS_LABEL[e.status]}</Chip>;
}

export function Bar({ budget, used, planned }: { budget: number; used: number; planned: number }) {
  const base = Math.max(budget, used + planned) || 1;
  const over = used + planned > budget;
  return (
    <div className="bar" aria-hidden="true">
      <i className={over ? "o" : "u"} style={{ width: `${(used / base) * 100}%` }} />
      <i className="p" style={{ width: `${(planned / base) * 100}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
