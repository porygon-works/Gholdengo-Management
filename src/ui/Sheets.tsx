import { useState } from "react";
import {
  addDays, budgetCats, billsFor, CARD_GROUPS, groupOfCat, IN_GROUPS, OUT_GROUPS, RESERVE, todayJST, ymOf,
  type Account, type AccountEntry, type AccountGroup, type CardEntry, type CardGroup, type Direction, type Status,
} from "../engine";
import { actions, actions5, type AppData, type Store } from "../data/store";
import { PlanPreview } from "./Preview";
import {
  ACCOUNT_GROUP_LABEL, ACCOUNT_SOURCE_LABEL, accountTitle, CARD_GROUP_LABEL, CARD_SOURCE_LABEL, cardTitle, Field, md, NumInput, Select, Sheet, signed, StatusChip, toast, yen,
} from "./common";

/** 開くもの：口座明細・クレカ明細・新しく入れる */
export type Open =
  | { type: "account"; entry?: AccountEntry; preset?: Partial<AccountEntry> }
  | { type: "card"; entry?: CardEntry; preset?: Partial<CardEntry> }
  | { type: "new"; plan?: boolean };

const UNC = "未分類";
const catOptions = (d: AppData) => [UNC, ...budgetCats(d.settings).filter((c) => c !== RESERVE)];

