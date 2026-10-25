import { useEffect, useRef, useState, type ReactNode } from "react";
import { ACCOUNT_GROUP_LABEL, CARD_GROUP_LABEL, type AccountEntry, type CardEntry, type Settings, type Status } from "../engine";

export const yen = (n: number) => (Math.round(n) || 0).toLocaleString("ja-JP");
export const signed = (n: number) => (n < 0 ? "−" + yen(-n) : yen(n));
export const md = (s: string) => { const [, m, d] = s.split("-"); return `${+m}/${+d}`; };
export const ymLabel = (ym: string) => `${ym.slice(0, 4)}年${+ym.slice(5)}月`;
export const wday = (d: string) => "日月火水木金土"[new Date(d + "T00:00:00Z").getUTCDay()];

export const STATUS_LABEL: Record<Status, string> = { plan: "予定", confirmed: "確定" };
export const CARD_SOURCE_LABEL: Record<CardEntry["source"], string> = { manual: "手入力", card_flash: "カード速報", card_statement: "カード明細", recurring: "定期", goal: "目標", migration: "移行" };
export const ACCOUNT_SOURCE_LABEL: Record<AccountEntry["source"], string> = { manual: "手入力", recurring: "定期", card_bill: "クレカ請求", goal: "目標", plan: "計画", migration: "移行" };
export { ACCOUNT_GROUP_LABEL, CARD_GROUP_LABEL };

export const cardTitle = (e: CardEntry) => e.name || e.shop || e.category || "クレカ";
export const accountTitle = (e: AccountEntry) => e.name || e.category || ACCOUNT_GROUP_LABEL[e.group];
export const ownCost = (e: { amount: number; tatekae?: number }) => Math.max(0, e.amount - (e.tatekae || 0));

/**
 * 払い方の選択肢（使ったものを入れるとき）。
 * クレカはカードごと（"card:smbc"）、現金は財布、PayPay は口座から（チャージした額を使ったものとして数える）、口座は口座払い
 */
export type Pay = string;
export const payLabels = (s: Settings): Record<Pay, string> => ({ ...Object.fromEntries(s.cards.map((c) => [`card:${c.id}`, `クレカ（${c.name}）`])), wallet: "現金", paypay: "PayPay", bank: "口座" });
export const cardOfPay = (p: Pay) => (p.startsWith("card:") ? p.slice(5) : null);

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

/** 下から出る板。見出しは上に止めておき、右に閉じる（×）、戻れるときは左に戻る（‹）を置く（スクロールしなくても閉じられる） */
export function Sheet({ title, onClose, onBack, children }: { title: string; onClose: () => void; onBack?: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sheetbg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-h">
          {onBack && <button type="button" className="iconbtn" onClick={onBack} aria-label="戻る">‹</button>}
          <h3>{title}</h3>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="閉じる">×</button>
        </div>
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

/** 数だけを入れる欄。空のときは "" を返す。金額は右寄せで頭に ¥（日付などの数は plain） */
export function NumInput({ value, onChange, placeholder, autoFocus, id, plain }: { value: number | ""; onChange: (v: number | "") => void; placeholder?: string; autoFocus?: boolean; id?: string; plain?: boolean }) {
  const input = (
    <input id={id} className="num" type="text" inputMode="numeric" pattern="[0-9]*" autoFocus={autoFocus} placeholder={placeholder}
      value={value === "" ? "" : plain ? String(value) : value.toLocaleString("ja-JP")}
      onChange={(e) => { const v = e.target.value.normalize("NFKC").replace(/[^0-9]/g, ""); onChange(v === "" ? "" : Number(v)); }} />
  );
  return plain ? input : <span className="money">{input}</span>;
}

/** 金額の表示：¥ をつける */
export const money = (n: number) => (n < 0 ? "−¥" + yen(-n) : "¥" + yen(n));

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

export function StatusChip({ status, label }: { status: Status; label?: string }) {
  return <Chip kind={status === "confirmed" ? "ok" : "warn"}>{label ?? STATUS_LABEL[status]}</Chip>;
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
