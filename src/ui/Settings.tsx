import { useEffect, useState } from "react";
import { budgetCats, computeMonth, FIXED_DEBIT, isLive, OUTSIDE, RESERVE, todayJST, type Debt, type Method, type Recurring, type Settings as S } from "../engine";
import { actions, type AppData, type ImportFile, type Store } from "../data/store";
import { backend, resetLocal } from "../data/backend";
import { ALL_METHODS, Field, md, METHOD_LABEL, NumInput, Select, Sheet, signed, toast, yen, ymLabel } from "./common";

type Tab = "budget" | "income" | "recurring" | "rules" | "debts" | "assets" | "data";
const TABS: [Tab, string][] = [["budget", "予算"], ["income", "給与・賞与"], ["recurring", "定期のお金"], ["rules", "費目のルール"], ["debts", "借金"], ["assets", "資産・カード"], ["data", "データ"]];

export function SettingsView({ store, data, month }: { store: Store; data: AppData; month: string }) {
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
      {tab === "income" && <Income store={store} data={data} />}
      {tab === "recurring" && <RecurringList store={store} data={data} />}
      {tab === "rules" && <Rules store={store} data={data} />}
      {tab === "debts" && <Debts store={store} data={data} />}
      {tab === "assets" && <Assets store={store} data={data} />}
      {tab === "data" && <DataTab store={store} data={data} />}
    </>
  );
}

// ---------- 予算 ----------

