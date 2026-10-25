import { useMemo, useState } from "react";
import { addDays, addMonths, bankOn, billsFor, budgetCats, IN_GROUPS, loanAt, RESERVE, ymOf, type AccountGroup, type Bill, type Change, type Status } from "../engine";
import { actions, actions5, type AppData, type Store } from "../data/store";
import { defaultStatus, incomeChange, spendChange } from "../data/v5ops";
import { ACCOUNT_GROUP_LABEL, Field, md, money, NumInput, Select, toast, yen } from "./common";
import { ConfirmChange } from "./Preview";
import { AccountRow, CardRow } from "./Rows";
import type { Open } from "./Sheets";

// 入力（設計書 §4.4）：何か入れたいときに開く1か所。出金・入金・残高・計画を上で切り替える。開いたときは出金

export type InputKind = "out" | "in" | "balance" | "plan";
const KINDS: [InputKind, string][] = [["out", "出金"], ["in", "入金"], ["balance", "残高"], ["plan", "計画"]];

/** 払い方：設定のカード（あとから足せる）・PayPay・口座・現金（ATM で引き出した額。設計書 §3.6） */
const payOptions = (d: AppData) => [...d.settings.cards.map((c) => `card:${c.id}`), "paypay", "bank", "atm"];
const payLabels = (d: AppData): Record<string, string> => ({ ...Object.fromEntries(d.settings.cards.map((c) => [`card:${c.id}`, c.name])), paypay: "PayPay", bank: "口座", atm: "現金" });

/** 予定か確定か。最初の値は日付から決め、本人が切り替えたらその値を使う */
function useStatus(date: string, today: string) {
  const [picked, setPicked] = useState<Status | null>(null);
  return [picked ?? defaultStatus(date, today), setPicked, () => setPicked(null)] as const;
}

function StatusSeg({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <div className="seg" role="group" aria-label="予定か確定か">
      {(["confirmed", "plan"] as Status[]).map((x) => <button key={x} type="button" aria-pressed={value === x} onClick={() => onChange(x)}>{x === "plan" ? "予定" : "確定"}</button>)}
    </div>
  );
}

function OutForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const s = data.settings;
  const cats = budgetCats(s).filter((c) => c !== RESERVE && c !== "現金");
  const [cat, setCat] = useState(cats[0]);
  const [amount, setAmount] = useState<number | "">("");
  const [pay, setPay] = useState(payOptions(data)[0]);
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [status, setStatus, resetStatus] = useStatus(date, today);
  const [more, setMore] = useState(false);
  const [tatekae, setTatekae] = useState<number | "">("");
  const [memo, setMemo] = useState("");
  const [refund, setRefund] = useState(true);
  const isCard = pay.startsWith("card:");
  const tk = isCard ? Number(tatekae) || 0 : 0;
  const change = useMemo<Change | null>(() => (amount ? spendChange(s, { pay, cat, amount, date, name, status, tatekae: tk, memo }) : null), [s, pay, cat, amount, date, name, status, tk, memo]);
  const done = async () => {
    // 立て替えた分は、返してもらう予定を口座明細の入金に入れる（未回収立替として余裕額に足す）
    if (tk > 0 && refund) await store.run(() => actions.addAccount({ account: "bank", direction: "in", status: "plan", group: "refund", category: null, name: `立替の返金（${name || cat}）`, date: addDays(date, 7), amount: Math.min(tk, Number(amount) || 0) }));
    setAmount(""); setName(""); setTatekae(""); setMemo(""); setDate(today); resetStatus(); setMore(false);
  };
  return (
    <div className="panel quick">
      <div className="grid2">
        {pay === "atm" ? <Field label="費目"><input value="現金" disabled /></Field> : <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>}
        <Field label="金額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
      </div>
      <Field group label="払い方" hint={pay === "atm" ? "ATM で引き出した額を、その日に使ったものにする" : undefined}>
        <div className="seg" role="group" aria-label="払い方">
          {payOptions(data).map((k) => <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}>{payLabels(data)[k]}</button>)}
        </div>
      </Field>
      <div className="grid2">
        <Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value || today)} /></Field>
        <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={pay === "paypay" ? "PayPayチャージ" : "お店・商品など"} /></Field>
      </div>
      <StatusSeg value={status} onChange={setStatus} />
      {more ? (
        <>
          {isCard && <Field label="立替額" hint="立て替えた分は予算に数えない。全額なら大費目を立替にする"><NumInput value={tatekae} onChange={setTatekae} /></Field>}
          {tk > 0 && <label className="check"><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />立替の返金予定（{md(addDays(date, 7))}・¥{yen(Math.min(tk, Number(amount) || 0))}）</label>}
          <Field label="メモ"><input value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
        </>
      ) : <div className="btns"><button className="btn sm ghost" onClick={() => setMore(true)}>詳細（立替・メモ）</button></div>}
      {change && <ConfirmChange store={store} data={data} today={today} change={change} label="入力" onDone={done} />}
    </div>
  );
}