/** 新しく入れる：クレカ明細か口座明細かを選ぶ */
export function NewSheet({ store, data, plan, onClose }: { store: Store; data: AppData; plan?: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<"card" | "account">("card");
  return kind === "card"
    ? <CardSheet store={store} data={data} preset={{ status: plan ? "plan" : "confirmed" }} onClose={onClose} switcher={<Switch kind={kind} setKind={setKind} />} />
    : <AccountSheet store={store} data={data} preset={{ status: plan ? "plan" : "confirmed" }} onClose={onClose} switcher={<Switch kind={kind} setKind={setKind} />} />;
}

function Switch({ kind, setKind }: { kind: "card" | "account"; setKind: (k: "card" | "account") => void }) {
  return (
    <div className="seg" role="group" aria-label="どの明細か">
      <button type="button" aria-pressed={kind === "card"} onClick={() => setKind("card")}>クレカ明細</button>
      <button type="button" aria-pressed={kind === "account"} onClick={() => setKind("account")}>口座明細</button>
    </div>
  );
}

// ---------- クレカ明細 ----------

export function CardSheet({ store, data, entry, preset, onClose, switcher }: { store: Store; data: AppData; entry?: CardEntry; preset?: Partial<CardEntry>; onClose: () => void; switcher?: React.ReactNode }) {
  const s = data.settings;
  const base: CardEntry = entry ?? { id: "", card: s.cards[0].id, status: "confirmed", date: todayJST(), amount: 0, group: "variable", category: null, name: "", shop: "", memo: "", tatekae: 0, source: "manual", source_ref: null, merged_into: null, not_dup: [], locked: false, recurring_id: null, goal_id: null, ...preset };
  const [card, setCard] = useState(base.card);
  const [status, setStatus] = useState<Status>(base.status);
  const [date, setDate] = useState(base.date);
  const [amount, setAmount] = useState<number | "">(base.amount || "");
  const [group, setGroup] = useState<CardGroup>(base.group);
  const [cat, setCat] = useState(base.category ?? UNC);
  const [name, setName] = useState(base.name);
  const [shop, setShop] = useState(base.shop);
  const [memo, setMemo] = useState(base.memo);
  const [tatekae, setTatekae] = useState<number | "">(base.tatekae || "");
  // 立替を増やしたら、返してもらう分を口座明細の「入金・立替の返金」の予定として作れる
  const added = group === "tatekae" ? (Number(amount) || 0) - (entry?.group === "tatekae" ? entry.amount : 0) : (Number(tatekae) || 0) - (base.tatekae || 0);
  const [refund, setRefund] = useState(true);
  const [refundDate, setRefundDate] = useState(addDays(todayJST(), 7));
  const [refundTo, setRefundTo] = useState<Account>("bank");
  const keeper = entry?.merged_into ? data.cards.find((e) => e.id === entry.merged_into) : undefined;
  const absorbed = entry ? data.cards.filter((e) => e.merged_into === entry.id) : [];
  const fromMail = entry && (entry.source === "card_flash" || entry.source === "card_statement");

  const pickCat = (c: string) => { setCat(c); if (group === "variable" || group === "fixed") setGroup(groupOfCat(s, c === UNC ? null : c)); };
  const save = async () => {
    if (!amount || !date) { toast("日付と金額を入れてください"); return; }
    const category = (group === "variable" || group === "fixed" || group === "purchase") && cat !== UNC ? cat : null;
    const v = { card, status, date, amount, group, category, name, shop, memo, tatekae: group === "variable" || group === "fixed" ? Number(tatekae) || 0 : 0 };
    const ok = await store.run(async () => {
      await (entry ? actions.updateCard(data, entry.id, v) : actions.addCard(v));
      if (added > 0 && refund) await actions.addAccount({ account: refundTo, direction: "in", status: "plan", group: "refund", category: null, name: `立替の返金（${name || shop || "クレカ"}）`, date: refundDate, amount: added });
    });
    if (ok) { toast(entry ? "保存しました" : "入れました"); onClose(); }
  };
  const remove = async () => {
    if (!entry || !confirm("このクレカ明細を消しますか？")) return;
    if (await store.run(() => actions.deleteCard(data, entry.id))) { toast("消しました"); onClose(); }
  };
  const unmerge = async (id: string) => { if (await store.run(() => actions.unmerge(data, id))) { toast("まとめを取り消しました"); onClose(); } };

  return (
    <Sheet title={entry ? `${md(entry.date)} ${cardTitle(entry)}` : status === "plan" ? "クレカ予定入力" : "クレカ明細入力"} onClose={onClose}>
      {switcher}
      {entry && <div className="note"><StatusChip status={entry.status} /> {CARD_SOURCE_LABEL[entry.source]}から{keeper && <><br />「{md(keeper.date)} {cardTitle(keeper)}」にまとめられています。計算には入っていません。</>}</div>}
      <div className="seg" role="group" aria-label="確定区分">
        {(["confirmed", "plan"] as Status[]).map((x) => <button key={x} type="button" aria-pressed={status === x} onClick={() => setStatus(x)}>{x === "plan" ? "予定" : "確定"}</button>)}
      </div>
      <div className="grid2">
        <Field label="カード"><Select value={card} options={s.cards.map((c) => c.id)} labels={Object.fromEntries(s.cards.map((c) => [c.id, c.name]))} onChange={setCard} /></Field>
        <Field label="利用日"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="金額"><NumInput value={amount} onChange={setAmount} /></Field>
        <Field label="大費目"><Select value={group} options={CARD_GROUPS.filter((g) => g !== "installment" || group === "installment")} labels={CARD_GROUP_LABEL} onChange={setGroup} /></Field>
      </div>
      {(group === "variable" || group === "fixed" || group === "purchase") && <Field label="費目"><Select value={cat} options={catOptions(data)} onChange={pickCat} /></Field>}
      {group === "installment" && <div className="note">前の版の毎月の返済額。計算には入れません（借入の返済は計画の「借入」から）。</div>}
      {group === "purchase" && <div className="note">請求に入らず、借入残高に足す。予算はその費目で数える。</div>}
      {group === "tatekae" && <div className="note">立替：全額を立て替えた。請求には入り、予算には数えません。</div>}
      <div className="grid2">
        <Field label="名称（商品名など）"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="店" hint={fromMail ? "費目を直すと、この店のルールとして覚えます" : undefined}><input value={shop} onChange={(e) => setShop(e.target.value)} /></Field>
      </div>
      {(group === "variable" || group === "fixed") && <Field label="立替額（一部だけ立て替えたとき）" hint="自分の分だけを予算に数えます"><NumInput value={tatekae} onChange={setTatekae} /></Field>}
      {added > 0 && (
        <div className="panel">
          <label className="check"><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />立替の返金予定（¥{yen(added)}）</label>
          {refund && (
            <div className="grid2">
              <Field label="返してもらう日（見込み）"><input type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} /></Field>
              <Field label="受け取り先"><Select value={refundTo} options={["bank", "wallet"] as Account[]} labels={{ bank: "口座", wallet: "財布" }} onChange={setRefundTo} /></Field>
            </div>
          )}
        </div>
      )}
      <Field label="メモ"><textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      {!entry && amount && date ? <PlanPreview store={store} data={data} today={todayJST()} change={{ kind: "addCard", entry: { ...base, card, status, date, amount, group, category: cat === UNC ? null : cat, name, shop, memo, tatekae: Number(tatekae) || 0, source: "manual", locked: true } }} /> : null}
      <div className="btns">
        <button className="btn" onClick={save}>保存</button>
        <button className="btn ghost" onClick={onClose}>取消</button>
        {entry && <button className="btn danger" onClick={remove}>削除</button>}
        {keeper && <button className="btn ghost" onClick={() => unmerge(entry!.id)}>統合解除</button>}
      </div>
      {entry && !keeper && <CardV5 store={store} data={data} entry={entry} onClose={onClose} />}
      {absorbed.length > 0 && (
        <div className="panel">
          <div className="note">この明細にまとめたもの（計算には入れていません）</div>
          <div className="list">{absorbed.map((a) => (
            <div key={a.id} className="row merged" style={{ cursor: "default" }}>
              <span className="d num">{md(a.date)}</span>
              <span className="t"><div>{cardTitle(a)}</div><div>{CARD_SOURCE_LABEL[a.source]}</div></span>
              <span className="a num">{yen(a.amount)}<button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => unmerge(a.id)}>解除</button></span>
            </div>
          ))}</div>
        </div>
      )}
    </Sheet>
  );
}

