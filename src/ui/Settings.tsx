import { useEffect, useState } from "react";
import {
  ACCOUNT_GROUP_LABEL, budgetCats, CARD_GROUP_LABEL, budgetsFor, budgetView, GROUP_LABEL_DEFAULTS, groupOfCat, IN_GROUPS, monthBudget, RESERVE, todayJST,
  type AccountGroup, type CardDef, type CardGroup, type Recurring, type Settings as S,
} from "../engine";
import { actions, actions5, type AppData, type Store } from "../data/store";
import { ConfirmChange } from "./Preview";
import { backend, resetLocal } from "../data/backend";
import { VERSION_LABEL } from "./version";
import { applyOps, OPS_FORMAT, planOps, simulateOps } from "../data/ops";
import { slackValue } from "../engine";
import { snapshot } from "../data/snapshot";
import { handover } from "../data/v5ops";
import type { Open } from "./Sheets";
import { Chip, Field, md, money, NumInput, Select, Sheet, signed, toast, yen, ymLabel } from "./common";

type Tab = "budget" | "income" | "recurring" | "rules" | "kinds" | "assets" | "data";
const TABS: [Tab, string][] = [["budget", "予算"], ["income", "給与・賞与"], ["recurring", "定期"], ["rules", "お店のルール"], ["kinds", "区分"], ["assets", "口座とカード"], ["data", "データ"]];

export function SettingsView({ store, data, month, onOpen, onInput }: { store: Store; data: AppData; month: string; onOpen: (o: Open) => void; onInput: () => void }) {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem("gholdengo.settab") as Tab) || "budget"; } catch { return "budget"; } });
  useEffect(() => { try { localStorage.setItem("gholdengo.settab", tab); } catch { /* なし */ } }, [tab]);
  return (
    <>
      <section>
        <div className="seg" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </section>
      {tab === "budget" && <Budgets store={store} data={data} month={month} />}
      {tab === "income" && <Income store={store} data={data} onOpen={onOpen} onInput={onInput} />}
      {tab === "recurring" && <RecurringList store={store} data={data} />}
      {tab === "rules" && <Rules store={store} data={data} />}
      {tab === "kinds" && <Kinds store={store} data={data} />}
      {tab === "assets" && <Assets store={store} data={data} />}
      {tab === "data" && <DataTab store={store} data={data} />}
    </>
  );
}

// ---------- 予算 ----------