function InForm({ store, data, today, group: g0 }: { store: Store; data: AppData; today: string; group?: AccountGroup }) {
  const [group, setGroup] = useState<AccountGroup>(g0 ?? "salary");
  const [amount, setAmount] = useState<number | "">("");
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [status, setStatus, resetStatus] = useStatus(date, today);
  const change = useMemo<Change | null>(() => (amount ? incomeChange({ group, amount, date, name, status }) : null), [group, amount, date, name, status]);
  return (
    <div className="panel quick">
      <Field group label="区分">
        <div className="seg" role="group" aria-label="区分">
          {IN_GROUPS.map((k) => <button key={k} type="button" aria-pressed={group === k} onClick={() => setGroup(k)}>{ACCOUNT_GROUP_LABEL[k]}</button>)}
        </div>
      </Field>
      <div className="grid2">
        <Field label="金額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
        <Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value || today)} /></Field>
      </div>
      <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={ACCOUNT_GROUP_LABEL[group]} /></Field>
      <StatusSeg value={status} onChange={setStatus} />
      {change && <ConfirmChange store={store} data={data} today={today} change={change} label="入力" onDone={() => { setAmount(""); setName(""); setDate(today); resetStatus(); }} />}
    </div>
  );
}

type BalanceKind = "bank" | "loan" | "bill";

function BalanceForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const [kind, setKind] = useState<BalanceKind>("bank");
  return (
    <div className="panel quick">
      <div className="seg" role="group" aria-label="どの残高か">
        {([["bank", "口座残高"], ["loan", "借入残高"], ["bill", "請求額"]] as [BalanceKind, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {kind === "bank" && <BankForm store={store} data={data} today={today} />}
      {kind === "loan" && <LoanForm store={store} data={data} today={today} />}
      {kind === "bill" && <BillForm store={store} data={data} today={today} />}
    </div>
  );
}

/** 口座残高：通帳・アプリの額を入れる。アプリの計算との差はメモに残す */
function BankForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const now = bankOn(data, today).amount;
  const [v, setV] = useState<number | "">("");
  const save = async () => {
    if (v === "") { toast("通帳・アプリの額を入れてください"); return; }
    if (await store.run(() => actions.fixBalance(today, { bank: now, wallet: 0 }, "bank", v))) { toast("口座残高を入れました"); setV(""); }
  };
  const hist = [...data.balances].sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 5);
  return (
    <>
      <div className="kv"><span>アプリの計算（今日）</span><b className="num">{money(now)}</b></div>
      <Field label="口座残高（通帳・アプリの額）"><NumInput value={v} onChange={setV} /></Field>
      <div className="btns"><button className="btn" onClick={save}>入力</button></div>
      {hist.length > 0 && (
        <>
          <h4>残高の記録</h4>
          <div className="list">{hist.map((b) => (
            <div key={b.id} className="row" style={{ gridTemplateColumns: "44px 1fr auto" }}>
              <span className="d num">{md(b.date)}</span>
              <span className="t"><div>{money(b.bank)}</div>{b.memo && <div>{b.memo}</div>}</span>
              <span className="a"><button className="btn sm danger" onClick={async () => { if (confirm("この記録を消しますか？")) await store.run(() => actions.deleteBalance(b.id)); }}>削除</button></span>
            </div>
          ))}</div>
        </>
      )}
    </>
  );
}