// ---------- 口座明細 ----------

export function AccountSheet({ store, data, entry, preset, onClose, switcher }: { store: Store; data: AppData; entry?: AccountEntry; preset?: Partial<AccountEntry>; onClose: () => void; switcher?: React.ReactNode }) {
  if (entry?.group === "card") return <BillSheet store={store} data={data} entry={entry} onClose={onClose} />;
  return <AccountForm store={store} data={data} entry={entry} preset={preset} onClose={onClose} switcher={switcher} />;
}

function AccountForm({ store, data, entry, preset, onClose, switcher }: { store: Store; data: AppData; entry?: AccountEntry; preset?: Partial<AccountEntry>; onClose: () => void; switcher?: React.ReactNode }) {
  const s = data.settings;
  const base: AccountEntry = entry ?? { id: "", account: "bank", direction: "out", status: "confirmed", group: "variable", category: null, name: "", memo: "", date: todayJST(), amount: 0, source: "manual", source_ref: null, recurring_id: null, goal_id: null, card: null, pair_id: null, locked: false, ...preset };
  const [account, setAccount] = useState<Account>(base.account);
  const [direction, setDirection] = useState<Direction>(base.direction);
  const [status, setStatus] = useState<Status>(base.status);
  const [group, setGroup] = useState<AccountGroup>(base.group);
  const [cat, setCat] = useState(base.category ?? UNC);
  const [name, setName] = useState(base.name);
  const [memo, setMemo] = useState(base.memo);
  const [date, setDate] = useState(base.date);
  const [amount, setAmount] = useState<number | "">(base.amount || "");
  const groups = (direction === "in" ? IN_GROUPS : OUT_GROUPS).filter((g) => g !== "card");
  const setDir = (x: Direction) => { setDirection(x); setGroup(x === "in" ? "salary" : "variable"); };
  const pickCat = (c: string) => { setCat(c); setGroup(groupOfCat(s, c === UNC ? null : c)); };

  const save = async () => {
    if (!amount || !date) { toast("日付と金額を入れてください"); return; }
    const category = direction === "out" && (group === "variable" || group === "fixed") && cat !== UNC ? cat : null;
    const v = { account, direction, status, group, category, name, memo, date, amount };
    if (await store.run(() => (entry ? actions.updateAccount(entry.id, v) : actions.addAccount(v)))) { toast(entry ? "保存しました" : "入れました"); onClose(); }
  };
  const confirmIt = async () => {
    if (!entry || !amount) return;
    if (await store.run(() => actions.confirmAccount(entry.id, amount, date))) { toast("確定にしました"); onClose(); }
  };
  const remove = async () => {
    if (!entry || !confirm(entry.pair_id ? "この明細を消しますか？（ATM の相手の行も消えます）" : "この明細を消しますか？")) return;
    if (await store.run(() => actions.deleteAccount(data, entry.id))) { toast("消しました"); onClose(); }
  };

  return (
    <Sheet title={entry ? `${md(entry.date)} ${accountTitle(entry)}` : status === "plan" ? "口座予定入力" : "口座明細入力"} onClose={onClose}>
      {switcher}
      {entry && <div className="note"><StatusChip status={entry.status} /> {ACCOUNT_SOURCE_LABEL[entry.source]}から</div>}
      <div className="seg" role="group" aria-label="入出金区分">
        {(["out", "in"] as Direction[]).map((x) => <button key={x} type="button" aria-pressed={direction === x} onClick={() => setDir(x)}>{x === "in" ? "入金" : "出金"}</button>)}
        <span style={{ width: 12 }} />
        {(["confirmed", "plan"] as Status[]).map((x) => <button key={x} type="button" aria-pressed={status === x} onClick={() => setStatus(x)}>{x === "plan" ? "予定" : "確定"}</button>)}
      </div>
      <div className="grid2">
        {account === "wallet" && <Field label="口座" hint="財布は管理しません（記録として残すだけ）"><Select value={account} options={["bank", "wallet"] as Account[]} labels={{ bank: "口座", wallet: "財布" }} onChange={setAccount} /></Field>}
        <Field label="計上日"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="金額"><NumInput value={amount} onChange={setAmount} /></Field>
        <Field label="大費目"><Select value={group} options={groups} labels={ACCOUNT_GROUP_LABEL} onChange={setGroup} /></Field>
      </div>
      {direction === "out" && (group === "variable" || group === "fixed") && <Field label="費目"><Select value={cat} options={catOptions(data)} onChange={pickCat} /></Field>}
      {direction === "in" && <div className="note">給与は目安額の元。賞与は大費目「賞与」（計画への配分に使える）。立替の返金は、返してもらうまで余裕額に足して数えます。</div>}
      <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={direction === "in" ? "給与・立替の返金など" : "奨学金・PayPayチャージなど"} /></Field>
      <Field label="メモ"><textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      {!entry && amount && date ? <PlanPreview store={store} data={data} today={todayJST()} change={{ kind: "addAccount", entry: { ...base, account, direction, status, group, category: cat === UNC ? null : cat, name, memo, date, amount, source: "manual", locked: true } }} /> : null}
      <div className="btns">
        <button className="btn" onClick={save}>保存</button>
        {entry?.status === "plan" && <button className="btn ghost" onClick={confirmIt}>この金額で確定にする</button>}
        <button className="btn ghost" onClick={onClose}>取消</button>
        {entry && <button className="btn danger" onClick={remove}>削除</button>}
      </div>
      {entry && entry.direction === "out" && (entry.group === "variable" || entry.group === "fixed") && <SplitForm store={store} data={data} entry={entry} onClose={onClose} />}
    </Sheet>
  );
}

