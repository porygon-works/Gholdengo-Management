import { useMemo, useState } from "react";
import { addMonths, cardOf, loanAt, loanCorrections, PLAN_KIND_LABEL, plannedBonus, repayView, savedAt, ymOf, type Loan, type PlanKind, type V5Plan } from "../engine";
import { actions5, type AppData, type Store } from "../data/store";
import { Chip, Field, md, money, NumInput, Select, Sheet, toast } from "./common";
import { PartNum, type OpenPart } from "./Parts";
import { ConfirmChange } from "./Preview";

// v5 の計画（設計書 §3.3・§3.4）：借入・計画（返済・購入・貯蓄）・取崩順

const KINDS: PlanKind[] = ["repay", "buy", "save"];
const KIND5: Record<PlanKind, string> = { ...PLAN_KIND_LABEL, buy: "購入" };

function LoanSheet({ store, data, today, loan, onClose }: { store: Store; data: AppData; today: string; loan?: Loan; onClose: () => void }) {
  const s = data.settings;
  const [name, setName] = useState(loan?.name ?? "");
  const [card, setCard] = useState<string>(loan?.card ?? s.cards[0]?.id ?? "");
  const [payDay, setPayDay] = useState<number | "">(loan?.pay_day ?? 27);
  const [monthly, setMonthly] = useState<number | "">(loan?.monthly ?? "");
  const [balance, setBalance] = useState<number | "">("");
  const save = async () => {
    if (!name) { toast("返す先の名前を入れてください"); return; }
    const x = { plan_id: loan?.plan_id ?? null, name, card: card || null, monthly: Number(monthly) || 0, pay_day: card ? null : Number(payDay) || 27, sort: loan?.sort ?? data.v5.loans.length };
    const ok = await store.run(async () => {
      if (loan) { await actions5.updateLoan(loan.id, x); if (balance !== "") await actions5.setLoanBalance(loan.id, today, balance); }
      else await actions5.addLoan(x, Number(balance) || 0, today);
    });
    if (ok) { toast("保存しました"); onClose(); }
  };
  const remove = async () => { if (loan && confirm("この借入を消しますか？") && (await store.run(() => actions5.removeLoan(loan.id)))) onClose(); };
  return (
    <Sheet title={loan ? loan.name : "新規借入"} onClose={onClose}>
      <Field label="返す先"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="カード名のリボ" /></Field>
      <div className="grid2">
        <Field label="返済方法" hint={card ? "カードの請求と一緒に引き落とされる" : "口座から引き落とされる"}><Select value={card} options={[...s.cards.map((c) => c.id), ""]} labels={{ "": "口座", ...Object.fromEntries(s.cards.map((c) => [c.id, c.name])) }} onChange={setCard} /></Field>
        {!card && <Field label="返済日"><NumInput plain value={payDay} onChange={setPayDay} /></Field>}
        <Field label="毎月の返済額"><NumInput value={monthly} onChange={setMonthly} /></Field>
        <Field label={loan ? "借入残高（今日・更新するときだけ）" : "借入残高（今日）"} hint={loan ? "カードのサイトの額。前の記録との差は「借入残高の修正」" : undefined}><NumInput value={balance} onChange={setBalance} /></Field>
      </div>
      <div className="btns"><button className="btn" onClick={save}>保存</button><button className="btn ghost" onClick={onClose}>取消</button>{loan && <button className="btn danger" onClick={remove}>削除</button>}</div>
    </Sheet>
  );
}

const blank = (kind: PlanKind, today: string): Omit<V5Plan, "id"> => ({ kind, name: "", target: 0, due_date: kind === "save" ? null : `${addMonths(ymOf(today), 2)}-27`, monthly: 0, start_month: ymOf(today), draw_order: 0, no_draw: kind === "repay", done: false, sort: 0 });

