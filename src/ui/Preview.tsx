import { useMemo, useState } from "react";
import { budgetView, compare, type Change, type Comparison } from "../engine";
import { actions, actions5, type AppData, type Store } from "../data/store";
import { md, money, toast } from "./common";

// 保存する前の比べと、余裕額がマイナスになるときの確認（設計書 §4.3・§3.5）

/** 変更を保存する */
export async function saveChange(data: AppData, c: Change) {
  switch (c.kind) {
    case "addAccount": { const { account, direction, status, group, category, name, date, amount, memo } = c.entry; return actions.addAccount({ account, direction, status, group, category, name, date, amount, memo }); }
    case "addCard": { const { card, status, group, category, date, amount, name, shop, memo, tatekae } = c.entry; return actions.addCard({ card, status, group, category, date, amount, name, shop, memo, tatekae }); }
    case "decideBudget": return actions5.decideBudget(data, c.month, c.amount);
    case "addMove": return actions5.addMove(c.move);
  }
}

export function CompareBox({ c }: { c: Comparison }) {
  const [s0, s1] = c.slack;
  return (
    <div className="panel">
      <div className="kv"><span>余裕額</span><b className="num">{money(s0)} → <span className={s1 < 0 ? "neg" : ""}>{money(s1)}</span></b></div>
      <div className="kv"><span>{+c.budget.month.slice(5)}月の予算残額</span><b className="num">{money(c.budget.before)} → <span className={c.budget.after < 0 ? "neg" : ""}>{money(c.budget.after)}</span></b></div>
      <div className="kv"><span>口座残高の最低</span><b className={`num ${c.lowest.bank < 0 ? "neg" : ""}`}>{md(c.lowest.date)} {money(c.lowest.bank)}</b></div>
    </div>
  );
}

/**
 * 変更を、比べを見てから実行する。余裕額が 0 以上からマイナスになるなら、取崩順に確保額から差し引くかを聞く。
 * もとからマイナス・差し引ける確保額がないなら、注意だけ出して実行できる
 */
export function ConfirmChange({ store, data, today, change, label, onDone }: { store: Store; data: AppData; today: string; change: Change; label: string; onDone: () => void }) {
  const c = useMemo(() => compare(data, change, today), [data, change, today]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const ok = await store.run(async () => {
      for (const x of c.draw ?? []) await actions5.addMove({ plan_id: x.plan.id, kind: "draw", amount: x.amount, date: today, bonus_entry_id: null, entry_kind: null, entry_id: null, memo: "余裕額のマイナスを埋める" });
      await saveChange(data, change);
    });
    setBusy(false);
    if (ok) { toast("保存しました"); onDone(); }
  };
  return (
    <>
      <CompareBox c={c} />
      {c.draw && c.draw.length > 0 && <div className="alert">{c.draw.map((x) => `${x.plan.name}から ${money(x.amount)}`).join("、")} を差し引きます。よろしいですか？</div>}
      {c.warnOnly && <div className="alert bad">余裕額がマイナスです（{money(c.slack[1])}）。</div>}
      <div className="btns"><button className="btn" disabled={busy} onClick={run}>{c.draw?.length ? "差し引いて" : ""}{label}</button></div>
    </>
  );
}

/** 予定を入れる前の比べ。その月の予算残額が足りなければ、余裕額から予算に足す操作を出す */
export function PlanPreview({ store, data, today, change }: { store: Store; data: AppData; today: string; change: Change }) {
  const c = useMemo(() => compare(data, change, today), [data, change, today]);
  const [add, setAdd] = useState(false);
  if (!c.shortBudget) return <CompareBox c={c} />;
  const month = c.budget.month;
  const budget = budgetView(data, month, today).budget;
  return (
    <>
      <CompareBox c={c} />
      <div className="alert">{+month.slice(5)}月の予算が {money(c.shortBudget)} 不足。余裕額から予算に追加できます。 <button className="btn sm" onClick={() => setAdd(true)}>予算追加</button></div>
      {add && <ConfirmChange store={store} data={data} today={today} change={{ kind: "decideBudget", month, amount: budget + c.shortBudget }} label="予算追加" onDone={() => setAdd(false)} />}
    </>
  );
}