/** v5：クレカ明細をリボに回す・戻す、使う日のある貯蓄計画にひも付ける（設計書 §3.3・§3.4） */
function CardV5({ store, data, entry, onClose }: { store: Store; data: AppData; entry: CardEntry; onClose: () => void }) {
  const linked = data.v5.moves.find((m) => m.kind === "spend" && m.entry_kind === "card" && m.entry_id === entry.id);
  const buys = data.v5.plans.filter((p) => p.kind === "buy" && !p.done);
  const [planId, setPlanId] = useState(buys[0]?.id ?? "");
  const revolve = async (on: boolean) => { if (await store.run(() => actions5.toRevolving(data, entry, on, todayJST()))) { toast(on ? "リボ化しました" : "リボを解除しました"); onClose(); } };
  const hasLoan = data.v5.loans.some((l) => l.card === entry.card);
  const link = async () => {
    if (!planId) return;
    if (await store.run(() => actions5.addMove({ plan_id: planId, kind: "spend", amount: entry.amount, date: entry.date, bonus_entry_id: null, entry_kind: "card", entry_id: entry.id, memo: cardTitle(entry) }))) { toast("計画と連携しました"); onClose(); }
  };
  return (
    <div className="panel">
      <div className="btns">
        {entry.group === "purchase" ? <button className="btn sm ghost" onClick={() => revolve(false)}>リボ解除</button>
          : (entry.group === "variable" || entry.group === "fixed") && (hasLoan ? <button className="btn sm ghost" onClick={() => revolve(true)}>リボ化</button> : <span className="note">リボ化には、計画の「借入」にこのカードの借入が必要です</span>)}
      </div>
      {linked ? (
        <div className="note">計画「{data.v5.plans.find((p) => p.id === linked.plan_id)?.name}」と連携中（予算に数えず積立額から払う） <button className="btn sm ghost" onClick={() => store.run(() => actions5.removeMove(linked.id))}>連携解除</button></div>
      ) : buys.length > 0 && (
        <div className="grid2">
          <Field label="計画連携（貯蓄計画）"><Select value={planId} options={buys.map((p) => p.id)} labels={Object.fromEntries(buys.map((p) => [p.id, p.name]))} onChange={setPlanId} /></Field>
          <div className="btns"><button className="btn sm" onClick={link}>計画連携</button></div>
        </div>
      )}
    </div>
  );
}