function PlanSheet({ store, data, today, plan, onClose }: { store: Store; data: AppData; today: string; plan?: V5Plan; onClose: () => void }) {
  const [kind, setKind] = useState<PlanKind>(plan?.kind ?? "save");
  const base = plan ?? blank(kind, today);
  const [name, setName] = useState(base.name);
  const [target, setTarget] = useState<number | "">(base.target || "");
  const [due, setDue] = useState(base.due_date ?? "");
  const [monthly, setMonthly] = useState<number | "">(base.monthly || "");
  const [start, setStart] = useState(base.start_month ?? ymOf(today));
  const [loans, setLoans] = useState<string[]>(plan ? data.v5.loans.filter((l) => l.plan_id === plan.id).map((l) => l.id) : []);
  const [move, setMove] = useState<"" | "manual" | "bonus" | "draw">("");
  const [amount, setAmount] = useState<number | "">("");
  const bonuses = data.accounts.filter((e) => e.direction === "in" && e.group === "bonus" && e.date >= addMonths(ymOf(today), -1));
  const [bonusId, setBonusId] = useState(bonuses[0]?.id ?? "");

  const save = async () => {
    if (!name) { toast("名前を入れてください"); return; }
    const x: Omit<V5Plan, "id"> = { ...base, kind, name, target: kind === "repay" ? 0 : Number(target) || 0, due_date: kind === "save" ? null : due || null, monthly: kind === "repay" ? 0 : Number(monthly) || 0, start_month: start || null, sort: plan?.sort ?? data.v5.plans.length, draw_order: plan?.draw_order ?? data.v5.plans.length + 1 };
    const ok = await store.run(async () => {
      const id = plan ? (await actions5.updatePlan(plan.id, x), plan.id) : await actions5.addPlan(x);
      if (kind === "repay") for (const l of data.v5.loans) {
        const want = loans.includes(l.id) ? id : l.plan_id === id ? null : l.plan_id;
        if (want !== l.plan_id) await actions5.updateLoan(l.id, { plan_id: want });
      }
    });
    if (ok) { toast("保存しました"); if (!plan) onClose(); }
  };
  const remove = async () => { if (plan && confirm("この計画を消しますか？") && (await store.run(() => actions5.removePlan(plan.id)))) onClose(); };
  const moveChange = plan && amount ? { kind: "addMove" as const, move: { plan_id: plan.id, kind: move as "manual" | "bonus" | "draw", amount, date: move === "bonus" ? bonuses.find((b) => b.id === bonusId)?.date ?? today : today, bonus_entry_id: move === "bonus" ? bonusId : null, entry_kind: null, entry_id: null, memo: "" } } : null;
  const moves = plan ? data.v5.moves.filter((m) => m.plan_id === plan.id) : [];

  return (
    <Sheet title={plan ? plan.name : "新規計画"} onClose={onClose}>
      {!plan && <div className="seg" role="group" aria-label="種類">{KINDS.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND5[k]}</button>)}</div>}
      <Field label="名前"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "repay" ? "リボを12月に返す" : kind === "buy" ? "大きい買い物" : "生活費1か月分"} /></Field>
      <div className="grid2">
        {kind !== "repay" && <Field label="目標額"><NumInput value={target} onChange={setTarget} /></Field>}
        {kind !== "save" && <Field label="期日"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
        {kind !== "repay" && <Field label="毎月の積立額"><NumInput value={monthly} onChange={setMonthly} /></Field>}
        {kind !== "repay" && <Field label="始める月"><input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
      </div>
      {kind === "repay" && (
        <Field label="期日にまとめて返す借入">
          <div>{data.v5.loans.map((l) => <label key={l.id} className="check"><input type="checkbox" checked={loans.includes(l.id)} onChange={(e) => setLoans(e.target.checked ? [...loans, l.id] : loans.filter((x) => x !== l.id))} />{l.name}</label>)}</div>
        </Field>
      )}
      <div className="btns"><button className="btn" onClick={save}>保存</button>{plan && <button className="btn ghost" onClick={() => store.run(() => actions5.updatePlan(plan.id, { done: !plan.done }))}>{plan.done ? "完了解除" : "完了"}</button>}{plan && <button className="btn danger" onClick={remove}>削除</button>}</div>

      {plan && kind !== "repay" && (
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
  const [loanSheet, setLoanSheet] = useState<Loan | "new" | null>(null);
  const [planSheet, setPlanSheet] = useState<V5Plan | "new" | null>(null);
  const plans = [...data.v5.plans].sort((a, b) => +a.done - +b.done || a.sort - b.sort);
  const drawable = plans.filter((p) => p.kind !== "repay" && !p.done).sort((a, b) => a.draw_order - b.draw_order);
  const views = useMemo(() => new Map(plans.filter((p) => p.kind === "repay").map((p) => [p.id, repayView(data, p, today)])), [data, today]);
  const moveOrder = (i: number, k: number) => { const ids = drawable.map((p) => p.id); const j = i + k; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; store.run(() => actions5.setDrawOrder(ids)); };

  return (
    <>
      <section>
        <div className="sec-h"><h2>借入</h2><button className="btn sm" onClick={() => setLoanSheet("new")}>新規借入</button></div>
        {data.v5.loans.map((l) => {
          const p = loanAt(data, l, today);
          const fixes = loanCorrections(data, l);
          return (
            <div key={l.id} className="pcard" onClick={() => setLoanSheet(l)} role="button" tabIndex={0}>
              <div className="top"><span className="nm">{l.name}</span><span onClick={(e) => e.stopPropagation()}><PartNum part={fixes.length ? { ...p, rows: fixes } : p} open={openPart} /></span></div>
              <div className="meta">{l.card ? cardOf(data.settings, l.card).name : "口座"}・毎月 {money(l.monthly)}{fixes.length ? `・借入残高の修正 ${fixes.length}件` : ""}</div>
            </div>
          );
        })}
        {!data.v5.loans.length && <div className="empty">借入（リボなど）はありません</div>}
      </section>

      <section>
        <div className="sec-h"><h2>計画</h2><button className="btn sm" onClick={() => setPlanSheet("new")}>新規計画</button></div>
        {plans.map((p) => {
          if (p.kind === "repay") {
            const v = views.get(p.id);
            return (
              <div key={p.id} className="pcard" onClick={() => setPlanSheet(p)} role="button" tabIndex={0}>
                <div className="top"><span className="nm"><Chip>{KIND5[p.kind]}</Chip> {p.name}</span>{v && <Chip kind={v.ok ? "ok" : "bad"}>{v.ok ? "返済可" : "残高不足"}</Chip>}</div>
                <div className="meta">期日 {p.due_date ? md(p.due_date) : "―"}{p.done ? "・完了" : ""}</div>
                {v && (
                  <div className="stat3" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => openPart(v.due)}><span className="k">返済額</span><span className="n">{money(v.due.amount)}</span></button>
                    <button onClick={() => openPart(v.bankThen)}><span className="k">期日の口座残高</span><span className="n">{money(v.bankThen.amount)}</span></button>
                    <button onClick={() => openPart(v.slackAfter)}><span className="k">返済後の余裕額</span><span className={`n ${v.slackAfter.amount < 0 ? "neg" : ""}`}>{money(v.slackAfter.amount)}</span></button>
                  </div>
                )}
              </div>
            );
          }
          const now = savedAt(data, p, today);
          const end = savedAt(data, p, p.due_date ?? `${addMonths(ymOf(today), 12)}-01`, true);
          const ok = !p.target || end.amount >= p.target;
          const pb = plannedBonus(data, p);
          return (
            <div key={p.id} className="pcard" onClick={() => setPlanSheet(p)} role="button" tabIndex={0}>
              <div className="top"><span className="nm"><Chip>{KIND5[p.kind]}</Chip> {p.name}</span><span onClick={(e) => e.stopPropagation()}><PartNum part={now} open={openPart} /></span></div>
              <span className="meter"><i style={{ width: `${p.target ? Math.min(100, (now.amount / p.target) * 100) : 0}%` }} /></span>
              <div className="meta">目標額 {money(p.target)}{p.done ? "・完了" : p.target ? (ok ? "・達成見込" : "・不足見込") : ""}{p.due_date ? `・期日 ${md(p.due_date)}` : ""}{p.monthly ? `・毎月 ${money(p.monthly)}` : ""}{pb.length ? `・賞与配分（予定） ${money(pb.reduce((a, r) => a + r.amount, 0))}` : ""}{p.no_draw ? "・取崩不可" : ""}</div>
            </div>
          );
        })}
        {!plans.length && <div className="empty">計画はありません（貯蓄・購入・返済）</div>}
      </section>

      {drawable.length > 0 && (
        <section>
          <h2>取崩順 <small>余裕額がマイナスのとき上から取崩</small></h2>
          <div className="panel"><div className="list">
            {drawable.map((p, i) => (
              <div key={p.id} className="row" style={{ gridTemplateColumns: "auto 1fr auto", cursor: "default" }}>
                <span className="d num">{i + 1}</span>
                <span className="t"><div>{p.name}</div></span>
                <span className="a">
                  <label className="check"><input type="checkbox" checked={p.no_draw} onChange={(e) => store.run(() => actions5.updatePlan(p.id, { no_draw: e.target.checked }))} />取崩不可</label>
                  <button className="btn sm ghost" onClick={() => moveOrder(i, -1)} aria-label="上へ">↑</button>
                  <button className="btn sm ghost" onClick={() => moveOrder(i, 1)} aria-label="下へ">↓</button>
                </span>
              </div>
            ))}
          </div></div>
        </section>
      )}

      {loanSheet && <LoanSheet store={store} data={data} today={today} loan={loanSheet === "new" ? undefined : loanSheet} onClose={() => setLoanSheet(null)} />}
      {planSheet && <PlanSheet store={store} data={data} today={today} plan={planSheet === "new" ? undefined : data.v5.plans.find((p) => p.id === planSheet.id) ?? planSheet} onClose={() => setPlanSheet(null)} />}
    </>
  );
}
