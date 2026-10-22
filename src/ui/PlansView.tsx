import { useEffect, useMemo, useState } from "react";
import {
  addMonths, budgetFundDate, cardPayDate, closingFor, debtLeft, forecast, FUND_SOURCE_LABEL, lumpName, paidBefore, PLAN_KIND_LABEL, planDebts, planFunds, planLump, planNeed, planPays, planStatus, reserveAt, ymOf,
  type AccountEntry, type Forecast, type FundSource, type Plan, type PlanFund, type PlanKind,
} from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { Chip, Empty, Field, md, money, NumInput, Select, Sheet, toast, yen, ymLabel } from "./common";

const KIND_COLOR: Record<PlanKind, string> = { repay: "var(--bad)", buy: "var(--warn)", save: "var(--good)" };
export const KindChip = ({ k }: { k: PlanKind }) => <span className="chip kind" style={{ color: KIND_COLOR[k] }}>{PLAN_KIND_LABEL[k]}</span>;

/** 計画のそろい具合の表示 */
export function statusText(d: AppData, p: Plan, f: Forecast | null) {
  const st = planStatus(d, p, f);
  if (!p.use_date) return { st, got: st.got, sub: f ? `${md(f.end)}まで` : "", cls: "" };
  if (st.short <= 0) return { st, got: st.need, sub: "そろう", cls: "pos" };
  return { st, got: st.got, sub: st.ok ? `残り ${yen(st.short)} は予備から` : `${yen(st.short - Math.max(0, st.spare))} 足りない`, cls: st.ok ? "" : "neg" };
}

/** 次に来る計画の取引（支払い・確保額に入れる分・まとめて払う） */
function nextOf(d: AppData, p: Plan, today: string) {
  const rows = [
    ...planPays(d, p).map((e) => ({ date: e.date, name: e.name, amount: e.amount, status: e.status })),
    ...planFunds(d, p).map((f) => ({ date: f.date, name: f.name || FUND_SOURCE_LABEL[f.source], amount: f.amount, status: f.status })),
  ].filter((r) => r.date > today).sort((a, b) => a.date.localeCompare(b.date));
  return rows[0];
}