/** v5：予算の出し方（給与の見込み − 固定費 − 借入の毎月の返済 − 計画の毎月の積立額 ＝ 目安額）と、その月に決める予算（設計書 §3.1・§3.2） */
function MonthBaseEditor({ store, data, month }: { store: Store; data: AppData; month: string }) {
  const today = todayJST();
  const mb = monthBudget(data, month);
  const g = mb.guide;
  // 欄にはいまの予算を最初から入れておく（設計書 §3.2）
  const [val, setVal] = useState<number | "">(mb.amount);
  useEffect(() => setVal(mb.amount), [month, mb.amount, mb.source]);
  const same = val === "" || (mb.source === "decided" && val === mb.amount);
  const [confirm, setConfirm] = useState(false);
  const back = async () => { if (await store.run(() => actions5.decideBudget(data, month, null))) toast("目安額に戻しました"); };
  return (
    <section>
      <h2>{ymLabel(month)}の予算 <small>{money(mb.amount)}（{mb.source === "decided" ? "決めた額" : mb.source === "guide" ? "月の初めの目安額で決めた" : "目安額"}）</small></h2>
      <div className="panel">
        <table className="tbl">
          <tbody>{g.parts!.map((p, i) => <tr key={p.key}><td>{i ? "− " : ""}{p.label}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody>
          <tfoot><tr><td>＝ 目安額</td><td className="num">{money(g.amount)}</td></tr></tfoot>
        </table>
        <Field label="この月の予算" hint={val === "" ? "額を入れてください" : same ? "いまの予算です。額を変えると「確認」を押せます" : val === g.amount ? "目安額と同じ" : `目安額より ${signed(Number(val) - g.amount)}円（多い分は余裕額から出す）`}><NumInput value={val} onChange={(v) => { setVal(v); setConfirm(false); }} placeholder={yen(g.amount)} /></Field>
        {confirm && val !== "" ? <ConfirmChange store={store} data={data} today={today} change={{ kind: "decideBudget", month, amount: val }} label="確定" onDone={() => setConfirm(false)} /> : (
          <div className="btns">
            <button className="btn" disabled={same} onClick={() => setConfirm(true)}>確認</button>
            {mb.source === "decided" && <button className="btn ghost" onClick={back}>目安に戻す</button>}
          </div>
        )}
      </div>
    </section>
  );
}

function Budgets({ store, data, month }: { store: Store; data: AppData; month: string }) {
  const today = todayJST();
  const st = data.settings;
  const bud = budgetsFor(data, month);
  const v = budgetView(data, month, today);
  const cats = budgetCats(st).filter((c) => c !== RESERVE);
  const init = () => Object.fromEntries(cats.map((c) => [c, bud.get(c) ?? 0])) as Record<string, number | "">;
  const [vals, setVals] = useState(init);
  useEffect(() => setVals(init()), [month, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const sumOf = (cs: string[]) => cs.reduce((a, c) => a + (Number(vals[c]) || 0), 0);
  // 入力中の値で、予算と予備を出し直す（固定費を直すと、今月の予算も変わる）
  const fixedSum = sumOf(st.fixCats);
  const free = monthBudget(data, month).amount;
  const reserve = free - sumOf(st.varCats);
  const own = data.budgets.some((b) => b.month === month && !b.category.startsWith("#") && b.category !== RESERVE);
  const save = async () => {
    const map = Object.fromEntries(cats.map((c) => [c, Number(vals[c]) || 0]));
    if (await store.run(() => actions.saveBudgets(month, map))) toast(`${ymLabel(month)}の予算を保存しました`);
  };
  const grid = (cs: string[]) => cs.map((c) => {
    const r = v.cats.find((x) => x.cat === c);
    return [
      <label key={c + "l"} htmlFor={`b_${c}`}>{c}<span className="note"> 使った {money(r?.used ?? 0)}{r?.planned ? `・予定 ${money(r.planned)}` : ""}</span></label>,
      <NumInput key={c + "i"} id={`b_${c}`} value={vals[c] ?? ""} onChange={(x) => setVals({ ...vals, [c]: x })} />,
    ];
  });
  return (
    <>
      <MonthBaseEditor store={store} data={data} month={month} />
      <section>
        <h2>費目別予算 <small>{own ? "この月の予算" : "前の月から引き継いでいます"}</small></h2>
        <div className="panel">
          <h2>固定費 <small>合計 {yen(fixedSum)}円（目安額を出すときに引く）</small></h2>
          <div className="budgetgrid">{grid(st.fixCats)}</div>
          <h2 style={{ marginTop: 8 }}>変動費 <small>今月の予算 {signed(free)}円 を割り振る</small></h2>
          <div className="budgetgrid">
            {grid(st.varCats)}
            <span><b>予備</b><span className="note">（残りを自動）</span></span>
            <b className={`num ${reserve < 0 ? "neg" : ""}`} style={{ textAlign: "right" }}>{signed(reserve)}</b>
          </div>
          {reserve < 0 && <div className="alert">今月の予算より {yen(-reserve)}円 多く割り振っています。どこかを減らしてください。</div>}
          <div className="btns"><button className="btn" onClick={save}>保存</button></div>
        </div>
      </section>
    </>
  );
}

// ---------- 給与・賞与 ----------

function Income({ store, data, onOpen, onInput }: { store: Store; data: AppData; onOpen: (o: Open) => void; onInput: () => void }) {
  const today = todayJST();
  const incomeRec = data.recurring.filter((r) => r.kind === "income");
  const extras = data.accounts.filter((e) => e.direction === "in" && !e.recurring_id && e.date >= today.slice(0, 7)).sort((a, b) => a.date.localeCompare(b.date));
  const [edit, setEdit] = useState<Partial<Recurring> | null>(null);
  return (
    <>
      <section>
        <h2>給与（毎月） <button className="btn sm" onClick={() => setEdit({ name: "給与", kind: "income", group: "salary", category: null, amount: data.settings.salaryEstimate, day: data.settings.payday, shift: "next", pay: "bank", active: true })}>新規</button></h2>
        <div className="panel">
          {incomeRec.length ? <div className="list">{incomeRec.map((r) => <RecRow key={r.id} r={r} s={data.settings} onOpen={() => setEdit(r)} />)}</div> : <div className="note">なし</div>}
        </div>
      </section>
      <section>
        <div className="sec-h"><h2>賞与・臨時入金</h2><button className="btn sm" onClick={onInput}>入金入力</button></div>
        <div className="panel">
          {!extras.length && <div className="note">なし</div>}
          {extras.length > 0 && <div className="list">{extras.map((e) => (
            <button className="row" key={e.id} onClick={() => onOpen({ type: "account", entry: e })}>
              <span className="d num">{md(e.date)}</span><span className="t"><div>{e.name || "入金"}</div><div>{ACCOUNT_GROUP_LABEL[e.group]}・{e.status === "plan" ? "予定" : "確定"}</div></span><span className="a num">＋{money(e.amount)}</span>
            </button>))}</div>}
        </div>
      </section>
      {edit && <RecurringSheet store={store} data={data} r={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

// ---------- 定期マスタ ----------

const SHIFT_LABEL = { next: "後の平日", prev: "前の平日", none: "ずらさない" } as const;
const EVERY_LABEL: Record<string, string> = { "1": "毎月", "2": "2か月ごと（隔月）", "3": "3か月ごと", "6": "半年ごと", "12": "毎年" };
/** 「毎月27日」「2か月ごと（11月から）27日」「毎年11月27日」 */
const whenLabel = (r: Pick<Recurring, "every" | "day" | "start_month">) => {
  const every = r.every || 1;
  if (every === 1) return `毎月${r.day}日`;
  const m = r.start_month ? +r.start_month.slice(5) : null;
  if (every === 12) return `毎年${m ? `${m}月` : ""}${r.day}日`;
  return `${EVERY_LABEL[String(every)] ?? `${every}か月ごと`}${m ? `（${m}月から）` : ""}${r.day}日`;
};
const payName = (s: S, r: Pick<Recurring, "pay" | "card">) => (r.pay === "card" ? `クレカ（${s.cards.find((c) => c.id === r.card)?.name ?? s.cards[0].name}）` : r.pay === "wallet" ? "財布" : "口座");
const groupName = (r: Recurring) => (r.pay === "card" ? CARD_GROUP_LABEL[r.group as CardGroup] : ACCOUNT_GROUP_LABEL[r.group as AccountGroup]) ?? "";

function RecRow({ r, s, onOpen }: { r: Recurring; s: S; onOpen: () => void }) {
  return (
    <button className="row" onClick={onOpen} style={{ gridTemplateColumns: "1fr auto" }}>
      <span className="t"><div>{r.name} {!r.active && <span className="chip">止めている</span>}</div><div>{whenLabel(r)}（土日祝は{SHIFT_LABEL[r.shift]}）・{payName(s, r)}・{groupName(r)}{r.category ? `・${r.category}` : ""}{r.end_month ? `・${ymLabel(r.end_month)}まで` : ""}</div></span>
      <span className="a num">{r.kind === "income" ? "＋" : ""}{yen(r.amount)}</span>
    </button>
  );
}

function RecurringList({ store, data }: { store: Store; data: AppData }) {
  const [edit, setEdit] = useState<Partial<Recurring> | null>(null);
  const exp = data.recurring.filter((r) => r.kind === "expense");
  const fixed = exp.filter((r) => r.group === "fixed");
  const others = exp.filter((r) => r.group !== "fixed");
  return (
    <>
      <section>
        <h2>定期 <button className="btn sm" onClick={() => setEdit({ kind: "expense", group: "fixed", category: data.settings.fixCats[0] ?? null, day: 27, shift: "next", pay: "bank", active: true, amount: 0, name: "" })}>新規</button></h2>
      </section>
      <section>
        <h2>固定費 <small>計 {yen(fixed.reduce((a, r) => a + (r.active ? r.amount : 0), 0))}円</small></h2>
        <div className="panel">{fixed.length ? <div className="list">{fixed.map((r) => <RecRow key={r.id} r={r} s={data.settings} onOpen={() => setEdit(r)} />)}</div> : <div className="note">なし</div>}</div>
      </section>
      <section>
        <h2>その他 <small>計 {yen(others.reduce((a, r) => a + (r.active ? r.amount : 0), 0))}円</small></h2>
        <div className="panel">{others.length ? <div className="list">{others.map((r) => <RecRow key={r.id} r={r} s={data.settings} onOpen={() => setEdit(r)} />)}</div> : <div className="note">なし</div>}</div>
      </section>
      {edit && <RecurringSheet store={store} data={data} r={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function RecurringSheet({ store, data, r, onClose }: { store: Store; data: AppData; r: Partial<Recurring>; onClose: () => void }) {
  const s = data.settings;
  const [x, setX] = useState<Partial<Recurring>>(r);
  const set = (p: Partial<Recurring>) => setX({ ...x, ...p });
  const today = todayJST();
  const cats = ["", ...budgetCats(s).filter((c) => c !== RESERVE)];
  const payKey = x.pay === "card" ? `card:${x.card ?? s.cards[0].id}` : x.pay ?? "bank";
  const payKeys = ["bank", "wallet", ...s.cards.map((c) => `card:${c.id}`)];
  const payLabels = { bank: "口座", wallet: "財布", ...Object.fromEntries(s.cards.map((c) => [`card:${c.id}`, `クレカ（${c.name}）`])) };
  const groups: string[] = x.kind === "income" ? IN_GROUPS : x.pay === "card" ? ["variable", "fixed"] : ["variable", "fixed", "other"];
  const labels = x.pay === "card" ? CARD_GROUP_LABEL : ACCOUNT_GROUP_LABEL;
  const save = async () => {
    if (!x.name || !x.amount || !x.day) { toast("名前・金額・日を入れてください"); return; }
    const budgeted = x.kind === "expense" && (x.group === "variable" || x.group === "fixed");
    // 2か月ごと・毎年などは、始める月から数える（なければ今月から）
    const every = x.every || 1;
    const row = { ...x, every, start_month: every > 1 && !x.start_month ? today.slice(0, 7) : x.start_month ?? null, category: budgeted ? x.category || null : null };
    if (await store.run(() => actions.saveRecurring(data, row, today))) { toast("保存しました"); onClose(); }
  };
  const remove = async () => {
    if (!x.id || !confirm("この定期のお金を消しますか？（これからの予定も消えます）")) return;
    if (await store.run(() => actions.deleteRecurring(data, x.id!, today))) { toast("消しました"); onClose(); }
  };
  return (
    <Sheet title={x.id ? "定期のお金を直す" : "定期のお金を追加"} onClose={onClose}>
      <div className="seg">{(["expense", "income"] as const).map((k) => <button key={k} aria-pressed={x.kind === k} onClick={() => set({ kind: k, group: k === "income" ? "salary" : "fixed", pay: k === "income" ? "bank" : x.pay })}>{k === "income" ? "入金" : "出金"}</button>)}</div>
      <Field label="名前"><input value={x.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="金額（見込）"><NumInput value={x.amount ?? ""} onChange={(v) => set({ amount: v === "" ? 0 : v })} /></Field>
        <Field label="周期"><Select value={String(x.every || 1)} options={["1", "2", "3", "6", "12"]} labels={EVERY_LABEL} onChange={(v) => set({ every: +v })} /></Field>
        <Field label="日（31＝月末）" hint={x.pay === "card" ? "クレカは利用日" : undefined}><NumInput plain value={x.day ?? ""} onChange={(v) => set({ day: v === "" ? 1 : Math.min(31, Math.max(1, v)) })} /></Field>
        <Field label="休日の扱い"><Select value={x.shift ?? "next"} options={["next", "prev", "none"] as const} labels={SHIFT_LABEL} onChange={(v) => set({ shift: v })} /></Field>
        {x.kind === "expense" && <Field label="払い方"><Select value={payKey} options={payKeys} labels={payLabels} onChange={(v) => { const card = v.startsWith("card:") ? v.slice(5) : null; set({ pay: card ? "card" : (v as Recurring["pay"]), card, group: card && x.group === "other" ? "fixed" : !card && x.group === "installment" ? "other" : x.group }); }} /></Field>}
      </div>
      <Field label="大費目"><Select value={(x.group ?? "fixed") as string} options={groups} labels={labels as Record<string, string>} onChange={(v) => set({ group: v as Recurring["group"] })} /></Field>
      {x.kind === "expense" && (x.group === "variable" || x.group === "fixed") && <Field label="費目"><Select value={x.category ?? ""} options={cats} labels={{ "": "未分類" }} onChange={(v) => set({ category: v || null, group: v ? groupOfCat(s, v) : x.group })} /></Field>}
      {x.kind === "expense" && x.pay === "card" && <Field label="店名のヒント（任意）" hint="カードの明細のお店にこの言葉が入っていれば、費目が違ってもこの予定とまとめます（例：モバイルSuica）"><input value={x.shop ?? ""} onChange={(e) => set({ shop: e.target.value })} /></Field>}
      <div className="grid2">
        <Field label={(x.every || 1) > 1 ? "始める月（この月から数える。空なら今月）" : "始める月（空なら今から）"}><input type="month" value={x.start_month ?? ""} onChange={(e) => set({ start_month: e.target.value || null })} /></Field>
        <Field label="終了月（空欄＝無期限）"><input type="month" value={x.end_month ?? ""} onChange={(e) => set({ end_month: e.target.value || null })} /></Field>
      </div>
      {(x.every || 1) > 1 && <div className="note">{whenLabel({ every: x.every || 1, day: x.day || 1, start_month: x.start_month || today.slice(0, 7) })}に予定を作成</div>}
      <label className="check"><input type="checkbox" checked={x.active !== false} onChange={(e) => set({ active: e.target.checked })} />使う（外すと予定を作らない）</label>
      <div className="btns">
        <button className="btn" onClick={save}>保存</button>
        <button className="btn ghost" onClick={onClose}>取消</button>
        {x.id && <button className="btn danger" onClick={remove}>削除</button>}
      </div>
    </Sheet>
  );
}

// ---------- 費目のルール ----------

function Rules({ store, data }: { store: Store; data: AppData }) {
  const cats = budgetCats(data.settings).filter((c) => c !== RESERVE);
  const [pattern, setPattern] = useState("");
  const [cat, setCat] = useState(cats[0]);
  const [q, setQ] = useState("");
  const rules = [...data.rules].filter((r) => !q || r.pattern.toLowerCase().includes(q.toLowerCase()) || r.category.includes(q)).sort((a, b) => a.category.localeCompare(b.category) || a.pattern.localeCompare(b.pattern));
  const add = async () => {
    if (!pattern.trim()) return;
    if (await store.run(() => actions.saveRule(pattern.trim(), cat))) { toast("ルールを保存しました"); setPattern(""); }
  };
  return (
    <section>
      <h2>お店のルール <small>{data.rules.length}件</small></h2>
      <div className="panel">
        <div className="grid2">
          <Field label="店名に含む語"><input value={pattern} onChange={(e) => setPattern(e.target.value)} /></Field>
          <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>
        </div>
        <div className="btns"><button className="btn" onClick={add}>保存</button></div>
        <Field label="検索"><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <table className="tbl"><tbody>
          {rules.map((r) => (
            <tr key={r.id}><td>{r.pattern}</td><td>{r.category}</td><td><button className="btn sm danger" onClick={async () => { if (await store.run(() => actions.deleteRule(r.id))) toast("削除しました"); }}>削除</button></td></tr>
          ))}
        </tbody></table>
      </div>
    </section>
  );
}

// ---------- 費目とカード ----------

function Assets({ store, data }: { store: Store; data: AppData }) {
  const [s, setS] = useState<S>(data.settings);
  const n = (k: "payday" | "salaryEstimate") => <NumInput plain={k === "payday"} value={s[k]} onChange={(v) => setS({ ...s, [k]: v === "" ? 0 : v })} />;
  const save = async () => { if (await store.run(() => actions.saveSettings(s))) toast("保存しました"); };
  return (
    <section>
      <h2>口座とカード</h2>
      <div className="panel">
        <div className="grid2">
          <Field label="給料日">{n("payday")}</Field>
          <Field label="給与の見込額" hint="給与の予定がない先の月に使う">{n("salaryEstimate")}</Field>
        </div>
        {s.cards.map((c, i) => {
          const setC = (p: Partial<CardDef>) => setS({ ...s, cards: s.cards.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          return (
            <div key={c.id} className="grid2">
              <Field label={i === 0 ? "カードの名前（いつも使うカード・メールから入る）" : "カードの名前"}><input value={c.name} onChange={(e) => setC({ name: e.target.value })} /></Field>
              <Field label="締め日（31＝月末）"><NumInput plain value={c.closingDay} onChange={(v) => setC({ closingDay: v === "" ? 31 : v })} /></Field>
              <Field label="引落日"><NumInput plain value={c.payDay} onChange={(v) => setC({ payDay: v === "" ? 1 : v })} /></Field>
              <Field label="引落月"><Select value={String(c.payMonths)} options={["1", "2"]} labels={{ "1": "締めた翌月", "2": "締めた翌々月" }} onChange={(v) => setC({ payMonths: +v })} /></Field>
            </div>
          );
        })}
        <div className="btns">
          <button className="btn sm" onClick={() => setS({ ...s, cards: [...s.cards, { id: `card${Date.now().toString(36)}`, name: "新しいカード", closingDay: 31, payDay: 27, payMonths: 1 }] })}>カード追加</button>
        </div>
        <div className="btns"><button className="btn" onClick={save}>保存</button></div>
      </div>
    </section>
  );
}

// ---------- 区分 ----------

const GROUP_KEYS = ["variable", "fixed", "tatekae", "purchase", "card", "other", "salary", "refund", "bonus"] as const;
const GROUP_WHERE: Record<(typeof GROUP_KEYS)[number], string> = {
  variable: "クレカ明細・口座明細の出金", fixed: "クレカ明細・口座明細の出金", tatekae: "クレカ明細・口座明細の出金",
  purchase: "クレカ明細", card: "口座明細の出金（クレカの請求）", other: "口座明細の入金・出金", salary: "口座明細の入金", refund: "口座明細の入金", bonus: "口座明細の入金",
};

/** 区分：費目（名前・大費目・追加・削除）と大費目の名前 */
function Kinds({ store, data }: { store: Store; data: AppData }) {
  const s = data.settings;
  const cats = [...s.varCats, ...s.fixCats];
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(cats.map((c) => [c, c])));
  useEffect(() => setNames(Object.fromEntries(cats.map((c) => [c, c]))), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<"variable" | "fixed">("variable");
  const [labels, setLabels] = useState<Record<string, string>>(() => ({ ...GROUP_LABEL_DEFAULTS, ...(s.labels ?? {}) }));
  const used = (c: string) => data.cards.filter((e) => e.category === c).length + data.accounts.filter((e) => e.category === c).length;
  const saveS = (p: Partial<S>, msg: string) => store.run(() => actions.saveSettings({ ...s, ...p })).then((ok) => ok && toast(msg));

  const rename = async (c: string) => {
    const to = (names[c] ?? "").trim();
    if (!to || to === c) return;
    if (cats.includes(to) || to === RESERVE) { toast("同じ名前の費目があります"); return; }
    if (await store.run(() => actions.renameCategory(data, c, to))) toast(`「${c}」を「${to}」にしました`);
  };
  const setGroup = (c: string, g: "variable" | "fixed") => {
    const varCats = g === "variable" ? [...s.varCats.filter((x) => x !== c), c] : s.varCats.filter((x) => x !== c);
    const fixCats = g === "fixed" ? [...s.fixCats.filter((x) => x !== c), c] : s.fixCats.filter((x) => x !== c);
    saveS({ varCats, fixCats }, `「${c}」を${labels[g]}にしました`);
  };
  const remove = (c: string) => {
    const n = used(c);
    if (!confirm(`「${c}」を消しますか？${n ? `（この費目の明細 ${n}件は、費目の一覧にないので予備で数えます。あとで費目を直してください）` : ""}`)) return;
    saveS({ varCats: s.varCats.filter((x) => x !== c), fixCats: s.fixCats.filter((x) => x !== c), dailyCats: s.dailyCats.filter((x) => x !== c) }, `「${c}」を消しました`);
  };
  const add = () => {
    const c = newName.trim();
    if (!c) return;
    if (cats.includes(c) || c === RESERVE) { toast("同じ名前の費目があります"); return; }
    saveS(newGroup === "variable" ? { varCats: [...s.varCats, c] } : { fixCats: [...s.fixCats, c] }, `「${c}」を足しました`).then(() => setNewName(""));
  };
    const saveLabels = () => {
    const changed = Object.fromEntries(Object.entries(labels).filter(([k, v]) => v.trim() && v !== GROUP_LABEL_DEFAULTS[k]).map(([k, v]) => [k, v.trim()]));
    saveS({ labels: changed }, "大費目の名前を保存しました");
  };

  const row = (c: string, g: "variable" | "fixed") => (
    <div className="kindrow" key={c}>
      <input value={names[c] ?? c} onChange={(e) => setNames({ ...names, [c]: e.target.value })} onBlur={() => rename(c)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label={`${c}の名前`} />
      <div className="kindctl">
        <Select value={g} options={["variable", "fixed"] as const} labels={{ variable: labels.variable, fixed: labels.fixed }} onChange={(v) => setGroup(c, v)} />
        <span className="note">明細 {used(c)}件</span>
        <button className="btn sm danger" onClick={() => remove(c)}>削除</button>
      </div>
    </div>
  );
  return (
    <>
      <section>
        <h2>費目 <small>名前は書きかえると、明細・予算・ルール・定期の費目も一緒に変わる</small></h2>
        <div className="panel kinds">
          {s.varCats.map((c) => row(c, "variable"))}
          {s.fixCats.map((c) => row(c, "fixed"))}
          <div className="kindrow"><b>{RESERVE}</b><div className="note">{labels.variable}・残りを自動</div></div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <Field label="新しい費目の名前"><input value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
            <Field label="大費目"><Select value={newGroup} options={["variable", "fixed"] as const} labels={{ variable: labels.variable, fixed: labels.fixed }} onChange={setNewGroup} /></Field>
          </div>
          <div className="btns"><button className="btn" onClick={add}>費目追加</button></div>
        </div>
      </section>
      <section>
        <h2>大費目名 <small>名前だけ変えられる（計算のしかたは変わらない）</small></h2>
        <div className="panel">
          <table className="tbl"><tbody>
            {GROUP_KEYS.map((k) => (
              <tr key={k}>
                <td style={{ textAlign: "left" }}><input value={labels[k] ?? ""} onChange={(e) => setLabels({ ...labels, [k]: e.target.value })} aria-label={`${GROUP_LABEL_DEFAULTS[k]}の名前`} /><div className="note">{GROUP_WHERE[k]}{labels[k] !== GROUP_LABEL_DEFAULTS[k] ? `・はじめは「${GROUP_LABEL_DEFAULTS[k]}」` : ""}</div></td>
              </tr>
            ))}
          </tbody></table>
          <div className="btns"><button className="btn" onClick={saveLabels}>保存</button><button className="btn ghost" onClick={() => setLabels({ ...GROUP_LABEL_DEFAULTS })}>はじめの名前に戻す</button></div>
        </div>
      </section>
    </>
  );
}

// ---------- データ ----------

/** Claude との相談を取り込む（gholdengo-ops-v2）。変わる内容を見せて、実行を押したときだけ書く */
function OpsImport({ store, data }: { store: Store; data: AppData }) {
  const [plan, setPlan] = useState<ReturnType<typeof planOps> | null>(null);
  const [text, setText] = useState("");
  const read = (raw: string) => {
    let json: unknown;
    try { json = JSON.parse(raw); } catch { toast("JSON として読めませんでした"); return; }
    setPlan(planOps(data, json));
  };
  const run = async () => {
    if (!plan || plan.errors.length || !plan.changes.length) return;
    if (await store.run(() => applyOps(data, plan.changes, todayJST()))) { toast(`${plan.changes.length}件を取り込みました`); setPlan(null); setText(""); }
  };
  return (
    <section>
      <h2>Claude 相談の取込 <small>{OPS_FORMAT}（docs/OPS.md）</small></h2>
      <div className="panel">
        <Field label="ファイル"><FilePick onFile={async (f) => read(await f.text())} /></Field>
        <Field label="貼り付け"><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={`{"format": "${OPS_FORMAT}", "ops": [...]}`} /></Field>
        <div className="btns"><button className="btn ghost" onClick={() => text.trim() && read(text)}>読込</button></div>
        {plan && (
          <>
            {plan.note && <div className="note">メモ：{plan.note}</div>}
            {plan.errors.length > 0 && <div className="alert bad">読めないところがあるので取り込みません：<ul>{plan.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {plan.changes.length > 0 && !plan.errors.length && (() => {
              const t = todayJST();
              const a = slackValue(data, t, t), b = slackValue(simulateOps(data, plan.changes), t, t);
              return <div className="kv"><span>取り込んだら、余裕額</span><b className="num">{money(a)} → <span className={b < 0 ? "neg" : ""}>{money(b)}</span></b></div>;
            })()}
            {plan.changes.length > 0 && (
              <table className="tbl"><tbody>{plan.changes.map((c, i) => (
                <tr key={i}><td style={{ textAlign: "left" }}><Chip kind={c.kind === "delete" ? "bad" : c.kind === "add" ? "ok" : "warn"}>{c.kind === "delete" ? "削除" : c.kind === "add" ? "追加" : "変更"}</Chip> {c.label}</td></tr>
              ))}</tbody></table>
            )}
            <div className="btns">
              <button className="btn" disabled={!!plan.errors.length || !plan.changes.length} onClick={run}>実行（{plan.changes.length}件）</button>
              <button className="btn ghost" onClick={() => setPlan(null)}>取消</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function DataTab({ store, data }: { store: Store; data: AppData }) {
  const download = () => {
    const blob = new Blob([JSON.stringify(snapshot(data, todayJST()), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gholdengo-${todayJST()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
    <Handover store={store} data={data} />
    <OpsImport store={store} data={data} />
    <section>
      <h2>データ</h2>
      <div className="panel">
        <div className="note">アプリの版：{VERSION_LABEL}</div>
        <div className="note">保存先：{backend.mode === "supabase" ? "Supabase（ログインした本人だけが読み書きできます）" : "この端末のブラウザの中（お試しモード）"}</div>
        <div className="note">クレカ明細 {data.cards.length}件・口座明細 {data.accounts.length}件・残高の記録 {data.balances.length}件・定期 {data.recurring.length}件・返済計画 {data.v5.plans.filter((p) => p.kind === "repay").length}件・貯蓄計画 {data.v5.plans.filter((p) => p.kind !== "repay").length}件</div>
        <div className="btns"><button className="btn ghost" onClick={download}>書き出し（JSON）</button></div>
        {backend.mode === "local" && (
          <div className="btns"><button className="btn danger" onClick={() => { if (confirm("お試しモードのデータをすべて消しますか？")) { resetLocal(); location.reload(); } }}>お試しのデータを消す</button></div>
        )}
      </div>
    </section>
    </>
  );
}

/** ファイルを選ぶボタン（ブラウザの英語の部品を出さない） */
function FilePick({ onFile }: { onFile: (f: File) => void }) {
  const [name, setName] = useState("");
  return (
    <label className="btn ghost filepick">
      {name || "ファイル選択"}
      <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setName(f.name); onFile(f); } e.target.value = ""; }} />
    </label>
  );
}

/** v4 から引き継ぐ（設計書 §7.3）。することがあるときだけ出す。実行の前に、消す行とつながりを外す行の一覧を出す */
function Handover({ store, data }: { store: Store; data: AppData }) {
  const h = handover(data.accounts);
  const n = h.remove.length + h.unlink.length;
  if (!n) return null;
  const run = async () => { if (confirm(`${n}件を引き継ぎますか？`) && (await store.run(() => actions5.handover(data)))) toast("引き継ぎました"); };
  const list = (rows: typeof h.remove, what: string) => rows.length > 0 && (
    <>
      <h2>{what} <small>{rows.length}件</small></h2>
      <div className="list">{[...rows].sort((x, y) => x.date.localeCompare(y.date)).map((e) => (
        <div key={e.id} className="row"><span className="d num">{md(e.date)}</span><span className="t"><div>{e.name || e.category || "―"}</div></span><span className="a num">{e.direction === "in" ? "＋" : "−"}{money(e.amount)}</span></div>
      ))}</div>
    </>
  );
  return (
    <section>
      <h2>v4 から引き継ぎ</h2>
      <div className="panel">
        {list(h.remove, "削除（v4 の計画の予定・前の版の調整）")}
        {list(h.unlink, "計画とのつながりだけ外す（普通の明細として残す）")}
        <div className="btns"><button className="btn" onClick={run}>引き継ぎ実行（{n}件）</button></div>
      </div>
    </section>
  );
}
