import { useState } from "react";
import type { Part, PartRow } from "../engine";
import { Chip, md, money, Sheet } from "./common";

// 内訳を出す下からの板（設計書 §4.1）。計算した数字は、どの画面でもタップするとこの板で式と中身の行が出る

export type OpenPart = (p: Part) => void;

const fmt = (p: Part, first: boolean) => `${first ? "" : p.sign < 0 ? "− " : "＋ "}${p.label} ${money(p.amount)}`;

export function PartSheet({ part, onClose, onRow }: { part: Part; onClose: () => void; onRow?: (r: PartRow) => void }) {
  const [stack, setStack] = useState<Part[]>([part]);
  const cur = stack[stack.length - 1];
  const open = (p: Part) => setStack([...stack, p]);
  return (
    <Sheet title={cur.label} onClose={onClose}>
      {stack.length > 1 && <button className="btn sm ghost" onClick={() => setStack(stack.slice(0, -1))}>‹ {stack[stack.length - 2].label}にもどる</button>}
      <div className="panel">
        <div className="kv"><span>{cur.label}</span><b className={`num ${cur.amount < 0 ? "neg" : ""}`}>{money(cur.amount)}</b></div>
        {cur.parts && cur.parts.length > 0 && (
          <div className="list">
            <div className="note">＝ {cur.parts.map((p, i) => fmt(p, i === 0)).join("　")}</div>
            {cur.parts.map((p) => {
              const deeper = (p.parts && p.parts.length > 0) || (p.rows && p.rows.length > 0);
              return (
                <button key={p.key} className="row" style={{ gridTemplateColumns: "1fr auto" }} disabled={!deeper} onClick={() => deeper && open(p)}>
                  <span className="t"><div>{p.sign < 0 ? "−" : "＋"} {p.label}</div></span>
                  <span className={`a num ${p.amount < 0 ? "neg" : ""}`}>{money(p.amount)}{deeper && <small> ›</small>}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {cur.rows && cur.rows.length > 0 && (
        <div className="panel"><div className="list">
          {cur.rows.map((r, i) => (
            <button key={r.ref.id + i} className={`row ${r.plan ? "plan" : ""}`} disabled={r.ref.kind === "virtual" || !onRow} onClick={() => onRow?.(r)}>
              <span className="d num">{md(r.date)}</span>
              <span className="t"><div>{r.name || "―"} {r.ref.kind === "virtual" ? <Chip kind="warn">見込</Chip> : r.plan ? <Chip kind="warn">予定</Chip> : null}</div></span>
              <span className={`a num ${r.amount < 0 ? "neg" : ""}`}>{money(r.amount)}</span>
            </button>
          ))}
        </div></div>
      )}
      {!cur.parts?.length && !cur.rows?.length && <div className="note">中身の行はありません</div>}
      <div className="btns"><button className="btn ghost" onClick={onClose}>閉じる</button></div>
    </Sheet>
  );
}

/** タップで内訳が出る金額 */
export function PartNum({ part, open, big, className }: { part: Part; open: OpenPart; big?: boolean; className?: string }) {
  return (
    <button className={`lnk num ${className ?? ""} ${part.amount < 0 ? "neg" : ""}`} style={{ fontSize: big ? 28 : undefined, fontWeight: 700, padding: 0 }} onClick={() => open(part)} aria-label={`${part.label}の内訳`}>
      {money(part.amount)}
    </button>
  );
}