function Budgets({ store, data, month }: { store: Store; data: AppData; month: string }) {
  const today = todayJST();
  const v = computeMonth(data, month, today);
  const cats = budgetCats(data.settings).filter((c) => c !== RESERVE);
  const init = () => Object.fromEntries(cats.map((c) => [c, v.cats.find((r) => r.cat === c)?.budget ?? 0])) as Record<string, number | "">;
  const [vals, setVals] = useState(init);
  useEffect(() => setVals(init()), [month, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = cats.reduce((a, c) => a + (Number(vals[c]) || 0), 0);
  const reserve = v.T == null ? null : v.T - sum;
  const own = data.budgets.some((b) => b.month === month && b.category !== RESERVE);

  const save = async () => {
    const map = Object.fromEntries(cats.map((c) => [c, Number(vals[c]) || 0]));
    if (await store.run(() => actions.saveBudgets(month, map))) toast(`${ymLabel(month)}の予算を保存しました`);
  };
  return (
    <section>
      <h2>{ymLabel(month)}の費目予算 <small>{own ? "この月の予算" : "前の月から引き継いでいます"}</small></h2>
      <div className="panel">
        <div className="legend" style={{ justifyContent: "space-between" }}><span>使える予算（口座から計算）</span><b className="num">{v.T == null ? "―" : yen(v.T)}円</b></div>
        <div className="budgetgrid">
          {cats.map((c) => {
            const r = v.cats.find((x) => x.cat === c);
            return [
              <label key={c + "l"} htmlFor={`b_${c}`}>{c}<span className="note"> 使った {yen(r?.used ?? 0)}</span></label>,
              <NumInput key={c + "i"} id={`b_${c}`} value={vals[c] ?? ""} onChange={(x) => setVals({ ...vals, [c]: x })} />,
            ];
          })}
          <span><b>予備</b><span className="note">（自動で残りが入る）</span></span>
          <b className={`num ${reserve != null && reserve < 0 ? "neg" : ""}`} style={{ textAlign: "right" }}>{reserve == null ? "―" : signed(reserve)}</b>
        </div>
        {reserve != null && reserve < 0 && <div className="alert">使える予算より {yen(-reserve)}円 多く割り振っています。どこかを減らしてください。</div>}
        <div className="btns"><button className="btn" onClick={save}>この月の予算を保存</button></div>
        <div className="note">保存しない月は、前の月の予算をそのまま使います。固定費は「定期のお金」の見込み額が目安です。</div>
      </div>
    </section>
  );
}

// ---------- 給与・賞与 ----------

function Income({ store, data }: { store: Store; data: AppData }) {
  const today = todayJST();
  const incomeRec = data.recurring.filter((r) => r.kind === "income");
  const bonuses = data.entries.filter((e) => isLive(e) && e.kind === "income" && !e.recurring_id && e.date >= today.slice(0, 7)).sort((a, b) => a.date.localeCompare(b.date));
  const [edit, setEdit] = useState<Partial<Recurring> | null>(null);
  const [bDate, setBDate] = useState("");
  const [bAmount, setBAmount] = useState<number | "">("");
  const [bName, setBName] = useState("賞与");

  const addBonus = async () => {
    if (!bDate || !bAmount) { toast("日付と金額を入れてください"); return; }
    if (await store.run(() => actions.addEntry({ kind: "income", status: "plan", date: bDate, amount: bAmount, method: "bank", category: null, item: bName }))) {
      toast("入金の予定を追加しました"); setBDate(""); setBAmount("");
    }
  };
  return (
    <>
      <section>
        <h2>毎月の収入（給与の見込み） <button className="btn ghost sm" onClick={() => setEdit({ name: "給与", kind: "income", amount: data.settings.salaryEstimate, day: data.settings.payday, shift: "next", method: "bank", active: true })}>＋ 追加</button></h2>
        <div className="panel">
          {incomeRec.length ? <div className="list">{incomeRec.map((r) => <RecRow key={r.id} r={r} onOpen={() => setEdit(r)} />)}</div> : <div className="note">まだありません。「追加」から給与を入れると、毎月の入金の予定が自動でできます。</div>}
          <div className="note">見込みの金額で予定を作ります。実際の入金があったら「予定」の画面で確定にしてください。</div>
        </div>
      </section>
      <section>
        <h2>賞与・急な入金の見込み</h2>
        <div className="panel">
          <div className="grid2">
            <Field label="日付"><input type="date" value={bDate} onChange={(e) => setBDate(e.target.value)} /></Field>
            <Field label="金額"><NumInput value={bAmount} onChange={setBAmount} /></Field>
          </div>
          <Field label="内容"><input value={bName} onChange={(e) => setBName(e.target.value)} /></Field>
          <div className="btns"><button className="btn" onClick={addBonus}>入金の予定を追加</button></div>
          {bonuses.length > 0 && <div className="list">{bonuses.map((e) => (
            <div className="row" key={e.id} style={{ cursor: "default" }}>
              <span className="d num">{md(e.date)}</span><span className="t"><div>{e.item || "入金"}</div><div>{e.status === "plan" ? "予定" : "確定"}</div></span><span className="a num">＋{yen(e.amount)}</span>
            </div>))}</div>}
        </div>
      </section>
      {edit && <RecurringSheet store={store} data={data} r={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

// ---------- 定期のお金 ----------

const SHIFT_LABEL = { next: "後の平日", prev: "前の平日", none: "ずらさない" } as const;

function RecRow({ r, onOpen }: { r: Recurring; onOpen: () => void }) {
  return (
    <button className="row" onClick={onOpen} style={{ gridTemplateColumns: "1fr auto" }}>
      <span className="t"><div>{r.name} {!r.active && <span className="chip">止めている</span>}</div><div>毎月{r.day}日（土日祝は{SHIFT_LABEL[r.shift]}）・{METHOD_LABEL[r.method]}{r.category ? `・${r.category}` : ""}{r.end_month ? `・${ymLabel(r.end_month)}まで` : ""}</div></span>
      <span className="a num">{r.kind === "income" ? "＋" : ""}{yen(r.amount)}</span>
    </button>
  );
}

function RecurringList({ store, data }: { store: Store; data: AppData }) {
  const [edit, setEdit] = useState<Partial<Recurring> | null>(null);
  const exp = data.recurring.filter((r) => r.kind === "expense");
  const fixed = exp.filter((r) => r.category === FIXED_DEBIT || r.category === OUTSIDE);
  const inBudget = exp.filter((r) => !fixed.includes(r));
  return (
    <>
      <section>
        <h2>定期のお金 <button className="btn ghost sm" onClick={() => setEdit({ kind: "expense", category: FIXED_DEBIT, day: 27, shift: "next", method: "bank", active: true, amount: 0, name: "" })}>＋ 追加</button></h2>
        <div className="note">ここに入れたものから、今月〜3か月先の予定が自動でできます。</div>
      </section>
      <section>
        <h2>予算に入れない引落 <small>家賃・ローン・保険など 計 {yen(fixed.reduce((a, r) => a + (r.active ? r.amount : 0), 0))}円</small></h2>
        <div className="panel">{fixed.length ? <div className="list">{fixed.map((r) => <RecRow key={r.id} r={r} onOpen={() => setEdit(r)} />)}</div> : <div className="note">まだありません</div>}</div>
      </section>
      <section>
        <h2>予算の中の定期の支出 <small>通信・サブスクなど 計 {yen(inBudget.reduce((a, r) => a + (r.active ? r.amount : 0), 0))}円</small></h2>
        <div className="panel">{inBudget.length ? <div className="list">{inBudget.map((r) => <RecRow key={r.id} r={r} onOpen={() => setEdit(r)} />)}</div> : <div className="note">まだありません</div>}</div>
      </section>
      {edit && <RecurringSheet store={store} data={data} r={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function RecurringSheet({ store, data, r, onClose }: { store: Store; data: AppData; r: Partial<Recurring>; onClose: () => void }) {
  const [x, setX] = useState<Partial<Recurring>>(r);
  const set = (p: Partial<Recurring>) => setX({ ...x, ...p });
  const cats = ["", ...budgetCats(data.settings), OUTSIDE, FIXED_DEBIT];
  const today = todayJST();
  const save = async () => {
    if (!x.name || !x.amount || !x.day) { toast("名前・金額・日を入れてください"); return; }
    const row = { ...x, category: x.kind === "income" ? null : x.category || null };
    if (await store.run(() => actions.saveRecurring(data, row, today))) { toast("保存しました"); onClose(); }
  };
  const remove = async () => {
    if (!x.id || !confirm("この定期のお金を消しますか？（これからの予定も消えます）")) return;
    if (await store.run(() => actions.deleteRecurring(data, x.id!, today))) { toast("消しました"); onClose(); }
  };
  return (
    <Sheet title={x.id ? "定期のお金を直す" : "定期のお金を追加"} onClose={onClose}>
      <div className="seg">{(["expense", "income"] as const).map((k) => <button key={k} aria-pressed={x.kind === k} onClick={() => set({ kind: k })}>{k === "income" ? "収入" : "支出"}</button>)}</div>
      <Field label="名前"><input value={x.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="金額（見込み）"><NumInput value={x.amount ?? ""} onChange={(v) => set({ amount: v === "" ? 0 : v })} /></Field>
        <Field label="毎月の日（31＝月末）"><NumInput value={x.day ?? ""} onChange={(v) => set({ day: v === "" ? 1 : Math.min(31, Math.max(1, v)) })} /></Field>
      </div>
      <div className="grid2">
        <Field label="土日祝のとき"><Select value={x.shift ?? "next"} options={["next", "prev", "none"] as const} labels={SHIFT_LABEL} onChange={(v) => set({ shift: v })} /></Field>
        <Field label="金種"><Select value={(x.method ?? "bank") as Method} options={ALL_METHODS} labels={METHOD_LABEL} onChange={(v) => set({ method: v })} /></Field>
      </div>
      {x.kind === "expense" && <Field label="費目" hint="家賃などの予算に入れない引落は「固定引落」"><Select value={x.category ?? ""} options={cats} labels={{ "": "未分類" }} onChange={(v) => set({ category: v || null })} /></Field>}
      <div className="grid2">
        <Field label="始める月（空なら今から）"><input type="month" value={x.start_month ?? ""} onChange={(e) => set({ start_month: e.target.value || null })} /></Field>
        <Field label="終わる月（空ならずっと）"><input type="month" value={x.end_month ?? ""} onChange={(e) => set({ end_month: e.target.value || null })} /></Field>
      </div>
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
  const cats = [...budgetCats(data.settings), OUTSIDE, FIXED_DEBIT];
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
        <div className="note">カードのメールのお店の名前に、この言葉が入っていれば費目を自動で入れます（いちばん長く一致したもの）。明細の費目を直すと自動で増えます。</div>
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

// ---------- 借金 ----------

function Debts({ store, data }: { store: Store; data: AppData }) {
  const [edit, setEdit] = useState<Partial<Debt> | null>(null);
  return (
    <section>
      <h2>リボ・分割 <button className="btn ghost sm" onClick={() => setEdit({ name: "", balance: 0, rate: "", min_payment: 0, note: "", planned: false })}>＋ 追加</button></h2>
      <div className="panel">
        {data.debts.length ? <div className="list">{data.debts.map((d) => (
          <button className="row" key={d.id} onClick={() => setEdit(d)} style={{ gridTemplateColumns: "1fr auto" }}>
            <span className="t"><div>{d.name} {d.planned && <span className="chip warn">予定</span>}</div><div>{d.as_of ? `${md(d.as_of)}時点・` : ""}最低返済 {yen(d.min_payment)}円{d.note ? `・${d.note}` : ""}</div></span>
            <span className="a num">{yen(d.balance)}</span>
          </button>))}</div> : <div className="note">ありません</div>}
        <div className="note">毎月の返済は「返済」費目の支出として予算に入れます。返済の予算が最低返済額より少ないと警告します。</div>
      </div>
      {edit && <DebtSheet store={store} d={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function DebtSheet({ store, d, onClose }: { store: Store; d: Partial<Debt>; onClose: () => void }) {
  const [x, setX] = useState(d);
  const set = (p: Partial<Debt>) => setX({ ...x, ...p });
  const save = async () => {
    if (!x.name) { toast("名前を入れてください"); return; }
    const row = { ...x, as_of: x.balance !== d.balance || !x.as_of ? todayJST() : x.as_of };
    if (await store.run(() => actions.saveDebt(row))) { toast("保存しました"); onClose(); }
  };
  return (
    <Sheet title={x.id ? x.name || "借金" : "借金を追加"} onClose={onClose}>
      <Field label="名前"><input value={x.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="残高"><NumInput value={x.balance ?? ""} onChange={(v) => set({ balance: v === "" ? 0 : v })} /></Field>
        <Field label="毎月の最低返済額"><NumInput value={x.min_payment ?? ""} onChange={(v) => set({ min_payment: v === "" ? 0 : v })} /></Field>
      </div>
      <Field label="金利・手数料"><input value={x.rate ?? ""} onChange={(e) => set({ rate: e.target.value })} /></Field>
      <Field label="メモ（次の返済・完済の予定など）"><textarea rows={3} value={x.note ?? ""} onChange={(e) => set({ note: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={!!x.planned} onChange={(e) => set({ planned: e.target.checked })} />まだ借りていない（予定）</label>
      <div className="btns">
        <button className="btn" onClick={save}>保存</button>
        <button className="btn ghost" onClick={onClose}>やめる</button>
        {x.id && <button className="btn danger" onClick={async () => { if (confirm("消しますか？") && await store.run(() => actions.deleteDebt(x.id!))) onClose(); }}>消す</button>}
      </div>
    </Sheet>
  );
}

// ---------- 資産・カード ----------

function Assets({ store, data }: { store: Store; data: AppData }) {
  const [s, setS] = useState<S>(data.settings);
  const n = (k: keyof S) => <NumInput value={s[k] as number} onChange={(v) => setS({ ...s, [k]: v === "" ? 0 : v })} />;
  const save = async () => { if (await store.run(() => actions.saveSettings(s))) toast("保存しました"); };
  return (
    <section>
      <h2>資産・カードの設定</h2>
      <div className="panel">
        <Field label="安全残高（口座にいつも残しておく額）" hint="残り予算は、引落日までこの額を下回らないように計算します">{n("safety")}</Field>
        <Field label="目標残高（給料日前日に残したい額）">{n("reserveGoal")}</Field>
        <div className="grid2">
          <Field label="給料日">{n("payday")}</Field>
          <Field label="給与の見込み額">{n("salaryEstimate")}</Field>
        </div>
        <div className="grid2">
          <Field label="カードの締め日（31＝月末）">{n("cardClosingDay")}</Field>
          <Field label="カードの引落日">{n("cardPayDay")}</Field>
        </div>
        <Field label="1日に使える額を出す費目" hint="「、」で区切る"><input value={s.dailyCats.join("、")} onChange={(e) => setS({ ...s, dailyCats: e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean) })} /></Field>
        <Field label="変動費の費目" hint="「、」で区切る"><input value={s.varCats.join("、")} onChange={(e) => setS({ ...s, varCats: e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean) })} /></Field>
        <Field label="固定費の費目" hint="「、」で区切る"><input value={s.fixCats.join("、")} onChange={(e) => setS({ ...s, fixCats: e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean) })} /></Field>
        <div className="btns"><button className="btn" onClick={save}>保存</button></div>
      </div>
    </section>
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
        <div className="note">保存先：{backend.mode === "supabase" ? "Supabase（ログインした本人だけが読み書きできます）" : "この端末のブラウザの中（お試しモード）"}</div>
        <div className="note">明細 {data.entries.length}件・残高の報告 {data.balances.length}件・定期 {data.recurring.length}件</div>
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
