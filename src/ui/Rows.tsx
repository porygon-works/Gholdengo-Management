import type { AccountEntry, CardEntry } from "../engine";
import type { AppData } from "../data/store";
import { ACCOUNT_GROUP_LABEL, accountTitle, CARD_GROUP_LABEL, cardTitle, md, ownCost, StatusChip, yen } from "./common";
import type { Open } from "./Sheets";

// 明細の1行（クレカ明細・口座明細）

type OnOpen = (o: Open) => void;

export function CardRow({ e, data, onOpen, showCat }: { e: CardEntry; data: AppData; onOpen: OnOpen; showCat?: boolean }) {
  const card = data.settings.cards.find((c) => c.id === e.card)?.name ?? "クレカ";
  const what = e.group === "variable" || e.group === "fixed" ? e.category ?? "未分類" : CARD_GROUP_LABEL[e.group];
  const sub = [card, e.name && e.shop ? e.shop : "", showCat || (e.group !== "variable" && e.group !== "fixed") ? what : ""].filter(Boolean).join("・");
  return (
    <button className={`row ${e.status === "plan" ? "plan" : ""}`} onClick={() => onOpen({ type: "card", entry: e })}>
      <span className="d num">{md(e.date)}</span>
      <span className="t"><div>{cardTitle(e)} {e.status === "plan" && <StatusChip status="plan" />}</div>{sub && <div>{sub}</div>}</span>
      <span className="a num">{yen(ownCost(e))}{e.tatekae ? <small>立替 {yen(e.tatekae)} を除く</small> : null}</span>
    </button>
  );
}

export function AccountRow({ e, onOpen, showCat }: { e: AccountEntry; onOpen: OnOpen; showCat?: boolean }) {
  const what = e.direction === "out" && (e.group === "variable" || e.group === "fixed") ? e.category ?? "未分類" : ACCOUNT_GROUP_LABEL[e.group];
  const sub = [e.account === "wallet" ? "財布" : "口座", showCat || e.group === "card" || e.direction === "in" ? what : ""].filter(Boolean).join("・");
  return (
    <button className={`row ${e.status === "plan" ? "plan" : ""}`} onClick={() => onOpen({ type: "account", entry: e })}>
      <span className="d num">{md(e.date)}</span>
      <span className="t"><div>{accountTitle(e)} {e.status === "plan" && <StatusChip status="plan" />}</div><div>{sub}</div></span>
      <span className="a num">{e.direction === "in" ? "＋" : ""}{yen(e.amount)}</span>
    </button>
  );
}

