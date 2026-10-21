import { useState } from "react";
import { addDays, budgetCats, INCOME_EXTRA, INCOME_SALARY, isSalary, OUTSIDE, REPAY, todayJST, type Entry, type Kind, type Method, type Status } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { ALL_METHODS, Field, md, METHOD_LABEL, NumInput, Select, Sheet, SOURCE_LABEL, STATUS_LABEL, StatusChip, toast, yen, entryTitle } from "./common";

const UNC = "未分類";

export function catOptions(d: AppData, kind: Kind) {
  if (kind !== "expense") return [UNC];
  return [UNC, ...budgetCats(d.settings), REPAY, OUTSIDE];
}

interface Props {
  store: Store;
  data: AppData;
  entry?: Entry; // なければ新しく作る
  preset?: Partial<Entry>;
  onClose: () => void;
}

export function EntrySheet({ store, data, entry, preset, onClose }: Props) {
  const base = entry ?? ({ kind: "expense", status: "confirmed", date: todayJST(), amount: 0, method: "cash", category: null, shop: "", item: "", memo: "", tatekae: 0, ...preset } as Entry);
  const [kind, setKind] = useState<Kind>(base.kind);
  const [status, setStatus] = useState<Status>(base.status);
  const [date, setDate] = useState(base.date);
  const [amount, setAmount] = useState<number | "">(entry || base.amount ? base.amount : "");
  const [method, setMethod] = useState<Method>(base.method);
  const [cat, setCat] = useState(base.category ?? UNC);
  // 収入の扱い：給与（予算の元）／追加予算／予算に入れない
  const [incomeUse, setIncomeUse] = useState<string>(base.kind === "income" && entry && isSalary(entry) ? INCOME_SALARY : base.category === INCOME_EXTRA ? INCOME_EXTRA : "");
  const [shop, setShop] = useState(base.shop);
  const [item, setItem] = useState(base.item);
  const [memo, setMemo] = useState(base.memo);
  const [tatekae, setTatekae] = useState<number | "">(base.tatekae || "");
  // 立替を増やしたら、返してもらう分を入金の予定として作る（返してもらうまで、立替の分は口座から出たままなので）
  const [refund, setRefund] = useState(true);
  const [refundDate, setRefundDate] = useState(addDays(todayJST(), 7));
  const [refundMethod, setRefundMethod] = useState<Method>("cash");
  const addedTatekae = (Number(tatekae) || 0) - (base.tatekae || 0);

  const absorbed = entry ? data.entries.filter((e) => e.merged_into === entry.id) : [];
  const keeper = entry?.merged_into ? data.entries.find((e) => e.id === entry.merged_into) : undefined;
  const fromMail = entry && (entry.source === "card_flash" || entry.source === "card_statement");
  const title = entry ? `${md(entry.date)} ${entryTitle(entry)}` : status === "plan" ? (kind === "income" ? "入金の予定を追加" : "予定を追加") : "使ったものを追加";

  const save = async () => {
    if (!amount || !date) { toast("日付と金額を入れてください"); return; }
    const category = kind === "expense" ? (cat !== UNC ? cat : null) : incomeUse || null;
    const v = { kind, status, date, amount, method, category, shop, item, memo, tatekae: tatekae || 0 };
    const ok = await store.run(async () => {
      await (entry ? actions.updateEntry(data, entry.id, v) : actions.addEntry(v));
      if (kind === "expense" && addedTatekae > 0 && refund) {
        await actions.addEntry({ kind: "income", status: "plan", date: refundDate, amount: addedTatekae, method: refundMethod, category: null, item: `立替の返金（${item || shop || "支出"}）` });
      }
    });
    if (ok) { toast(entry ? "保存しました" : "追加しました"); onClose(); }
  };
  const remove = async () => {
    if (!entry || !confirm("この明細を消しますか？")) return;
    if (await store.run(() => actions.deleteEntry(entry.id))) { toast("消しました"); onClose(); }
  };
  const confirmPlan = async () => {
    if (!entry || !amount) return;
    if (await store.run(() => actions.confirmPlan(entry.id, amount, date))) { toast("確定にしました"); onClose(); }
  };
  const unmerge = async (id: string) => {
    if (await store.run(() => actions.unmerge(data, id))) { toast("まとめを取り消しました"); onClose(); }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      {entry && (
        <div className="note">
          <StatusChip e={entry} /> {SOURCE_LABEL[entry.source]}から{entry.shop && fromMail ? `・${entry.shop}` : ""}
          {keeper && <><br />この明細は「{md(keeper.date)} {entryTitle(keeper)}」にまとめられています。計算には入っていません。</>}
        </div>
      )}
      {!entry && (
        <div className="seg" role="group" aria-label="種類">
          {(["expense", "income"] as Kind[]).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "expense" ? "支出" : "収入"}</button>)}
          <span style={{ width: 12 }} />
          {(["confirmed", "plan"] as Status[]).map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === "plan" ? "予定" : "実際"}</button>)}
        </div>
      )}
      <div className="grid2">
        <Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="金額"><NumInput value={amount} onChange={setAmount} /></Field>
      </div>
      {kind === "expense" && (
        <div className="grid2">
          <Field label="費目"><Select value={cat} options={catOptions(data, kind)} onChange={setCat} /></Field>
          <Field label="金種"><Select value={method} options={ALL_METHODS} onChange={setMethod} labels={METHOD_LABEL} /></Field>
        </div>
      )}
      {kind === "income" && (
        <Field label="予算の扱い" hint="給与は今月の予算の元になります。イベチケのように予算に足すものは「追加予算」。賞与や立替の返金などは「予算に入れない」">
          <Select value={incomeUse} options={[INCOME_SALARY, INCOME_EXTRA, ""]} labels={{ [INCOME_SALARY]: "給与（予算の元）", [INCOME_EXTRA]: "追加予算", "": "予算に入れない" }} onChange={setIncomeUse} />
        </Field>
      )}
      <Field label={kind === "income" ? "内容（例：給与・賞与・立替の返金）" : "買ったもの"}><input value={item} onChange={(e) => setItem(e.target.value)} /></Field>
      {kind === "expense" && <Field label="お店" hint={fromMail ? "メールから入ったお店の名前。費目を直すと、このお店のルールとして覚えます" : undefined}><input value={shop} onChange={(e) => setShop(e.target.value)} /></Field>}
      {kind === "expense" && <Field label="立替額（あとで返してもらう分）" hint="入れると、自分の分だけを予算に数えます"><NumInput value={tatekae} onChange={setTatekae} /></Field>}
      {kind === "expense" && addedTatekae > 0 && (
        <div className="panel">
          <label className="check"><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />返してもらう {yen(addedTatekae)}円 を入金の予定に入れる</label>
          {refund && (
            <div className="grid2">
              <Field label="返してもらう日（見込み）"><input type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} /></Field>
              <Field label="受け取り方"><Select value={refundMethod} options={["cash", "bank"] as Method[]} labels={METHOD_LABEL} onChange={setRefundMethod} /></Field>
            </div>
          )}
          <div className="note">返してもらうまでは、立替の分も口座から出たままなので、残り予算はその分少なく出ます。入金の予定を入れると戻ります。</div>
        </div>
      )}
      <Field label="メモ"><textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      <div className="btns">
        <button className="btn" onClick={save}>保存</button>
        {entry?.status === "plan" && <button className="btn ghost" onClick={confirmPlan}>この金額で確定にする</button>}
        <button className="btn ghost" onClick={onClose}>やめる</button>
        {entry && (entry.source === "manual" || entry.source === "recurring" || entry.status === "plan" || entry.source === "migration") && <button className="btn danger" onClick={remove}>消す</button>}
        {keeper && <button className="btn ghost" onClick={() => unmerge(entry!.id)}>まとめを取り消す</button>}
      </div>
      {absorbed.length > 0 && (
        <div className="panel">
          <div className="note">この明細にまとめたもの（計算には入れていません）</div>
          <div className="list">
            {absorbed.map((a) => (
              <div key={a.id} className="row merged" style={{ cursor: "default" }}>
                <span className="d num">{md(a.date)}</span>
                <span className="t"><div>{entryTitle(a)}</div><div>{SOURCE_LABEL[a.source]}・{STATUS_LABEL[a.status]}</div></span>
                <span className="a num">{yen(a.amount)}<button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => unmerge(a.id)}>取り消す</button></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
