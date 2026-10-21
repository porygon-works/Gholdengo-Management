import { useState } from "react";
import { addMonths, budgetCats, computeMonth, debitsFor, dipBefore, latestBalance, balanceTotal, nextMonthSpend, RESERVE, type CardDebit, type Entry } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { Bar, Chip, entryTitle, Field, fromPayKey, md, NumInput, payKeys, payLabels, QUICK_METHODS, Select, signed, toast, yen, ymLabel } from "./common";

interface Props {
  store: Store;
  data: AppData;
  month: string;
  today: string;
  reviews: number;
  go: (to: "ledger" | "review" | "passbook" | "balance" | "settings", cat?: string) => void;
}

function QuickForm({ store, data, today }: { store: Store; data: AppData; today: string }) {
  const cats = budgetCats(data.settings).filter((c) => c !== RESERVE);
  const [cat, setCat] = useState(cats[0]);
  const [amount, setAmount] = useState<number | "">("");
  const st = data.settings;
  const [pay, setPay] = useState("cash");
  const [more, setMore] = useState(false);
  const [date, setDate] = useState(today);
  const [item, setItem] = useState("");
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!amount) { toast("金額を入れてください"); return; }
    setBusy(true);
    const { method, card } = fromPayKey(pay);
    const ok = await store.run(() => actions.addEntry({ kind: "expense", status: "confirmed", date, amount, method, card, category: cat, item, shop }));
    setBusy(false);
    if (ok) {
      toast(pay === payKeys(st, ["card"])[0] ? `${cat} ${yen(amount)}円を入れました。カードのメールが来たら自動でまとめます` : `${cat} ${yen(amount)}円を入れました`);
      setAmount(""); setItem(""); setShop(""); setDate(today); setMore(false);
    }
  };

  return (
    <div className="panel quick">
      <div className="grid2">
        <Field label="費目"><Select value={cat} options={cats} onChange={setCat} /></Field>
        <Field label="金額"><NumInput value={amount} onChange={setAmount} placeholder="0" /></Field>
      </div>
      <div className="seg" role="group" aria-label="金種">
        {payKeys(st, QUICK_METHODS).map((k) => <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}>{payLabels(st)[k]}</button>)}
      </div>
      {more && (
        <>
          <div className="grid2">
            <Field label="日付"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="お店"><input value={shop} onChange={(e) => setShop(e.target.value)} /></Field>
          </div>
          <Field label="買ったもの"><input value={item} onChange={(e) => setItem(e.target.value)} /></Field>
        </>
      )}
      <div className="btns">
        <button className="btn" onClick={add} disabled={busy}>入れる</button>
        {!more && <button className="btn ghost" onClick={() => setMore(true)}>日付・お店も入れる</button>}
      </div>
    </div>
  );
}

type Row = ReturnType<typeof computeMonth>["cats"][number];

/** 表の合計の行 */
function total(rs: Row[], daily: boolean, fixed = false) {
  const sum = (f: (r: Row) => number) => rs.reduce((a, r) => a + f(r), 0);
  const rem = sum((r) => r.rem);
  return (
    <tr className="sum">
      <td>合計</td>
      <td className="num">{yen(sum((r) => r.budget))}</td>
      <td className="num">{yen(sum((r) => r.used))}{sum((r) => r.planned) ? <span className="note">＋{yen(sum((r) => r.planned))}</span> : null}</td>
      <td className={`num ${rem < 0 ? "neg" : ""}`}>{fixed ? yen(sum((r) => Math.max(0, r.budget - r.used))) : signed(rem)}</td>
      {daily && <td />}
    </tr>
  );
}

const line = (label: React.ReactNode, value: React.ReactNode, strong = false) => (
  <div className="legend" style={{ justifyContent: "space-between" }}><span>{label}</span>{strong ? <b className="num">{value}</b> : <span className="num">{value}</span>}</div>
);

/** 来月の支払い予定：固定費の見込み＋変動費（来月の予算）＋リボ・分割 */
function NextMonth({ data, month }: { data: AppData; month: string }) {
  const n = nextMonthSpend(data, addMonths(month, 1));
  return (
    <section>
      <h2>来月の支払い予定 <small>{ymLabel(n.ym)}に使う予定のお金</small></h2>
      <div className="panel">
        {line("固定費（見込み）", `${yen(n.fixed)}円`)}
        {line("＋ 変動費（来月の予算）", `${yen(n.variable)}円`)}
        {n.repay > 0 && line("＋ リボ・分割の返済", `${yen(n.repay)}円`)}
        {line("計", `${yen(n.total)}円`, true)}
        <div className="note">カードで払う分は、口座から出るのが翌月以降になります。口座から出る日で見るのは下の「引き落とし」です。</div>
      </div>
    </section>
  );
}