/** 借入残高：返済先を選び、カードのサイトの額を入れる（前の見込みとの差は「借入残高の修正」） */
function LoanForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const loans = data.v5.loans;
  const [id, setId] = useState(loans[0]?.id ?? "");
  const loan = loans.find((l) => l.id === id);
  const now = loan ? loanAt(data, loan, today).amount : 0;
  const [v, setV] = useState<number | "">("");
  if (!loans.length) return <div className="note">返済先がありません。計画のタブの返済計画で「返済先追加」から入れてください。</div>;
  const save = async () => {
    if (!loan || v === "") { toast("借入残高を入れてください"); return; }
    if (await store.run(() => actions5.setLoanBalance(loan.id, today, v))) { toast("借入残高を入れました"); setV(""); }
  };
  return (
    <>
      <Field label="返済先"><Select value={id} options={loans.map((l) => l.id)} labels={Object.fromEntries(loans.map((l) => [l.id, l.name]))} onChange={(x) => { setId(x); setV(""); }} /></Field>
      <div className="kv"><span>アプリの見込み（今日）</span><b className="num">{money(now)}</b></div>
      <Field label="借入残高（カードのサイトの額）"><NumInput value={v} onChange={setV} placeholder={yen(now)} /></Field>
      <div className="btns"><button className="btn" onClick={save}>入力</button></div>
    </>
  );
}

const billKey = (b: Bill) => `${b.card.id}:${b.date}`;
const billLabel = (b: Bill) => `${b.card.name} ${+b.closingYm.slice(5)}月分（${md(b.date)} 引落）`;

/** カードの請求額：カード会社からの確定の額を入れる（三井などメールから入るカードは自動） */
function BillForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const cur = ymOf(today);
  const bills = [cur, addMonths(cur, 1)].flatMap((m) => billsFor(data, m)).filter((b) => b.estimate > 0 || b.row);
  const [key, setKey] = useState(bills.find((b) => !b.row?.locked && b.date >= today) ? billKey(bills.find((b) => !b.row?.locked && b.date >= today)!) : bills[0] ? billKey(bills[0]) : "");
  const bill = bills.find((b) => billKey(b) === key);
  const [v, setV] = useState<number | "">("");
  if (!bills.length) return <div className="note">今月と来月の請求はまだありません。</div>;
  const save = async () => {
    if (!bill || v === "") { toast("請求額を入れてください"); return; }
    const row = bill.row && !bill.row.id.startsWith("virtual:") ? bill.row : null;
    if (await store.run(() => actions.setBill(row, { card: bill.card.id, date: bill.date, name: `${bill.card.name} ${+bill.closingYm.slice(5)}月分` }, v, today))) { toast("請求額を入れました"); setV(""); }
  };
  return (
    <>
      <Field label="請求"><Select value={key} options={bills.map(billKey)} labels={Object.fromEntries(bills.map((b) => [billKey(b), billLabel(b)]))} onChange={(x) => { setKey(x); setV(""); }} /></Field>
      {bill && <div className="kv"><span>{bill.row?.locked ? "確定の額" : "明細の合計（見込み）"}</span><b className="num">{money(bill.row?.locked ? bill.row.amount : bill.estimate)}</b></div>}
      <Field label="請求額（カード会社からの額）"><NumInput value={v} onChange={setV} /></Field>
      <div className="btns"><button className="btn" onClick={save}>入力</button></div>
    </>
  );
}

