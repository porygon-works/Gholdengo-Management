import { useEffect, useState } from "react";
import {
  ACCOUNT_GROUP_LABEL, budgetCats, CARD_GROUP_LABEL, computeMonth, goalBalanceAt, GROUP_LABEL_DEFAULTS, goalOutlook, groupOfCat, IN_GROUPS, monthBase, RESERVE, todayJST, ymOf,
  type AccountGroup, type CardDef, type CardGroup, type Goal, type Lump, type Recurring, type Settings as S,
} from "../engine";
import { actions, type AppData, type ImportFile, type Store } from "../data/store";
import { backend, resetLocal } from "../data/backend";
import { VERSION_LABEL } from "./version";
import type { Open } from "./Sheets";
import { Chip, Field, md, money, NumInput, Select, Sheet, signed, toast, yen, ymLabel } from "./common";

type Tab = "budget" | "goals" | "income" | "recurring" | "rules" | "kinds" | "assets" | "data";
const TABS: [Tab, string][] = [["budget", "予算"], ["goals", "目標"], ["income", "給与・賞与"], ["recurring", "定期"], ["rules", "お店のルール"], ["kinds", "区分"], ["assets", "口座とカード"], ["data", "データ"]];
/** それぞれのタブを、いつ・何のために触るか */
const TAB_HELP: Record<Tab, string> = {
  budget: "月に1回（給料日のころ）。ヘッダーの月で、その月（来月も）の予算を確かめて、費目に割り振る。直さなければ前の月のまま使う",
  goals: "リボ・分割を0にする目標と、積立の目標。毎月の額を決めると、毎月の目標用マイナスと返済の予定が自動でできる",
  income: "給与の見込み額や給料日が変わったとき、賞与や臨時の入金が決まったときに入れる",
  recurring: "家賃・奨学金・通信・サブスクなど、毎月決まった支払いが増えた・変わった・やめたとき",
  rules: "カードの明細の費目がまちがって入るとき。ふだんは明細の費目を直せば、ここに自動で覚える",
  kinds: "費目の名前を変える・増やす・消す、固定費か変動費かを変える、大費目の名前を変えるとき",
  assets: "給料日・安全残高・カードの名前と締め日・引落日を変える、カードを増やすとき（めったに触らない）",
  data: "前の家計簿からの取り込みや、データの書き出し（めったに触らない）",
};

export function SettingsView({ store, data, month, onOpen }: { store: Store; data: AppData; month: string; onOpen: (o: Open) => void }) {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem("gholdengo.settab") as Tab) || "budget"; } catch { return "budget"; } });
  useEffect(() => { try { localStorage.setItem("gholdengo.settab", tab); } catch { /* なし */ } }, [tab]);
  return (
    <>
      <section>
        <div className="seg" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </section>
      <div className="note" style={{ marginTop: -16, marginBottom: 20 }}>{TAB_HELP[tab]}</div>
      {tab === "budget" && <Budgets store={store} data={data} month={month} />}
      {tab === "goals" && <Goals store={store} data={data} />}
      {tab === "income" && <Income store={store} data={data} onOpen={onOpen} />}
      {tab === "recurring" && <RecurringList store={store} data={data} />}
      {tab === "rules" && <Rules store={store} data={data} />}
      {tab === "kinds" && <Kinds store={store} data={data} />}
      {tab === "assets" && <Assets store={store} data={data} />}
      {tab === "data" && <DataTab store={store} data={data} />}
    </>
  );
}

// ---------- 予算 ----------