/** 引き落とし：その月に口座から出るもの。カードは前の月の利用から見込みを出し、請求額が分かれば確定にする */
function Debits({ store, data, month }: { store: Store; data: AppData; month: string }) {
  const x = debitsFor(data, month);
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState<number | "">("");
  const saveBill = async (c: CardDebit, amount: number | null) => {
    const id = data.cardBills.find((b) => b.card === c.card.id && b.pay_date === c.date)?.id;
    if (await store.run(() => actions.saveBill(c.card.id, c.date, amount, id))) { toast(amount == null ? "見込みに戻しました" : `${c.card.name}の請求額を確定にしました`); setEdit(null); }
  };
  const rowOf = (e: Entry) => line(<>{md(e.date)} {entryTitle(e)} {e.status === "plan" && <Chip kind="warn">予定</Chip>}</>, yen(e.amount));
  return (
    <section>
      <h2>引き落とし <small>{ymLabel(month)}に口座から出るお金</small></h2>
      <div className="panel">
        <div className="cathead" style={{ cursor: "default" }}><span className="n">口座から直接</span><span className="s num">{yen(x.directSum)}円</span></div>
        {x.direct.length ? x.direct.map((e) => <div key={e.id}>{rowOf(e)}</div>) : <div className="note">この月はありません</div>}
      </div>
      {x.cards.map((c) => (
        <div className="panel" key={c.card.id}>
          <div className="cathead" style={{ cursor: "default" }}>
            <span className="n">{c.card.name}（{+c.closingYm.slice(5)}月分・{md(c.date)}） {c.bill != null ? <Chip kind="ok">確定</Chip> : <Chip kind="warn">見込み</Chip>}</span>
            <span className="s num">{yen(c.amount)}円</span>
          </div>
          {line("使った分（明細と予定）", yen(c.items.reduce((a, e) => a + e.amount, 0)))}
          {c.repays.map((e) => <div key={e.id}>{line(<>＋ {entryTitle(e)}</>, yen(e.amount))}</div>)}
          {c.bill != null && c.bill !== c.estimate && <div className="note">見込み {yen(c.estimate)}円との差 {signed(c.bill - c.estimate)}円（入っていない明細があるかもしれません）</div>}
          {edit === c.card.id ? (
            <div className="grid2">
              <Field label="請求額（確定）"><NumInput value={val} onChange={setVal} /></Field>
              <div className="btns">
                <button className="btn sm" onClick={() => val !== "" && saveBill(c, val)}>確定にする</button>
                <button className="btn ghost sm" onClick={() => setEdit(null)}>やめる</button>
              </div>
            </div>
          ) : (
            <div className="btns">
              <button className="btn ghost sm" onClick={() => { setEdit(c.card.id); setVal(c.bill ?? c.estimate); }}>{c.bill != null ? "請求額を直す" : "請求額を入れる"}</button>
              {c.bill != null && <button className="btn ghost sm" onClick={() => saveBill(c, null)}>見込みに戻す</button>}
            </div>
          )}
        </div>
      ))}
      <div className="panel">
        {line("合計引き落とし", `${yen(x.total)}円`, true)}
      </div>
    </section>
  );
}