/** 計画：貯蓄計画を選び、積立追加・賞与配分・取崩を入れる（計画そのものを作るのは計画のタブ） */
function PlanForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const plans = data.v5.plans.filter((p) => p.kind !== "repay" && !p.done);
  const [id, setId] = useState(plans[0]?.id ?? "");
  const [move, setMove] = useState<"manual" | "bonus" | "draw">("manual");
  const [amount, setAmount] = useState<number | "">("");
  const bonuses = data.accounts.filter((e) => e.direction === "in" && e.group === "bonus" && e.date >= addMonths(ymOf(today), -1));
  const [bonusId, setBonusId] = useState(bonuses[0]?.id ?? "");
  const change = useMemo<Change | null>(() => (id && amount && (move !== "bonus" || bonusId) ? { kind: "addMove", move: { plan_id: id, kind: move, amount, date: move === "bonus" ? bonuses.find((b) => b.id === bonusId)?.date ?? today : today, bonus_entry_id: move === "bonus" ? bonusId : null, entry_kind: null, entry_id: null, memo: "" } } : null), [id, amount, move, bonusId, bonuses, today]);
  if (!plans.length) return <div className="panel"><div className="note">貯蓄計画がありません。計画のタブで「新規貯蓄計画」から作ってください。</div></div>;
  return (
    <div className="panel quick">
      <Field label="貯蓄計画"><Select value={id} options={plans.map((p) => p.id)} labels={Object.fromEntries(plans.map((p) => [p.id, p.name]))} onChange={setId} /></Field>
      <div className="seg" role="group" aria-label="出し入れ">
        {(["manual", "bonus", "draw"] as const).map((k) => <button key={k} type="button" aria-pressed={move === k} onClick={() => setMove(k)}>{{ manual: "積立追加", bonus: "賞与配分", draw: "取崩" }[k]}</button>)}
      </div>
      {move === "bonus" && <Field label="賞与">{bonuses.length ? <Select value={bonusId} options={bonuses.map((b) => b.id)} labels={Object.fromEntries(bonuses.map((b) => [b.id, `${md(b.date)} ${b.name} ${money(b.amount)}${b.status === "plan" ? "（予定）" : ""}`]))} onChange={setBonusId} /> : <div className="note">入金で区分「賞与」を入れてください</div>}</Field>}
      <Field label="額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
      {change && <ConfirmChange store={store} data={data} today={today} change={change} label="入力" onDone={() => setAmount("")} />}
    </div>
  );
}

/** いま手で入れたもの（新しい順に数件）。押すと直せる */
function Recent({ data, onOpen }: { data: AppData; onOpen: (o: Open) => void }) {
  const rows = [
    ...data.cards.filter((e) => e.source === "manual" && !e.merged_into).map((e) => ({ at: e.at ?? "", el: <CardRow key={e.id} e={e} data={data} onOpen={onOpen} showCat /> })),
    ...data.accounts.filter((e) => e.source === "manual" && e.account === "bank").map((e) => ({ at: e.at ?? "", el: <AccountRow key={e.id} e={e} onOpen={onOpen} showCat /> })),
  ].filter((r) => r.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  if (!rows.length) return null;
  return (
    <section>
      <h2>最近の入力</h2>
      <div className="panel"><div className="list">{rows.map((r) => r.el)}</div></div>
    </section>
  );
}

export function Input5({ store, data, today, kind, setKind, inGroup, onOpen }: { store: Store; data: AppData; today: string; kind: InputKind; setKind: (k: InputKind) => void; inGroup?: AccountGroup; onOpen: (o: Open) => void }) {
  return (
    <>
      <section>
        <div className="seg seg4" role="tablist" aria-label="何を入れるか">
          {KINDS.map(([k, l]) => <button key={k} role="tab" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        </div>
      </section>
      <section>
        {kind === "out" && <OutForm store={store} data={data} today={today} />}
        {kind === "in" && <InForm key={inGroup ?? "in"} store={store} data={data} today={today} group={inGroup} />}
        {kind === "balance" && <BalanceForm store={store} data={data} today={today} />}
        {kind === "plan" && <PlanForm store={store} data={data} today={today} />}
      </section>
      {(kind === "out" || kind === "in") && <Recent data={data} onOpen={onOpen} />}
    </>
  );
}