/** v5：口座明細を費目ごとの行に分ける（ATM で引き出した分を、何に使ったかで分けるときなど。設計書 §3.6） */
function SplitForm({ store, data, entry, onClose }: { store: Store; data: AppData; entry: AccountEntry; onClose: () => void }) {
  const cats = catOptions(data).filter((c) => c !== UNC);
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<{ category: string; amount: number | "" }[]>([{ category: entry.category ?? cats[0], amount: entry.amount }, { category: cats[0], amount: "" }]);
  const sumOf = parts.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const split = async () => {
    if (await store.run(() => actions5.splitAccount(data, entry, parts.filter((p) => p.amount).map((p) => ({ category: p.category, amount: Number(p.amount) }))))) { toast("分割しました"); onClose(); }
  };
  if (!open) return <div className="btns"><button className="btn sm ghost" onClick={() => setOpen(true)}>分割</button></div>;
  return (
    <div className="panel">
      {parts.map((p, i) => (
        <div className="grid2" key={i}>
          <Field label="費目"><Select value={p.category} options={cats} onChange={(c) => setParts(parts.map((x, j) => (j === i ? { ...x, category: c } : x)))} /></Field>
          <Field label="額"><NumInput value={p.amount} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: v } : x)))} /></Field>
        </div>
      ))}
      <div className="note num">合計 {yen(sumOf)} / {yen(entry.amount)}</div>
      <div className="btns">
        <button className="btn sm ghost" onClick={() => setParts([...parts, { category: cats[0], amount: "" }])}>行追加</button>
        <button className="btn sm" disabled={sumOf !== entry.amount} onClick={split}>分割</button>
      </div>
    </div>
  );
}

// ---------- クレカ支払い（口座明細の、カードの請求の行） ----------

export function BillSheet({ store, data, entry, onClose }: { store: Store; data: AppData; entry: AccountEntry; onClose: () => void }) {
  const bill = billsFor(data, ymOf(entry.date)).find((b) => b.card.id === entry.card && b.date === entry.date);
  const [val, setVal] = useState<number | "">(entry.status === "confirmed" || entry.locked ? entry.amount : "");
  const today = todayJST();
  const set = async (amount: number | null) => {
    if (!bill) return;
    const row = entry.id.startsWith("virtual:") ? null : entry;
    if (await store.run(() => actions.setBill(row, { card: bill.card.id, date: bill.date, name: entry.name }, amount, today))) { toast(amount == null ? "見込みに戻しました" : "確定の額を入れました"); onClose(); }
  };
  // 確定の額（メール・手入力）が入った行は locked。引落日に見込みで確定した行は locked ではない
  const confirmed = entry.locked;
  return (
    <Sheet title={`${md(entry.date)} ${entry.name}（クレカ支払い）`} onClose={onClose}>
      <div className="note"><StatusChip status={entry.status} label={confirmed ? "確定の額" : entry.status === "confirmed" ? "見込みで確定" : "見込み"} /> 口座から {md(entry.date)} に引き落とされます。</div>
      {bill && (
        <>
          <table className="tbl">
            <tbody>
              <tr><td>クレカ明細の合計（見込み）</td><td className="num">{yen(bill.estimate)}</td></tr>
              {confirmed && <tr><td>確定の額</td><td className="num">{yen(entry.amount)}</td></tr>}
              {confirmed && entry.amount !== bill.estimate && <tr><td>差（入っていない明細があるかもしれません）</td><td className="num">{signed(entry.amount - bill.estimate)}</td></tr>}
            </tbody>
          </table>
          <h2>内訳（{+bill.closingYm.slice(5)}月のクレカ明細）</h2>
          <table className="tbl"><tbody>{bill.items.map((e) => (
            <tr key={e.id}><td className="num">{md(e.date)}</td><td style={{ textAlign: "left" }}>{cardTitle(e)} {e.status === "plan" && <StatusChip status="plan" />}<div className="note">{CARD_GROUP_LABEL[e.group]}{e.category ? `・${e.category}` : ""}</div></td><td className="num">{yen(e.amount)}</td></tr>
          ))}</tbody></table>
        </>
      )}
      <Field label="確定の額（カード会社からの請求額）" hint={`${data.settings.cards[0]?.name ?? "1枚目のカード"}はメール（お支払い金額のお知らせ）から自動で入ります`}><NumInput value={val} onChange={setVal} /></Field>
      <div className="btns">
        <button className="btn" onClick={() => val !== "" && set(val)}>確定にする</button>
        {confirmed && <button className="btn ghost" onClick={() => set(null)}>見込に戻す</button>}
      </div>
    </Sheet>
  );
}