export function Dashboard({ store, data, month, today, reviews, go }: Props) {
  const v = computeMonth(data, month, today);
  const b = v.base;
  const bal = latestBalance(data.balances);
  const rows = v.cats.filter((c) => c.budget || c.used || c.planned);
  // 口座の残高から見た「出金の予定に対して足りなくなる日」だけを警告に使う（口座からの計算はいったんここまで）
  const dip = v.when === "current" ? dipBefore(data, today) : null;
  const label = v.when === "past" ? "この月の予算" : v.when === "future" ? `${+month.slice(5)}月の予算` : "今月の予算";

  return (
    <>
      {reviews > 0 && <button className="alert" onClick={() => go("review")} style={{ marginBottom: 16 }}>確認してほしいことが {reviews} 件あります（重複の候補など）。タップで開く</button>}

      <section>
        <div className="cards">
          <div className="kpi">
            <div className="lb">{label}</div>
            <div className="v num">{signed(v.T)}<small>円</small></div>
            <div className="note">変動費で使った {yen(v.U)}・予定 {yen(v.P)}</div>
          </div>
          <div className={`kpi ${v.R < 0 || dip ? "bad" : "main"}`}>
            <div className="lb">自由に使える残り</div>
            <div className="v num">{signed(v.R)}<small>円</small></div>
            <div className="note" style={{ color: "inherit", opacity: .85 }}>{dip ? `${md(dip.date)}に口座が足りません。先に入金が必要です` : v.R < 0 ? "予算をこえています" : v.daysLeft ? `残り${v.daysLeft}日・1日 ${yen(Math.max(0, Math.floor(v.R / v.daysLeft)))}円` : ""}</div>
          </div>
        </div>
        {v.T > 0 && <Bar budget={v.T} used={v.U} planned={v.P} />}
        <button className="panel" onClick={() => go("settings")} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
          <div className="legend" style={{ justifyContent: "space-between" }}><span>給与</span><b className="num">{yen(b.salary)}</b></div>
          {b.extra !== 0 && <div className="legend" style={{ justifyContent: "space-between" }}><span>＋ 追加予算</span><b className="num">{yen(b.extra)}</b></div>}
          <div className="legend" style={{ justifyContent: "space-between" }}><span>− 固定費（家賃・奨学金・通信・サブスクなど）</span><b className="num">{yen(b.fixed)}</b></div>
          <div className="legend" style={{ justifyContent: "space-between" }}><span>− 目標用マイナス（リボの返済・貯金）</span><b className="num">{yen(b.goal)}</b></div>
          <div className="note">タップすると設定で直せます</div>
        </button>
        {dip && <div className="alert bad">{md(dip.date)}に口座が {signed(dip.value)}円 になる見込みです。出金の予定に対して {yen(data.settings.safety - dip.value)}円 足りません。それまでに入金するか、引落の予定を確かめてください。</div>}
        {v.overAllocated && <div className="alert">費目の予算の合計が、今月の予算を {yen(-v.reserveBudget)}円 こえています。「設定」の予算を見直してください。</div>}
      </section>

      {v.when !== "past" && (
        <section>
          <h2>使ったものを入れる <small>カードはメールから自動で入ります</small></h2>
          <QuickForm store={store} data={data} today={today} />
        </section>
      )}

      <section>
        <h2>変動費 <small>自由に使えるお金から使う・タップで明細</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>費目</th><th>予算</th><th>使った＋予定</th><th>残り</th>{v.when !== "past" && <th>1日あたり</th>}</tr></thead>
            <tbody>
              {rows.filter((r) => !r.fixed).map((r) => (
                <tr key={r.cat} className="tap" onClick={() => go("ledger", r.cat)}>
                  <td>{r.cat}{r.unclassified > 0 && <> <Chip kind="warn">未分類 {yen(r.unclassified)}</Chip></>}</td>
                  <td className="num">{yen(r.budget)}</td>
                  <td className="num">{yen(r.used)}{r.planned ? <span className="note">＋{yen(r.planned)}</span> : null}</td>
                  <td className={`num ${r.rem < 0 ? "neg" : ""}`}>{signed(r.rem)}</td>
                  {v.when !== "past" && <td className="num"><b>{r.daily == null ? "―" : yen(r.daily)}</b></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>{total(rows.filter((r) => !r.fixed), v.when !== "past")}</tfoot>
          </table>
        </div>
        {v.unclassified.length > 0 && <button className="alert" onClick={() => go("ledger")}>未分類の明細が {v.unclassified.length} 件あります（予備で数えています）。タップして費目を入れてください。</button>}
      </section>

      <section>
        <h2>固定費 <small>見込み {yen(b.fixed)}円 を給与から引いてある</small></h2>
        <div className="panel scroll">
          <table className="tbl">
            <thead><tr><th>費目</th><th>見込み</th><th>引かれた＋予定</th><th>これから</th></tr></thead>
            <tbody>
              {rows.filter((r) => r.fixed).map((r) => (
                <tr key={r.cat} className="tap" onClick={() => go("ledger", r.cat)}>
                  <td>{r.cat}</td>
                  <td className="num">{yen(r.budget)}</td>
                  <td className="num">{yen(r.used)}{r.planned ? <span className="note">＋{yen(r.planned)}</span> : null}</td>
                  <td className={`num ${r.rem < 0 ? "neg" : ""}`}>{r.rem < 0 ? `超過 ${yen(-r.rem)}` : yen(Math.max(0, r.budget - r.used))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>{total(rows.filter((r) => r.fixed), false, true)}</tfoot>
          </table>
        </div>
        {v.fixedOver > 0 && <div className="alert">固定費が見込みを {yen(v.fixedOver)}円 こえたので、その分を自由に使える残りから引いています。</div>}
      </section>

      <NextMonth data={data} month={month} />
      <Debits store={store} data={data} month={month} />

      {v.when !== "past" && (
        <section>
          <h2>口座 <button className="btn ghost sm" onClick={() => go("passbook")}>口座の見通し</button></h2>
          <div className="panel">
            {bal ? (
              <div className="legend" style={{ justifyContent: "space-between" }}>
                <span>いまの残高（{md(bal.date)}に報告・口座＋現金）</span>
                <b className="num">{yen(balanceTotal(bal))}円</b>
              </div>
            ) : <div className="note">残高を入れると、出金の予定に対して口座が足りなくなる日を知らせます。</div>}
            <div className="btns"><button className="btn ghost sm" onClick={() => go("balance")}>今の残高を入れる</button></div>
          </div>
        </section>
      )}
    </>
  );
}