/** 予算の元（給与・追加予算・固定費・目標用マイナス）。目標用マイナスだけ、この月だけ手で直せる */
function MonthBaseEditor({ store, data, month }: { store: Store; data: AppData; month: string }) {
  const b = monthBase(data, month);
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState<number | "">("");
  const save = async (amount: number | null) => {
    if (await store.run(() => actions.saveGoalMinus(month, amount))) { toast(amount == null ? "目標マスタの額に戻しました" : "保存しました"); setEdit(false); }
  };
  const line = (label: string, v: number, hint: string, chip?: React.ReactNode) => (
    <div style={{ display: "grid", gap: 4, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
      <div className="legend" style={{ justifyContent: "space-between" }}><span><b style={{ color: "var(--ink)" }}>{label}</b> {chip}</span><b className="num">{yen(v)}円</b></div>
      <div className="note">{hint}</div>
    </div>
  );
  return (
    <section>
      <h2>{ymLabel(month)}の予算 <small>{signed(b.T)}円</small></h2>
      <div className="panel">
        {line("給与", b.salary, "その月の口座明細の入金のうち、大費目が給与のもの（予定を含む）。直すときは明細や予定を直す")}
        {line("＋ 追加予算", b.extra, "その月の口座明細の入金のうち、大費目が追加予算のもの（イベチケなど）")}
        {line("− 固定費", b.fixed, "固定費の費目の予算（見込み）の合計。下の「固定費」で直す")}
        <div style={{ display: "grid", gap: 4, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
          <div className="legend" style={{ justifyContent: "space-between" }}>
            <span><b style={{ color: "var(--ink)" }}>− 目標用マイナス</b> {b.goalManual ? <Chip kind="warn">この月だけ直した</Chip> : <Chip>目標マスタから</Chip>}</span>
            <b className="num">{yen(b.goal)}円</b>
          </div>
          <div className="note">目標マスタの、その月の毎月の額＋臨時の額{b.goalManual ? `（目標マスタなら ${yen(b.goalAuto)}円）` : ""}</div>
          {edit ? (
            <div className="btns" style={{ alignItems: "center" }}>
              <div style={{ width: 140 }}><NumInput value={val} onChange={setVal} autoFocus /></div>
              <button className="btn sm" onClick={() => save(val === "" ? 0 : val)}>保存</button>
              <button className="btn sm ghost" onClick={() => setEdit(false)}>やめる</button>
            </div>
          ) : (
            <div className="btns">
              <button className="btn sm ghost" onClick={() => { setEdit(true); setVal(b.goal); }}>この月だけ直す</button>
              {b.goalManual && <button className="btn sm ghost" onClick={() => save(null)}>目標マスタの額に戻す</button>}
            </div>
          )}
        </div>
        <div className="legend" style={{ justifyContent: "space-between" }}><b style={{ color: "var(--ink)" }}>＝ {ymLabel(month)}の予算</b><b className="num">{signed(b.T)}円</b></div>
      </div>
    </section>
  );
}

function Budgets({ store, data, month }: { store: Store; data: AppData; month: string }) {
  const today = todayJST();
  const st = data.settings;
  const v = computeMonth(data, month, today);
  const cats = budgetCats(st).filter((c) => c !== RESERVE);
  const init = () => Object.fromEntries(cats.map((c) => [c, v.cats.find((r) => r.cat === c)?.budget ?? 0])) as Record<string, number | "">;
  const [vals, setVals] = useState(init);
  useEffect(() => setVals(init()), [month, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const sumOf = (cs: string[]) => cs.reduce((a, c) => a + (Number(vals[c]) || 0), 0);
  // 入力中の値で、予算と予備を出し直す（固定費を直すと、今月の予算も変わる）
  const fixedSum = sumOf(st.fixCats);
  const free = v.base.salary + v.base.extra - fixedSum - v.base.goal;
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
        <h2>費目ごとの予算 <small>{own ? "この月の予算" : "前の月から引き継いでいます"}</small></h2>
        <div className="panel">
          <h2>固定費 <small>合計 {yen(fixedSum)}円（給与から引く）</small></h2>
          <div className="budgetgrid">{grid(st.fixCats)}</div>
          <div className="note">毎月の見込みの額。予算を入れていない費目は、定期マスタの額を使います。見込みをこえた分は残り予算から引きます。</div>
          <h2 style={{ marginTop: 8 }}>変動費 <small>今月の予算 {signed(free)}円 を割り振る</small></h2>
          <div className="budgetgrid">
            {grid(st.varCats)}
            <span><b>予備</b><span className="note">（自動で残りが入る）</span></span>
            <b className={`num ${reserve < 0 ? "neg" : ""}`} style={{ textAlign: "right" }}>{signed(reserve)}</b>
          </div>
          {reserve < 0 && <div className="alert">今月の予算より {yen(-reserve)}円 多く割り振っています。どこかを減らしてください。</div>}
          <div className="btns"><button className="btn" onClick={save}>この月の費目予算を保存</button></div>
          <div className="note">保存しない月は、前の月の費目予算をそのまま使います。Claude と相談して決めた予算は、JSON にして「データ」から取り込めます。</div>
        </div>
      </section>
    </>
  );
}

// ---------- 目標 ----------

function Goals({ store, data }: { store: Store; data: AppData }) {
  const today = todayJST();
  const [edit, setEdit] = useState<Partial<Goal> | null>(null);
  const out = goalOutlook(data, ymOf(today), 36);
  const cards = Object.fromEntries(data.settings.cards.map((c) => [c.id, c.name]));
  return (
    <section>
      <h2>目標マスタ
        <span className="btns" style={{ display: "inline-flex", marginLeft: 8 }}>
          <button className="btn ghost sm" onClick={() => setEdit({ kind: "repay", name: "", card: data.settings.cards[0].id, balance: 0, as_of: today, monthly: 0, day: 27, lumps: [], active: true })}>＋ 返済</button>
          <button className="btn ghost sm" onClick={() => setEdit({ kind: "save", name: "給料1か月分の積立", target: data.settings.salaryEstimate, balance: 0, monthly: 20000, start_month: ymOf(today), lumps: [], active: true })}>＋ 積立</button>
        </span>
      </h2>
      <div className="panel">
        {data.goals.length ? <div className="list">{data.goals.map((g) => {
          const o = out.find((x) => x.goal.id === g.id);
          return (
            <button className="row" key={g.id} onClick={() => setEdit(g)} style={{ gridTemplateColumns: "1fr auto" }}>
              <span className="t">
                <div>{g.name} <Chip>{g.kind === "repay" ? "返済" : "積立"}</Chip> {!g.active && <Chip>止めている</Chip>}</div>
                <div>{g.kind === "repay" ? `${g.card ? cards[g.card] ?? g.card : "口座から"}・毎月 ${yen(g.monthly)}円・${o?.doneYm ? `${ymLabel(o.doneYm)}に0` : "36か月では0にならない"}` : `毎月 ${yen(g.monthly)}円・${g.start_month ? `${ymLabel(g.start_month)}から` : ""}・${o?.doneYm ? `${ymLabel(o.doneYm)}に届く` : "36か月では届かない"}`}{g.lumps.length ? `・臨時 ${g.lumps.length}件` : ""}</div>
              </span>
              <span className="a num">{money(g.kind === "repay" ? goalBalanceAt(g, data.settings, today) : g.target)}{g.kind === "repay" && <small>いまの残高（見込み）</small>}</span>
            </button>
          );
        })}</div> : <div className="note">まだありません。リボ・分割があれば「返済」、貯めたい額があれば「積立」を入れてください。</div>}
        <div className="note">その月の目標用マイナス ＝ 動いている目標の毎月の額 ＋ 臨時の額。返済の目標からは、毎月の返済の予定（カードならクレカ明細の分割（返済））が自動でできます。見通しはメニューの「目標」、まとめて決めるならメニューの「計画をつくる」。</div>
      </div>
      {edit && <GoalSheet store={store} data={data} g={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function GoalSheet({ store, data, g, onClose }: { store: Store; data: AppData; g: Partial<Goal>; onClose: () => void }) {
  const today = todayJST();
  const [x, setX] = useState<Partial<Goal>>(g);
  const set = (p: Partial<Goal>) => setX({ ...x, ...p });
  const [lump, setLump] = useState<Lump>({ date: "", amount: 0, memo: "" });
  const repay = x.kind === "repay";
  const save = async () => {
    if (!x.name) { toast("名前を入れてください"); return; }
    const row = { ...x, as_of: repay && (x.balance !== g.balance || !x.as_of) ? today : x.as_of ?? null };
    if (await store.run(() => actions.saveGoal(data, row, today))) { toast("保存しました"); onClose(); }
  };
  const remove = async () => {
    if (!x.id || !confirm("この目標を消しますか？（これからの返済の予定も消えます）")) return;
    if (await store.run(() => actions.deleteGoal(data, x.id!, today))) { toast("消しました"); onClose(); }
  };
  const cardIds = ["", ...data.settings.cards.map((c) => c.id)];
  return (
    <Sheet title={x.id ? x.name || "目標" : repay ? "返済の目標を追加" : "積立の目標を追加"} onClose={onClose}>
      <Field label="名前"><input value={x.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
      {repay ? (
        <>
          <div className="grid2">
            <Field label="返済するカード" hint="空なら口座から振り込む"><Select value={x.card ?? ""} options={cardIds} labels={{ "": "口座から", ...Object.fromEntries(data.settings.cards.map((c) => [c.id, c.name])) }} onChange={(v) => set({ card: v || null })} /></Field>
            <Field label="残高（いま）"><NumInput value={x.balance ?? ""} onChange={(v) => set({ balance: v === "" ? 0 : v })} /></Field>
            <Field label="毎月の返済額"><NumInput value={x.monthly ?? ""} onChange={(v) => set({ monthly: v === "" ? 0 : v })} /></Field>
            {!x.card && <Field label="口座から払う日"><NumInput plain value={x.day ?? ""} onChange={(v) => set({ day: v === "" ? 27 : v })} /></Field>}
          </div>
          <div className="note">{x.as_of ? `${md(x.as_of)}の残高です。` : ""}毎月の返済日・臨時の返済の日が来るたびに、見込みで減ります{g.id ? `（いまの見込み ${money(goalBalanceAt(g as Goal, data.settings, today))}）` : ""}。本当の残高が分かったら直してください（今日の残高として数え直します）。</div>
        </>
      ) : (
        <div className="grid2">
          <Field label="目標額"><NumInput value={x.target ?? ""} onChange={(v) => set({ target: v === "" ? 0 : v })} /></Field>
          <Field label="もうたまっている額"><NumInput value={x.balance ?? ""} onChange={(v) => set({ balance: v === "" ? 0 : v })} /></Field>
          <Field label="毎月積み立てる額"><NumInput value={x.monthly ?? ""} onChange={(v) => set({ monthly: v === "" ? 0 : v })} /></Field>
        </div>
      )}
      <div className="grid2">
        <Field label="始める月（空なら今から）"><input type="month" value={x.start_month ?? ""} onChange={(e) => set({ start_month: e.target.value || null })} /></Field>
        <Field label={repay ? "終わる月（空なら0になるまで）" : "終わる月（空なら目標額に届くまで）"}><input type="month" value={x.end_month ?? ""} onChange={(e) => set({ end_month: e.target.value || null })} /></Field>
      </div>
      <h2>臨時の{repay ? "返済" : "積立"} <small>賞与から一括など</small></h2>
      {(x.lumps ?? []).map((l, i) => (
        <div key={i} className="legend" style={{ justifyContent: "space-between" }}>
          <span>{md(l.date)} {l.memo}</span>
          <span><b className="num">{l.amount ? money(l.amount) : "残り全部"}</b> <button className="btn sm ghost" onClick={() => set({ lumps: (x.lumps ?? []).filter((_, j) => j !== i) })}>消す</button></span>
        </div>
      ))}
      <div className="grid2">
        <Field label="日付"><input type="date" value={lump.date} onChange={(e) => setLump({ ...lump, date: e.target.value })} /></Field>
        <Field label="額" hint={repay ? "空なら残り全部（残りより多くても残り全部）" : undefined}><NumInput value={lump.amount || ""} onChange={(v) => setLump({ ...lump, amount: v === "" ? 0 : v })} /></Field>
      </div>
      <Field label="メモ"><input value={lump.memo} onChange={(e) => setLump({ ...lump, memo: e.target.value })} placeholder="賞与から全額 など" /></Field>
      <div className="btns"><button className="btn sm ghost" onClick={() => { if (!lump.date || (!repay && !lump.amount)) { toast(repay ? "日付を入れてください" : "日付と額を入れてください"); return; } set({ lumps: [...(x.lumps ?? []), lump] }); setLump({ date: "", amount: 0, memo: "" }); }}>臨時を足す</button></div>
      <label className="check"><input type="checkbox" checked={x.active !== false} onChange={(e) => set({ active: e.target.checked })} />使う（外すと目標用マイナスと予定に入れない）</label>
      <div className="btns">
        <button className="btn" onClick={save}>保存</button>
        <button className="btn ghost" onClick={onClose}>やめる</button>
        {x.id && <button className="btn danger" onClick={remove}>消す</button>}
      </div>
    </Sheet>
  );
}

// ---------- 給与・賞与 ----------

function Income({ store, data, onOpen }: { store: Store; data: AppData; onOpen: (o: Open) => void }) {
  const today = todayJST();
  const incomeRec = data.recurring.filter((r) => r.kind === "income");
  const extras = data.accounts.filter((e) => e.direction === "in" && !e.recurring_id && e.date >= today.slice(0, 7)).sort((a, b) => a.date.localeCompare(b.date));
  const [edit, setEdit] = useState<Partial<Recurring> | null>(null);
  const [bDate, setBDate] = useState("");
  const [bAmount, setBAmount] = useState<number | "">("");
  const [bName, setBName] = useState("賞与");
  const [bGroup, setBGroup] = useState<AccountGroup>("other");
  const addBonus = async () => {
    if (!bDate || !bAmount) { toast("日付と金額を入れてください"); return; }
    if (await store.run(() => actions.addAccount({ account: "bank", direction: "in", status: "plan", group: bGroup, category: null, name: bName, date: bDate, amount: bAmount }))) { toast("入金の予定を入れました"); setBDate(""); setBAmount(""); }
  };
  return (
    <>
      <section>
        <h2>毎月の収入（給与の見込み） <button className="btn ghost sm" onClick={() => setEdit({ name: "給与", kind: "income", group: "salary", category: null, amount: data.settings.salaryEstimate, day: data.settings.payday, shift: "next", pay: "bank", active: true })}>＋ 追加</button></h2>
        <div className="panel">
          {incomeRec.length ? <div className="list">{incomeRec.map((r) => <RecRow key={r.id} r={r} s={data.settings} onOpen={() => setEdit(r)} />)}</div> : <div className="note">まだありません。「追加」から給与を入れると、毎月の入金の予定が自動でできます。</div>}
          <div className="note">見込みの額で予定を作り、給料日に自動で確定になります。額が違ったら、口座明細を開いて直してください。</div>
        </div>
      </section>
      <section>
        <h2>賞与・急な入金の見込み</h2>
        <div className="panel">
          <div className="grid2">
            <Field label="日付"><input type="date" value={bDate} onChange={(e) => setBDate(e.target.value)} /></Field>
            <Field label="金額"><NumInput value={bAmount} onChange={setBAmount} /></Field>
            <Field label="名称"><input value={bName} onChange={(e) => setBName(e.target.value)} /></Field>
            <Field label="大費目"><Select value={bGroup} options={IN_GROUPS} labels={ACCOUNT_GROUP_LABEL} onChange={setBGroup} /></Field>
          </div>
          <div className="note">賞与はふつう「その他」（予算に入れない）。名称に「賞与」とあれば、計画をつくるで返済・積立に回せます。</div>
          <div className="btns"><button className="btn" onClick={addBonus}>入金の予定を入れる</button></div>
          {extras.length > 0 && <div className="list">{extras.map((e) => (
            <button className="row" key={e.id} onClick={() => onOpen({ type: "account", entry: e })}>
              <span className="d num">{md(e.date)}</span><span className="t"><div>{e.name || "入金"}</div><div>{ACCOUNT_GROUP_LABEL[e.group]}・{e.status === "plan" ? "予定" : "確定"}・タップで直す</div></span><span className="a num">＋{money(e.amount)}</span>
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
        <h2>定期マスタ <button className="btn ghost sm" onClick={() => setEdit({ kind: "expense", group: "fixed", category: data.settings.fixCats[0] ?? null, day: 27, shift: "next", pay: "bank", active: true, amount: 0, name: "" })}>＋ 追加</button></h2>
        <div className="note">ここに入れたものから、今月〜5か月先の予定が自動でできます（口座・財布なら口座明細、クレカならクレカ明細）。給与は「給与・賞与」のタブ、リボ・分割の返済は「目標」のタブにあります。</div>
      </section>
      <section>
        <h2>固定費 <small>計 {yen(fixed.reduce((a, r) => a + (r.active ? r.amount : 0), 0))}円</small></h2>
        <div className="panel">{fixed.length ? <div className="list">{fixed.map((r) => <RecRow key={r.id} r={r} s={data.settings} onOpen={() => setEdit(r)} />)}</div> : <div className="note">まだありません</div>}</div>
      </section>
      <section>
        <h2>そのほか <small>計 {yen(others.reduce((a, r) => a + (r.active ? r.amount : 0), 0))}円</small></h2>
        <div className="panel">{others.length ? <div className="list">{others.map((r) => <RecRow key={r.id} r={r} s={data.settings} onOpen={() => setEdit(r)} />)}</div> : <div className="note">まだありません</div>}</div>
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
  const groups: string[] = x.kind === "income" ? IN_GROUPS : x.pay === "card" ? ["variable", "fixed", "installment"] : ["variable", "fixed", "other"];
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
        <Field label="金額（見込み）"><NumInput value={x.amount ?? ""} onChange={(v) => set({ amount: v === "" ? 0 : v })} /></Field>
        <Field label="くり返し"><Select value={String(x.every || 1)} options={["1", "2", "3", "6", "12"]} labels={EVERY_LABEL} onChange={(v) => set({ every: +v })} /></Field>
        <Field label="日（31＝月末）" hint={x.pay === "card" ? "クレカは利用日" : undefined}><NumInput plain value={x.day ?? ""} onChange={(v) => set({ day: v === "" ? 1 : Math.min(31, Math.max(1, v)) })} /></Field>
        <Field label="土日祝のとき"><Select value={x.shift ?? "next"} options={["next", "prev", "none"] as const} labels={SHIFT_LABEL} onChange={(v) => set({ shift: v })} /></Field>
        {x.kind === "expense" && <Field label="払い方"><Select value={payKey} options={payKeys} labels={payLabels} onChange={(v) => { const card = v.startsWith("card:") ? v.slice(5) : null; set({ pay: card ? "card" : (v as Recurring["pay"]), card, group: card && x.group === "other" ? "fixed" : !card && x.group === "installment" ? "other" : x.group }); }} /></Field>}
      </div>
      <Field label="大費目"><Select value={(x.group ?? "fixed") as string} options={groups} labels={labels as Record<string, string>} onChange={(v) => set({ group: v as Recurring["group"] })} /></Field>
      {x.kind === "expense" && (x.group === "variable" || x.group === "fixed") && <Field label="費目"><Select value={x.category ?? ""} options={cats} labels={{ "": "未分類" }} onChange={(v) => set({ category: v || null, group: v ? groupOfCat(s, v) : x.group })} /></Field>}
      {x.kind === "expense" && x.pay === "card" && <Field label="お店の名前のヒント（なくてもよい）" hint="カードの明細のお店にこの言葉が入っていれば、費目が違ってもこの予定とまとめます（例：モバイルSuica）"><input value={x.shop ?? ""} onChange={(e) => set({ shop: e.target.value })} /></Field>}
      <div className="grid2">
        <Field label={(x.every || 1) > 1 ? "始める月（この月から数える。空なら今月）" : "始める月（空なら今から）"}><input type="month" value={x.start_month ?? ""} onChange={(e) => set({ start_month: e.target.value || null })} /></Field>
        <Field label="終わる月（空ならずっと）"><input type="month" value={x.end_month ?? ""} onChange={(e) => set({ end_month: e.target.value || null })} /></Field>
      </div>
      {(x.every || 1) > 1 && <div className="note">{whenLabel({ every: x.every || 1, day: x.day || 1, start_month: x.start_month || today.slice(0, 7) })}に予定を作ります。予定がない月は、固定費の見込みにも入りません。</div>}
      <label className="check"><input type="checkbox" checked={x.active !== false} onChange={(e) => set({ active: e.target.checked })} />使う（外すと予定を作らない）</label>
      <div className="btns">
        <button className="btn" onClick={save}>保存</button>
        <button className="btn ghost" onClick={onClose}>やめる</button>
        {x.id && <button className="btn danger" onClick={remove}>消す</button>}
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
      <h2>お店→費目のルール <small>{data.rules.length}件</small></h2>
      <div className="panel">
        <div className="note">カードのメールのお店の名前に、この言葉が入っていれば費目を自動で入れます（いちばん長く一致したもの）。大費目は費目から決まります。明細の費目を直すと自動で増えます。</div>
        <div className="grid2">
          <Field label="お店の名前に入る言葉"><input value={pattern} onChange={(e) => setPattern(e.target.value)} /></Field>
          <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>
        </div>
        <div className="btns"><button className="btn" onClick={add}>追加・上書き</button></div>
        <Field label="さがす"><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <table className="tbl"><tbody>
          {rules.map((r) => (
            <tr key={r.id}><td>{r.pattern}</td><td>{r.category}</td><td><button className="btn sm danger" onClick={async () => { if (await store.run(() => actions.deleteRule(r.id))) toast("消しました"); }}>消す</button></td></tr>
          ))}
        </tbody></table>
      </div>
    </section>
  );
}

// ---------- 費目とカード ----------

function Assets({ store, data }: { store: Store; data: AppData }) {
  const [s, setS] = useState<S>(data.settings);
  const n = (k: "safety" | "payday" | "salaryEstimate") => <NumInput plain={k === "payday"} value={s[k]} onChange={(v) => setS({ ...s, [k]: v === "" ? 0 : v })} />;
  const save = async () => { if (await store.run(() => actions.saveSettings(s))) toast("保存しました"); };
  return (
    <section>
      <h2>口座とカードの設定</h2>
      <div className="panel">
        <Field label="安全残高（口座にいつも残しておく額）" hint="給料日の前日に残る額がこれより少ないと赤くします">{n("safety")}</Field>
        <div className="grid2">
          <Field label="給料日">{n("payday")}</Field>
          <Field label="給与の見込み額" hint="給与の予定がない先の月に使う">{n("salaryEstimate")}</Field>
        </div>
        {s.cards.map((c, i) => {
          const setC = (p: Partial<CardDef>) => setS({ ...s, cards: s.cards.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          return (
            <div key={c.id} className="grid2">
              <Field label={i === 0 ? "カードの名前（いつも使うカード・メールから入る）" : "カードの名前"}><input value={c.name} onChange={(e) => setC({ name: e.target.value })} /></Field>
              <Field label="締め日（31＝月末）"><NumInput plain value={c.closingDay} onChange={(v) => setC({ closingDay: v === "" ? 31 : v })} /></Field>
              <Field label="引落日"><NumInput plain value={c.payDay} onChange={(v) => setC({ payDay: v === "" ? 1 : v })} /></Field>
              <Field label="引き落とす月"><Select value={String(c.payMonths)} options={["1", "2"]} labels={{ "1": "締めた翌月", "2": "締めた翌々月" }} onChange={(v) => setC({ payMonths: +v })} /></Field>
            </div>
          );
        })}
        <div className="btns">
          <button className="btn ghost sm" onClick={() => setS({ ...s, cards: [...s.cards, { id: `card${Date.now().toString(36)}`, name: "新しいカード", closingDay: 31, payDay: 27, payMonths: 1 }] })}>＋ カードを足す</button>
        </div>
        <div className="btns"><button className="btn" onClick={save}>保存</button></div>
      </div>
    </section>
  );
}

// ---------- 区分 ----------

const GROUP_KEYS = ["variable", "fixed", "tatekae", "installment", "purchase", "card", "other", "salary", "extra", "refund"] as const;
const GROUP_WHERE: Record<(typeof GROUP_KEYS)[number], string> = {
  variable: "クレカ明細・口座明細の出金", fixed: "クレカ明細・口座明細の出金", tatekae: "クレカ明細・口座明細の出金", installment: "クレカ明細",
  purchase: "クレカ明細", card: "口座明細の出金（クレカの請求）", other: "口座明細の入金・出金", salary: "口座明細の入金", extra: "口座明細の入金", refund: "口座明細の入金",
};

/** 区分：費目（名前・大費目・1日に使える額・追加・削除）と大費目の名前 */
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
  const toggleDaily = (c: string) => saveS({ dailyCats: s.dailyCats.includes(c) ? s.dailyCats.filter((x) => x !== c) : [...s.dailyCats, c] }, "保存しました");
  const saveLabels = () => {
    const changed = Object.fromEntries(Object.entries(labels).filter(([k, v]) => v.trim() && v !== GROUP_LABEL_DEFAULTS[k]).map(([k, v]) => [k, v.trim()]));
    saveS({ labels: changed }, "大費目の名前を保存しました");
  };

  const row = (c: string, g: "variable" | "fixed") => (
    <div className="kindrow" key={c}>
      <input value={names[c] ?? c} onChange={(e) => setNames({ ...names, [c]: e.target.value })} onBlur={() => rename(c)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label={`${c}の名前`} />
      <div className="kindctl">
        <Select value={g} options={["variable", "fixed"] as const} labels={{ variable: labels.variable, fixed: labels.fixed }} onChange={(v) => setGroup(c, v)} />
        <label className="check"><input type="checkbox" checked={s.dailyCats.includes(c)} onChange={() => toggleDaily(c)} />1日に使える額</label>
        <span className="note">明細 {used(c)}件</span>
        <button className="btn sm danger" onClick={() => remove(c)}>消す</button>
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
          <div className="kindrow"><b>{RESERVE}</b><div className="note">{labels.variable}・残りが自動で入る（変えられない）</div></div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <Field label="新しい費目の名前"><input value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
            <Field label="大費目"><Select value={newGroup} options={["variable", "fixed"] as const} labels={{ variable: labels.variable, fixed: labels.fixed }} onChange={setNewGroup} /></Field>
          </div>
          <div className="btns"><button className="btn" onClick={add}>費目を足す</button></div>
        </div>
      </section>
      <section>
        <h2>大費目の名前 <small>名前だけ変えられる（計算のしかたは変わらない）</small></h2>
        <div className="panel">
          <table className="tbl"><tbody>
            {GROUP_KEYS.map((k) => (
              <tr key={k}>
                <td style={{ textAlign: "left" }}><input value={labels[k] ?? ""} onChange={(e) => setLabels({ ...labels, [k]: e.target.value })} aria-label={`${GROUP_LABEL_DEFAULTS[k]}の名前`} /><div className="note">{GROUP_WHERE[k]}{labels[k] !== GROUP_LABEL_DEFAULTS[k] ? `・はじめは「${GROUP_LABEL_DEFAULTS[k]}」` : ""}</div></td>
              </tr>
            ))}
          </tbody></table>
          <div className="btns"><button className="btn" onClick={saveLabels}>保存</button><button className="btn ghost" onClick={() => setLabels({ ...GROUP_LABEL_DEFAULTS })}>はじめの名前に戻す</button></div>
          <div className="note">大費目は、それぞれ予算や請求での数え方が決まっているので、ここでは増やせません。増やしたい大費目があれば、どう数えるか決めてから足します。</div>
        </div>
      </section>
    </>
  );
}

// ---------- データ ----------

function DataTab({ store, data }: { store: Store; data: AppData }) {
  const [msg, setMsg] = useState("");
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    let json: ImportFile;
    try { json = JSON.parse(await f.text()); } catch { toast("JSON として読めませんでした"); return; }
    if (!confirm(`「${f.name}」を取り込みますか？`)) return;
    let result = "";
    if (await store.run(async () => { result = await actions.importJson(data, json); })) { setMsg(result); toast("取り込みました"); }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gholdengo-${todayJST()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section>
      <h2>データ</h2>
      <div className="panel">
        <div className="note">アプリの版：{VERSION_LABEL}</div>
        <div className="note">保存先：{backend.mode === "supabase" ? "Supabase（ログインした本人だけが読み書きできます）" : "この端末のブラウザの中（お試しモード）"}</div>
        <div className="note">クレカ明細 {data.cards.length}件・口座明細 {data.accounts.length}件・残高の記録 {data.balances.length}件・定期 {data.recurring.length}件・目標 {data.goals.length}件</div>
        <div className="btns"><button className="btn ghost" onClick={download}>すべてのデータを書き出す（JSON）</button></div>
        <Field label="移行用の JSON を取り込む" hint="移行用に作ったファイル（format: gholdengo-import-v1）。2回取り込んでも二重にはなりません">
          <input type="file" accept="application/json,.json" onChange={(e) => importFile(e.target.files?.[0])} />
        </Field>
        {msg && <div className="alert ok">{msg}</div>}
        {backend.mode === "local" && (
          <div className="btns"><button className="btn danger" onClick={() => { if (confirm("お試しモードのデータをすべて消しますか？")) { resetLocal(); location.reload(); } }}>お試しのデータを消す</button></div>
        )}
      </div>
    </section>
  );
}