/** 計画の画面：計画の一覧と、確保額の内訳 */
export function PlansView({ store, data, today, openId, setOpenId }: { store: Store; data: AppData; today: string; openId: string | null; setOpenId: (id: string | null) => void }) {
  const f = useMemo(() => forecast(data, today), [data, today]);
  const [adding, setAdding] = useState(false);
  const live = data.plans.filter((p) => !p.done), done = data.plans.filter((p) => p.done);
  if (data.missing.length) return <div className="alert bad">計画を使うには、Supabase の SQL Editor で supabase/migrations/0007_plans_months.sql を実行してください。</div>;
  const row = (p: Plan) => {
    const s = statusText(data, p, f), nx = nextOf(data, p, today);
    return [
      <tr key={p.id} className="tap prow" onClick={() => setOpenId(p.id)}>
        <td className="memo"><KindChip k={p.kind} />{p.name}</td>
        <td className="num">{p.use_date ? md(p.use_date) : "―"}</td>
        <td className="num">{yen(s.st.need)}</td>
        <td className={`num ${s.cls}`}>{yen(s.got)}<div className="sub">{s.sub}</div></td>
      </tr>,
      nx && <tr key={p.id + "n"} className="tap pnext" onClick={() => setOpenId(p.id)}><td colSpan={4}>次 {md(nx.date)} {nx.name} {yen(nx.amount)} <Chip kind={nx.status === "confirmed" ? "ok" : "warn"}>{nx.status === "confirmed" ? "確定" : "予定"}</Chip></td></tr>,
    ];
  };
  const open = data.plans.find((p) => p.id === openId);
  return (
    <>
      <section>
        <h2>計画 <button className="btn sm ghost" onClick={() => setAdding(true)}>＋ 計画を足す</button></h2>
        {live.length ? (
          <div className="panel scroll">
            <table className="tbl plans">
              <thead><tr><th>計画</th><th>使う日</th><th>使う額</th><th>たまる額</th></tr></thead>
              <tbody>{live.map(row)}</tbody>
            </table>
          </div>
        ) : <Empty>計画はまだありません。リボをまとめて返す・大きい買い物・貯金などを足せます</Empty>}
      </section>
      {f && (
        <section>
          <h2>確保額の内訳 <small>給料日前日の口座残高</small></h2>
          <div className="panel scroll">
            <table className="tbl wide">
              <thead><tr><th>給料日前日</th><th>確保額</th><th>返済用</th><th>買い物用</th><th>貯蓄</th><th>予備</th></tr></thead>
              <tbody>{f.eves.map((d) => {
                const r = reserveAt(data, f, d)!;
                const cell = (v: number) => <td className="num">{v ? yen(v) : "―"}</td>;
                return <tr key={d}><td>{md(d)}</td><td className={`num ${r.total < 0 ? "neg" : ""}`}><b>{yen(r.total)}</b></td>{cell(r.byKind.repay)}{cell(r.byKind.buy)}{cell(r.byKind.save)}<td className={`num ${r.spare < 0 ? "neg" : ""}`}>{yen(r.spare)}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </section>
      )}
      {done.length > 0 && (
        <section>
          <details className="panel">
            <summary>終わった計画 {done.length}件</summary>
            <div className="list">{done.map((p) => <button key={p.id} className="row" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => setOpenId(p.id)}><span className="t"><div><KindChip k={p.kind} />{p.name}</div></span><span className="a num">{p.use_date ? md(p.use_date) : ""}</span></button>)}</div>
          </details>
        </section>
      )}
      {open && <PlanSheet store={store} data={data} plan={open} f={f} today={today} onClose={() => setOpenId(null)} />}
      {adding && <NewPlanSheet store={store} data={data} today={today} onClose={() => setAdding(false)} onMade={(id) => { setAdding(false); setOpenId(id); }} />}
    </>
  );
}

// ---------- 入力の部品（離れたときに保存する） ----------

function TextCell({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="cell" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() && v !== value) onSave(v.trim()); else setV(value); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}
function MoneyCell({ value, onSave, label }: { value: number; onSave: (v: number) => void; label: string }) {
  void label;
  const [v, setV] = useState<number | "">(value);
  useEffect(() => setV(value), [value]);
  return <span className="money cellmoney" onBlur={() => { const n = v === "" ? 0 : v; if (n !== value) onSave(n); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}><NumInput value={v} onChange={setV} /></span>;
}
/** 日付：ふだんは「11/26」と出し、タップすると日付の欄になる */
function DateCell({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const [edit, setEdit] = useState(false);
  if (!edit) return <button className="cell datebtn num" aria-label={`${label}を変える`} onClick={() => setEdit(true)}>{value ? md(value) : "日付"}</button>;
  return <input className="cell date" type="date" aria-label={label} autoFocus defaultValue={value} onBlur={(e) => { setEdit(false); if (e.target.value && e.target.value !== value) onSave(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}

const StatusBtn = ({ status, onClick }: { status: "plan" | "confirmed"; onClick: () => void }) => <button className={`chip btnchip ${status === "confirmed" ? "ok" : "warn"}`} onClick={onClick}>{status === "confirmed" ? "確定" : "予定"}</button>;

// ---------- 計画の中身 ----------

type Line =
  | { t: "pay"; date: string; e: AccountEntry }
  | { t: "fund"; date: string; f: PlanFund }
  | { t: "lump"; date: string; e: AccountEntry | null };

function PlanSheet({ store, data, plan: p, f, today, onClose }: { store: Store; data: AppData; plan: Plan; f: Forecast | null; today: string; onClose: () => void }) {
  const s = data.settings;
  const st = statusText(data, p, f);
  const debts = planDebts(data, p);
  const lump = planLump(data, p);
  const cards = Object.fromEntries(s.cards.map((c) => [c.id, c.name]));
  const run = (fn: () => Promise<unknown>, msg?: string) => store.run(fn).then((ok) => { if (ok && msg) toast(msg); });
  const lines: Line[] = [
    ...planPays(data, p).map((e) => ({ t: "pay" as const, date: e.date, e })),
    ...planFunds(data, p).map((x) => ({ t: "fund" as const, date: x.date, f: x })),
    ...(p.use_date && p.kind !== "save" ? [{ t: "lump" as const, date: p.use_date, e: lump }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.t === "lump" ? 1 : b.t === "lump" ? -1 : 0));
  const nextYm = (k: number) => addMonths(ymOf(today), k);

  const addPay = () => {
    const debt = debts[0];
    const ym = nextYm(1), card = s.cards[0].id;
    return run(() => actions.addPlanPay(p, { name: `${debt?.name ?? p.name}の支払い`, date: cardPayDate(closingFor(ym, s, card), s, card), amount: 0, card, debt_id: debt?.id ?? null, budget_month: ym }));
  };
  const addFund = (source: FundSource) => {
    const used = new Set(planFunds(data, p).filter((x) => x.source === "budget").map((x) => x.budget_month));
    const ym = Array.from({ length: 12 }, (_, k) => nextYm(k)).find((m) => !used.has(m)) ?? nextYm(0);
    const bonus = data.accounts.find((e) => e.direction === "in" && /賞与|ボーナス/.test(e.name) && e.date >= today);
    const x = source === "budget" ? { source, name: `${+ym.slice(5)}月の予算から`, date: budgetFundDate(data, ym), budget_month: ym, amount: 0 }
      : source === "bonus" ? { source, name: "賞与から", date: bonus?.date ?? today, budget_month: null, amount: 0 }
        : { source, name: "予備から", date: today, budget_month: null, amount: 0 };
    return run(() => actions.addFund(p, x));
  };
  const remove = async () => {
    if (!confirm(`計画「${p.name}」を消しますか？（予定の取引も消えます。確定した取引は残ります）`)) return;
    await run(() => actions.deletePlan(data, p.id), "計画を消しました");
    onClose();
  };

  return (
    <Sheet title={p.name} onClose={onClose}>
      <div className="planhead"><KindChip k={p.kind} /><TextCell label="計画の名前" value={p.name} onSave={(v) => run(() => actions.updatePlan(p.id, { name: v }))} /></div>
      <div className="readout">
        {p.kind !== "save" && <div className="kv"><span>{p.kind === "repay" ? "まとめて返す日" : "使う日"}</span><b><DateCell label="使う日" value={p.use_date ?? ""} onSave={(v) => run(() => actions.updatePlan(p.id, { use_date: v }))} /></b></div>}
        {p.kind === "repay"
          ? <div className="kv"><span>まとめて返す額</span><b className="num">{money(st.st.need)}</b></div>
          : <div className="kv"><span>{p.kind === "save" ? "目標額" : "使う額"}</span><b><MoneyCell label="金額" value={p.target} onSave={(v) => run(() => actions.updatePlan(p.id, { target: v }))} /></b></div>}
        <div className="kv"><span>確保額にたまる額</span><b className={`num ${st.cls}`}>{yen(st.got)}{st.sub && `・${st.sub}`}</b></div>
      </div>

      {p.kind === "repay" && (
        <>
          <h4>残高 <small>カードのサイトで見た額に直せます</small></h4>
          <div className="plines">
            {debts.map((x) => (
              <div className="pline" key={x.id}>
                <div className="pmain">
                  <TextCell label="先の名前" value={x.name} onSave={(v) => run(() => actions.updateDebt(x.id, { name: v }))} />
                  <div className="prow2">
                    <MoneyCell label="残高" value={x.balance} onSave={(v) => run(() => actions.updateDebt(x.id, { balance: v, as_of: today }), "残高を直しました")} />
                    <span className="num">→ <b>{yen(debtLeft(data, p, x))}</b></span>
                    <button className="x" aria-label="この残高を消す" onClick={() => { if (confirm(`「${x.name}」を消しますか？`)) run(() => actions.deleteDebt(x.id)); }}>×</button>
                  </div>
                  <div className="sub">{md(x.as_of)}に見た残高{paidBefore(data, p, x) ? `・まとめて返すまでに ${yen(paidBefore(data, p, x))} 払う` : ""}</div>
                </div>
              </div>
            ))}
            <div className="kv tot"><span>合計 {yen(debts.reduce((a, x) => a + x.balance, 0))}{debts.some((x) => paidBefore(data, p, x)) ? ` − 先に払う ${yen(debts.reduce((a, x) => a + paidBefore(data, p, x), 0))}` : ""}</span><b className="num">{yen(planNeed(data, p))}</b></div>
          </div>
          <div className="btns"><button className="btn sm ghost" onClick={() => run(() => actions.addDebt(p.id, "カード", 0, today, debts.length))}>＋ 残高</button></div>
        </>
      )}

      <h4>予定の取引</h4>
      <div className="plines">
        {lines.map((l) => {
          if (l.t === "pay") {
            const e = l.e;
            return (
              <div className="pline" key={e.id}>
                <DateCell label="日" value={e.date} onSave={(v) => run(() => actions.updatePlanEntry(e.id, { date: v }))} />
                <div className="pmain">
                  <TextCell label="内容" value={e.name} onSave={(v) => run(() => actions.updatePlanEntry(e.id, { name: v }))} />
                  <div className="prow2">
                    <MoneyCell label="金額" value={e.amount} onSave={(v) => run(() => actions.updatePlanEntry(e.id, { amount: v }))} />
                    <StatusBtn status={e.status} onClick={() => run(() => actions.setStatus("account_entries", e.id, e.status === "confirmed" ? "plan" : "confirmed"))} />
                    <button className="x" aria-label="消す" onClick={() => run(() => actions.deletePlanEntry(e.id))}>×</button>
                  </div>
                  <div className="sub">口座から出る{e.card ? `（${cards[e.card] ?? e.card}の請求と一緒）` : ""}・{+(e.budget_month ?? ymOf(e.date)).slice(5)}月の予算から</div>
                </div>
              </div>
            );
          }
          if (l.t === "fund") {
            const x = l.f;
            return (
              <div className="pline" key={x.id}>
                <DateCell label="日" value={x.date} onSave={(v) => run(() => actions.updateFund(x.id, { date: v }))} />
                <div className="pmain">
                  <TextCell label="内容" value={x.name || FUND_SOURCE_LABEL[x.source]} onSave={(v) => run(() => actions.updateFund(x.id, { name: v }))} />
                  <div className="prow2">
                    <MoneyCell label="金額" value={x.amount} onSave={(v) => run(() => actions.updateFund(x.id, { amount: v }))} />
                    <StatusBtn status={x.status} onClick={() => run(() => actions.setStatus("plan_funds", x.id, x.status === "confirmed" ? "plan" : "confirmed"))} />
                    <button className="x" aria-label="消す" onClick={() => run(() => actions.deleteFund(x.id))}>×</button>
                  </div>
                  <div className="sub">確保額へ・{FUND_SOURCE_LABEL[x.source]}{x.source === "budget" && x.budget_month ? `（${+x.budget_month.slice(5)}月の予算を減らす）` : ""}</div>
                </div>
              </div>
            );
          }
          const e = l.e;
          return (
            <div className="pline tot" key="lump">
              <span className="cell datebtn num">{md(l.date)}</span>
              <div className="pmain">
                {e ? <TextCell label="内容" value={e.name} onSave={(v) => run(() => actions.updatePlanEntry(e.id, { name: v }))} /> : <span className="cell">{lumpName(p.kind)}（{p.name}）</span>}
                <div className="prow2">
                  <b className="num amt">{yen(e && e.status === "confirmed" ? e.amount : st.st.need)}</b>
                  {e ? <StatusBtn status={e.status} onClick={() => run(() => actions.setStatus("account_entries", e.id, e.status === "confirmed" ? "plan" : "confirmed"))} /> : <Chip kind="warn">予定</Chip>}
                </div>
                <div className="sub">確保額から{p.kind === "repay" ? "・額は残高から出します" : ""}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="btns">
        {p.kind === "repay" && <button className="btn sm ghost" onClick={addPay}>＋ 支払い</button>}
        <button className="btn sm ghost" onClick={() => addFund("budget")}>＋ 予算から</button>
        <button className="btn sm ghost" onClick={() => addFund("bonus")}>＋ 賞与から</button>
        <button className="btn sm ghost" onClick={() => addFund("spare")}>＋ 予備から</button>
      </div>
      <div className="note">支払いは口座から出るお金（その月の予算から引きます）。確保額へ入れる分は口座に残しておくお金で、使う日にまとめて使います。</div>
      <div className="btns end">
        <button className="btn danger sm" onClick={remove}>計画を消す</button>
        <button className="btn ghost sm" onClick={() => run(() => actions.updatePlan(p.id, { done: !p.done }), p.done ? "計画を戻しました" : "終わった計画にしました")}>{p.done ? "終わったのを戻す" : "終わった"}</button>
        <button className="btn" onClick={onClose}>閉じる</button>
      </div>
    </Sheet>
  );
}

// ---------- 計画を足す ----------

function NewPlanSheet({ store, data, today, onClose, onMade }: { store: Store; data: AppData; today: string; onClose: () => void; onMade: (id: string) => void }) {
  const s = data.settings;
  const cur = ymOf(today);
  const bonus = data.accounts.find((e) => e.direction === "in" && /賞与|ボーナス/.test(e.name) && e.date >= today);
  const [kind, setKind] = useState<PlanKind>("repay");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [use, setUse] = useState("");
  const [monthly, setMonthly] = useState<number | "">("");
  const [start, setStart] = useState(addMonths(cur, 1));
  const [months, setMonths] = useState<number | "">(6);
  const [card, setCard] = useState<string>(s.cards[0].id);
  const [bonusAmt, setBonusAmt] = useState<number | "">("");
  const [bonusDate, setBonusDate] = useState(bonus?.date ?? "");
  const [busy, setBusy] = useState(false);
  const label = kind === "repay" ? { amount: "いまの残高", use: "まとめて返す日", monthly: "毎月の支払い" } : kind === "buy" ? { amount: "使う額", use: "使う日", monthly: "毎月ためる額（予算から）" } : { amount: "目標額", use: "", monthly: "毎月ためる額（予算から）" };
  const make = async () => {
    if (!name) { toast("名前を入れてください"); return; }
    setBusy(true);
    let id = "";
    const ok = await store.run(async () => {
      id = await actions.createPlan(data, { kind, name, amount: Number(amount) || 0, use_date: kind === "save" ? null : use || null, monthly: Number(monthly) || 0, start, months: Number(months) || 0, card: kind === "repay" ? card || null : null, day: 27, debtName: name, bonus: Number(bonusAmt) || 0, bonusDate: bonusDate || today, today });
    });
    setBusy(false);
    if (ok) { toast("計画を作りました"); onMade(id); }
  };
  const monthOpts = Array.from({ length: 12 }, (_, k) => addMonths(cur, k));
  return (
    <Sheet title="計画を足す" onClose={onClose}>
      <div className="seg" role="group" aria-label="種類">
        {(["repay", "buy", "save"] as PlanKind[]).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{PLAN_KIND_LABEL[k]}</button>)}
      </div>
      <Field label="名前"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "repay" ? "リボを全額返す など" : kind === "buy" ? "新しいPC など" : "給料1か月分 など"} /></Field>
      <div className="grid2">
        <Field label={label.amount}><NumInput value={amount} onChange={setAmount} /></Field>
        {kind !== "save" && <Field label={label.use}><input type="date" value={use} onChange={(e) => setUse(e.target.value)} /></Field>}
        <Field label={label.monthly}><NumInput value={monthly} onChange={setMonthly} /></Field>
        <Field label="始める月"><Select value={start} options={monthOpts} labels={Object.fromEntries(monthOpts.map((m) => [m, ymLabel(m)]))} onChange={setStart} /></Field>
        <Field label="何か月分"><NumInput plain value={months} onChange={setMonths} /></Field>
        {kind === "repay" && <Field label="払い方"><Select value={card} options={["", ...s.cards.map((c) => c.id)]} labels={{ "": "口座から", ...Object.fromEntries(s.cards.map((c) => [c.id, `${c.name}の請求と一緒`])) }} onChange={setCard} /></Field>}
      </div>
      <div className="grid2">
        <Field label="賞与から確保額へ"><NumInput value={bonusAmt} onChange={setBonusAmt} /></Field>
        <Field label="賞与の日"><input type="date" value={bonusDate} onChange={(e) => setBonusDate(e.target.value)} /></Field>
      </div>
      <div className="note">{kind === "repay" ? "毎月の支払いは予定の取引になり、その月の予算から引きます。まとめて返す額は、残高から先に払う分を引いて出します。" : "毎月ためる額は、その月の予算から引いて確保額に入れます（カードの引落日に口座に残る分）。"}あとから1行ずつ直せます。</div>
      <div className="btns end"><button className="btn ghost" onClick={onClose}>やめる</button><button className="btn" onClick={make} disabled={busy}>作る</button></div>
    </Sheet>
  );
}
