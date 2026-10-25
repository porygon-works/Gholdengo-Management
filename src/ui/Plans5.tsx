import { useMemo, useState } from "react";
import { addMonths, cardOf, loanAt, loanCorrections, plannedBonus, repayView, savedAt, ymOf, type Loan, type PlanKind, type V5Plan } from "../engine";
import { actions5, type AppData, type Store } from "../data/store";
import { Chip, Field, md, money, NumInput, Select, Sheet, toast } from "./common";
import { PartNum, type OpenPart } from "./Parts";
import { ConfirmChange } from "./Preview";

// v5 の計画（設計書 §3.3・§3.4）：返済計画（返済先を含む）・貯蓄計画

/** 貯蓄計画は、使う日があれば buy（積立が使う日で止まり、買った明細をひも付けられる）、なければ save */
const saveKind = (due: string): PlanKind => (due ? "buy" : "save");

function LoanSheet({ store, data, today, loan, planId, onClose }: { store: Store; data: AppData; today: string; loan?: Loan; planId?: string | null; onClose: () => void }) {
  const s = data.settings;
  const repays = data.v5.plans.filter((p) => p.kind === "repay");
  const [plan, setPlan] = useState<string>(loan ? loan.plan_id ?? "" : planId ?? "");
  // 借入残高の欄には、いまの借入残高を最初から出す。額を変えたときだけ、今日の記録にする（設計書 §3.4）
  const now = loan ? loanAt(data, loan, today).amount : null;
  const [name, setName] = useState(loan?.name ?? "");
  const [card, setCard] = useState<string>(loan?.card ?? s.cards[0]?.id ?? "");
  const [payDay, setPayDay] = useState<number | "">(loan?.pay_day ?? 27);
  const [monthly, setMonthly] = useState<number | "">(loan?.monthly ?? "");
  const [balance, setBalance] = useState<number | "">(now ?? "");
  const save = async () => {
    if (!name) { toast("返す先の名前を入れてください"); return; }
    const x = { plan_id: plan || null, name, card: card || null, monthly: Number(monthly) || 0, pay_day: card ? null : Number(payDay) || 27, sort: loan?.sort ?? data.v5.loans.length };
    const ok = await store.run(async () => {
      if (loan) { await actions5.updateLoan(loan.id, x); if (balance !== "" && balance !== now) await actions5.setLoanBalance(loan.id, today, balance); }
      else await actions5.addLoan(x, Number(balance) || 0, today);
    });
    if (ok) { toast("保存しました"); onClose(); }
  };
  const remove = async () => { if (loan && confirm("この返済先を消しますか？") && (await store.run(() => actions5.removeLoan(loan.id)))) onClose(); };
  return (
    <Sheet title={loan ? loan.name : "新規返済先"} onClose={onClose}>
      <Field label="返済先"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="カード名のリボ" /></Field>
      <Field label="返済計画"><Select value={plan} options={[...repays.map((p) => p.id), ""]} labels={{ "": "なし（毎月の返済だけ）", ...Object.fromEntries(repays.map((p) => [p.id, p.name])) }} onChange={setPlan} /></Field>
      <div className="grid2">
        <Field label="返済方法" hint={card ? "カードの請求と一緒に引き落とされる" : "口座から引き落とされる"}><Select value={card} options={[...s.cards.map((c) => c.id), ""]} labels={{ "": "口座", ...Object.fromEntries(s.cards.map((c) => [c.id, c.name])) }} onChange={setCard} /></Field>
        {!card && <Field label="返済日"><NumInput plain value={payDay} onChange={setPayDay} /></Field>}
        <Field label="毎月の返済額"><NumInput value={monthly} onChange={setMonthly} /></Field>
        <Field label="借入残高（今日）" hint={loan ? "カードのサイトの額に直すと、差は「借入残高の修正」" : undefined}><NumInput value={balance} onChange={setBalance} /></Field>
      </div>
      <div className="btns"><button className="btn" onClick={save}>保存</button><button className="btn ghost" onClick={onClose}>取消</button>{loan && <button className="btn danger" onClick={remove}>削除</button>}</div>
    </Sheet>
  );
}

