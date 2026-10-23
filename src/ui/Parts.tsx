import { useState } from "react";
import type { Part, PartRow } from "../engine";
import { Chip, md, money, Sheet } from "./common";

// 内訳を出す下からの板（設計書 §4.1）。計算した数字は、どの画面でもタップするとこの板で式と中身の行が出る

export type OpenPart = (p: Part) => void;

const deeper = (p: Part) => (p.parts && p.parts.length > 0) || (p.rows && p.rows.length > 0);

export function PartSheet({ part, onClose, onRow }: { part: Part; onClose: () => void; onRow?: (r: PartRow) => void }) {
  const [stack, setStack] = useState<Part[]>([part]);
  const cur = stack[stack.length - 1];
  return (
    <Sheet title={stack.map((p) => p.label).join(" › ")} onClose={onClose}>
      {cur.parts && cur.parts.length > 0 && (
        <div className="panel formula">
          {cur.parts.map((p, i) => (
            <button key={p.key} className="fl" disabled={!deeper(p)} onClick={() => setStack([...stack, p])}>
              <span className="sg">{i === 0 && p.sign > 0 ? "" : p.sign < 0 ? "−" : "＋"}</span>
              <span>{p.label}</span>
              <span className={`am ${p.amount < 0 ? "neg" : ""}`}>{money(p.amount)}{deeper(p) && <span className="go">›</span>}</span>
            </button>
          ))}
          <div className="tot"><span>＝ {cur.label}</span><span className={`am ${cur.amount < 0 ? "neg" : ""}`}>{money(cur.amount)}</span></div>
        </div>
      )}
      {!cur.parts?.length && <div className="panel formula"><div className="tot"><span>{cur.label}</span><span className={`am ${cur.amount < 0 ? "neg" : ""}`}>{money(cur.amount)}</span></div></div>}
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
      <div className="btns">
        {stack.length > 1 && <button className="btn ghost" onClick={() => setStack(stack.slice(0, -1))}>戻る</button>}
        <button className="btn ghost" onClick={onClose}>閉じる</button>
      </div>
    </Sheet>
  );
}

/** タップで内訳が出る金額 */
export function PartNum({ part, open, className }: { part: Part; open: OpenPart; className?: string }) {
  return (
    <button className={`btn sm ghost num ${className ?? ""} ${part.amount < 0 ? "neg" : ""}`} onClick={() => open(part)} aria-label={`${part.label}の内訳`}>
      {money(part.amount)} ›
    </button>
  );
}