const blank = (kind: PlanKind, today: string): Omit<V5Plan, "id"> => ({ kind, name: "", target: 0, due_date: kind === "repay" ? `${addMonths(ymOf(today), 2)}-27` : null, monthly: 0, start_month: addMonths(ymOf(today), 1), draw_order: 0, no_draw: kind === "repay", done: false, sort: 0 });

function PlanSheet({ store, data, today, plan, repay, onClose }: { store: Store; data: AppData; today: string; plan?: V5Plan; repay: boolean; onClose: () => void }) {
  const base = plan ?? blank(repay ? "repay" : "save", today);
  const [name, setName] = useState(base.name);
  const [target, setTarget] = useState<number | "">(base.target || "");
  const [due, setDue] = useState(base.due_date ?? "");
  const [monthly, setMonthly] = useState<number | "">(base.monthly || "");
  const [start, setStart] = useState(base.start_month ?? addMonths(ymOf(today), 1));
  const [move, setMove] = useState<"" | "manual" | "bonus" | "draw">("");
  const [amount, setAmount] = useState<number | "">("");
  const bonuses = data.accounts.filter((e) => e.direction === "in" && e.group === "bonus" && e.date >= addMonths(ymOf(today), -1));
  const [bonusId, setBonusId] = useState(bonuses[0]?.id ?? "");

  const save = async () => {
    if (!name) { toast("名前を入れてください"); return; }
    const x: Omit<V5Plan, "id"> = { ...base, kind: repay ? "repay" : saveKind(due), name, target: repay ? 0 : Number(target) || 0, due_date: due || null, monthly: repay ? 0 : Number(monthly) || 0, start_month: start || null, sort: plan?.sort ?? data.v5.plans.length, draw_order: plan?.draw_order ?? data.v5.plans.length + 1 };
    const ok = await store.run(async () => { if (plan) await actions5.updatePlan(plan.id, x); else await actions5.addPlan(x); });
    if (ok) { toast("保存しました"); if (!plan) onClose(); }
  };
  const remove = async () => { if (plan && confirm("この計画を消しますか？") && (await store.run(() => actions5.removePlan(plan.id)))) onClose(); };
  const moveChange = plan && amount ? { kind: "addMove" as const, move: { plan_id: plan.id, kind: move as "manual" | "bonus" | "draw", amount, date: move === "bonus" ? bonuses.find((b) => b.id === bonusId)?.date ?? today : today, bonus_entry_id: move === "bonus" ? bonusId : null, entry_kind: null, entry_id: null, memo: "" } } : null;
  const moves = plan ? data.v5.moves.filter((m) => m.plan_id === plan.id) : [];

  return (
    <Sheet title={plan ? plan.name : repay ? "新規返済計画" : "新規貯蓄計画"} onClose={onClose}>
      <Field label="名前"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={repay ? "リボを12月に返す" : "生活費1か月分"} /></Field>
      <div className="grid2">
        {!repay && <Field label="目標額"><NumInput value={target} onChange={setTarget} /></Field>}
        <Field label={repay ? "期日" : "使う日"} hint={repay ? "まとめて返す日。空なら毎月の返済だけ" : "大きい買い物など。あると、ためた額を確保額として余裕額から引き、買った明細をひも付けられる。なければ余裕額に含めたまま「うち貯蓄」に出す"}><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        {!repay && <Field label="毎月の積立額"><NumInput value={monthly} onChange={setMonthly} /></Field>}
        {!repay && <Field label="始める月"><input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
      </div>
      {repay && <div className="note">返済先は、計画のタブの返済計画の中で「返済先追加」から入れます。</div>}
      <div className="btns"><button className="btn" onClick={save}>保存</button>{plan && <button className="btn ghost" onClick={() => store.run(() => actions5.updatePlan(plan.id, { done: !plan.done }))}>{plan.done ? "完了解除" : "完了"}</button>}{plan && <button className="btn danger" onClick={remove}>削除</button>}</div>

      {plan && !repay && (
        <>
          <h2>入出金</h2>
          <div className="seg" role="group" aria-label="出し入れ">
            {(["manual", "bonus", "draw"] as const).map((k) => <button key={k} type="button" aria-pressed={move === k} onClick={() => setMove(k)}>{{ manual: "積立追加", bonus: "賞与配分", draw: "取崩" }[k]}</button>)}
          </div>
          {move && (
            <div className="grid2">
              {move === "bonus" && <Field label="賞与">{bonuses.length ? <Select value={bonusId} options={bonuses.map((b) => b.id)} labels={Object.fromEntries(bonuses.map((b) => [b.id, `${md(b.date)} ${b.name} ${money(b.amount)}${b.status === "plan" ? "（予定）" : ""}`]))} onChange={setBonusId} /> : <div className="note">設定の「給与・賞与」で賞与を入れてください</div>}</Field>}
              <Field label="額"><NumInput value={amount} onChange={setAmount} /></Field>
            </div>
          )}
          {moveChange && (move !== "bonus" || bonusId) && <ConfirmChange store={store} data={data} today={today} change={moveChange} label="確定" onDone={() => { setAmount(""); setMove(""); }} />}
          {moves.length > 0 && (
            <div className="panel"><div className="list">
              {moves.map((m) => (
                <div key={m.id} className="row" style={{ cursor: "default" }}>
                  <span className="d num">{md(m.date)}</span>
                  <span className="t"><div>{{ manual: "積立追加", bonus: "賞与配分", draw: "取崩", spend: "購入" }[m.kind]} {m.memo}</div></span>
                  <span className="a num">{m.kind === "draw" || m.kind === "spend" ? "−" : ""}{money(m.amount)} <button className="btn sm ghost" onClick={() => store.run(() => actions5.removeMove(m.id))}>削除</button></span>
                </div>
              ))}
            </div></div>
          )}
        </>
      )}
    </Sheet>
  );
}

export function Plans5({ store, data, today, openPart }: { store: Store; data: AppData; today: string; openPart: OpenPart }) {
  const [loanSheet, setLoanSheet] = useState<{ loan?: Loan; planId?: string | null } | null>(null);
  const [planSheet, setPlanSheet] = useState<{ plan?: V5Plan; repay: boolean } | null>(null);
  const plans = [...data.v5.plans].sort((a, b) => +a.done - +b.done || a.sort - b.sort);
  const repays = plans.filter((p) => p.kind === "repay");
  const saves = plans.filter((p) => p.kind !== "repay");
  const loose = data.v5.loans.filter((l) => !repays.some((p) => p.id === l.plan_id));
  const views = useMemo(() => new Map(repays.map((p) => [p.id, repayView(data, p, today)])), [data, today]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 返済先の1行：返済方法・毎月の返済額と、いまの借入残高 */
  const loanRow = (l: Loan) => {
    const p = loanAt(data, l, today);
    const fixes = loanCorrections(data, l);
    return (
      <div key={l.id} className="row" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => setLoanSheet({ loan: l })} role="button" tabIndex={0}>
        <span className="t"><div>{l.name}</div><div>{l.card ? cardOf(data.settings, l.card).name : "口座"}・毎月 {money(l.monthly)}{fixes.length ? `・借入残高の修正 ${fixes.length}件` : ""}</div></span>
        <span className="a" onClick={(e) => e.stopPropagation()}><PartNum part={fixes.length ? { ...p, rows: fixes } : p} open={openPart} /></span>
      </div>
    );
  };

  return (
    <>
      <section>
        <div className="sec-h"><h2>返済計画</h2><button className="btn sm" onClick={() => setPlanSheet({ repay: true })}>新規返済計画</button></div>
        {repays.map((p) => {
          const v = views.get(p.id);
          const ls = data.v5.loans.filter((l) => l.plan_id === p.id);
          return (
            <div key={p.id} className="pcard" onClick={() => setPlanSheet({ plan: p, repay: true })} role="button" tabIndex={0}>
              <div className="top"><span className="nm">{p.name}</span>{v && !p.done && <Chip kind={v.ok ? "ok" : "bad"}>{v.ok ? "返済可" : "残高不足"}</Chip>}</div>
              <div className="meta">{p.due_date ? `期日 ${md(p.due_date)}` : "期日なし（毎月の返済だけ）"}{p.done ? "・完了" : ""}</div>
              {v && (
                <div className="stat3" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => openPart(v.due)}><span className="k">返済額</span><span className="n">{money(v.due.amount)}<span className="go">›</span></span></button>
                  <button onClick={() => openPart(v.bankThen)}><span className="k">期日の口座残高</span><span className="n">{money(v.bankThen.amount)}<span className="go">›</span></span></button>
                  <button onClick={() => openPart(v.lowAfter)}><span className="k">返済後の最低残高</span><span className={`n ${v.lowAfter.amount < 0 ? "neg" : ""}`}>{money(v.lowAfter.amount)}<span className="go">›</span></span></button>
                </div>
              )}
              <div className="list" onClick={(e) => e.stopPropagation()}>{ls.map(loanRow)}</div>
              <div className="btns" onClick={(e) => e.stopPropagation()}><button className="btn sm ghost" onClick={() => setLoanSheet({ planId: p.id })}>返済先追加</button></div>
            </div>
          );
        })}
        {loose.length > 0 && (
          <div className="pcard">
            <div className="top"><span className="nm">返済計画なし</span></div>
            <div className="meta">毎月の返済だけ。まとめて返すなら、返済先を開いて返済計画を選ぶ</div>
            <div className="list">{loose.map(loanRow)}</div>
          </div>
        )}
        {!repays.length && !loose.length && <div className="empty">返済計画はありません（リボなどを返す計画）</div>}
      </section>

      <section>
        <div className="sec-h"><h2>貯蓄計画</h2><button className="btn sm" onClick={() => setPlanSheet({ repay: false })}>新規貯蓄計画</button></div>
        {saves.map((p) => {
          const now = savedAt(data, p, today);
          const end = savedAt(data, p, p.due_date ?? `${addMonths(ymOf(today), 12)}-01`, true);
          const ok = !p.target || end.amount >= p.target;
          const pb = plannedBonus(data, p);
          return (
            <div key={p.id} className="pcard" onClick={() => setPlanSheet({ plan: p, repay: false })} role="button" tabIndex={0}>
              <div className="top"><span className="nm">{p.name}</span><span onClick={(e) => e.stopPropagation()}><PartNum part={now} open={openPart} /></span></div>
              <span className="meter"><i style={{ width: `${p.target ? Math.min(100, (now.amount / p.target) * 100) : 0}%` }} /></span>
              <div className="meta">目標額 {money(p.target)}{p.done ? "・完了" : p.target ? (ok ? "・達成見込" : "・不足見込") : ""}{p.due_date ? `・使う日 ${md(p.due_date)}` : ""}{p.monthly ? `・毎月 ${money(p.monthly)}` : ""}{pb.length ? `・賞与配分（予定） ${money(pb.reduce((a, r) => a + r.amount, 0))}` : ""}{p.due_date ? "・確保額" : "・余裕額に含む"}</div>
            </div>
          );
        })}
        {!saves.length && <div className="empty">貯蓄計画はありません（生活費1か月分・大きい買い物など）</div>}
      </section>

      {loanSheet && <LoanSheet store={store} data={data} today={today} loan={loanSheet.loan} planId={loanSheet.planId} onClose={() => setLoanSheet(null)} />}
      {planSheet && <PlanSheet store={store} data={data} today={today} repay={planSheet.repay} plan={planSheet.plan && (data.v5.plans.find((p) => p.id === planSheet.plan!.id) ?? planSheet.plan)} onClose={() => setPlanSheet(null)} />}
    </>
  );
}
