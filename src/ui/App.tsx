import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { addMonths, todayJST, ymOf } from "../engine";
import { backend, supabase } from "../data/backend";
import { useStore } from "../data/store";
import { Toaster, ymLabel } from "./common";
import { Home5 } from "./Home5";
import { Outlook5 } from "./Outlook5";
import { Plans5 } from "./Plans5";
import { PartSheet } from "./Parts";
import type { Part, PartRow } from "../engine";
import { AccountSheet, CardSheet, NewSheet, type Open } from "./Sheets";
import { BalanceSheet } from "./Balance";
import { Ledger5 } from "./Ledger5";
import { Login } from "./Login";
import { PlansView } from "./PlansView";
import { VERSION_LABEL } from "./version";
import { reviewCount, ReviewView } from "./Review";
import { SettingsView } from "./Settings";

type Screen = "home" | "ledger" | "flow" | "plans" | "settings" | "review";
const TITLES: Record<Screen, string> = { home: "ホーム", ledger: "明細", flow: "見通し", plans: "計画", settings: "設定", review: "要確認" };
const TAB_LABEL: Record<string, string> = { home: "ホーム", ledger: "明細", flow: "見通し", plans: "計画", settings: "設定" };
const SCREENS: Screen[] = ["home", "ledger", "flow", "plans", "settings", "review"];
const WITH_MONTH: Screen[] = ["ledger", "settings"];

const ICONS = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  ledger: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
  flow: <path d="M3 19h18M4 15l5-5 4 3 7-7" />,
  plans: <><path d="M4 6h16M4 12h10M4 18h6" /><circle cx="18" cy="16" r="3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
};

type SheetState = Open | { type: "balance" } | null;

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (supabase && session === undefined) return <div className="empty">読み込み中…</div>;
  if (supabase && !session) return <><Login /><Toaster /></>;
  return <Main />;
}

function Main() {
  const store = useStore();
  const { data, error, loading } = store;
  const today = todayJST();
  const [screen, setScreen] = useState<Screen>(() => { try { const v = localStorage.getItem("gholdengo.screen") as Screen; return SCREENS.includes(v) ? v : "home"; } catch { return "home"; } });
  const [planId, setPlanId] = useState<string | null>(null);
  const [month, setMonth] = useState(ymOf(today));
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [focusCat, setFocusCat] = useState<string | null>(null);
  const [part, setPart] = useState<Part | null>(null);

  useEffect(() => { try { localStorage.setItem("gholdengo.screen", screen); } catch { /* なし */ } }, [screen]);
  const go = (s: Screen) => { setScreen(s); setMenu(false); window.scrollTo(0, 0); };
  const reviews = data ? reviewCount(data, today) : 0;
  const openPlan = (id: string) => { setPlanId(id); go("plans"); };
  // 計画の取引は、明細から開いても計画の中身で直す（額や確定は計画で決めるため）
  const openEntry = (o: Open) => {
    const pid = o.type === "account" ? o.entry?.plan_id : null;
    if (pid && data?.plans.some((p) => p.id === pid)) openPlan(pid);
    else setSheet(o);
  };
  /** 内訳の行から明細を開く */
  const openPartRow = (r: PartRow) => {
    if (!data) return;
    const e = r.ref.kind === "card" ? data.cards.find((x) => x.id === r.ref.id) : r.ref.kind === "account" ? data.accounts.find((x) => x.id === r.ref.id) : undefined;
    if (!e) return;
    setPart(null);
    setSheet(r.ref.kind === "card" ? { type: "card", entry: e as never } : { type: "account", entry: e as never });
  };

  const sub = loading && !data ? "読み込み中…" : error ? "保存か読み込みに失敗しました" : backend.mode === "local" ? "お試しモード（この端末だけに保存）" : `今日 ${+today.slice(5, 7)}/${+today.slice(8)}`;

  return (
    <>
      <div className="wrap">
        <header className="top">
          <div className="ttl"><h1>{TITLES[screen]}</h1><div className="sub">{sub}</div></div>
          {WITH_MONTH.includes(screen) && (
            <div className="monthnav">
              <button className="iconbtn" aria-label="前の月" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
              <span className="num" onClick={() => setMonth(ymOf(today))}>{ymLabel(month)}</span>
              <button className="iconbtn" aria-label="次の月" onClick={() => setMonth(addMonths(month, 1))}>›</button>
            </div>
          )}
          <button className="iconbtn" aria-label="メニュー" onClick={() => setMenu(true)}>
            <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            {reviews > 0 && <span className="dot">{reviews}</span>}
          </button>
        </header>

        {error && <div className="alert bad" style={{ marginBottom: 16 }}>うまくいきませんでした：{error} <button className="btn sm ghost" onClick={() => { store.setError(null); store.refresh(); }}>再読込</button></div>}

        {!data ? <div className="empty">読み込み中…</div> : (
          <main>
            {screen === "home" && <Home5 store={store} data={data} today={today} reviews={reviews} openPart={setPart} onOpen={openEntry} go={(to, cat) => {
              if (to === "ledger") { setFocusCat(cat ?? null); setMonth(ymOf(today)); go("ledger"); }
              else go(to === "outlook" ? "flow" : to);
            }} />}
            {screen === "ledger" && <Ledger5 data={data} month={month} today={today} focusCat={focusCat} onOpen={openEntry} onAdd={() => setSheet({ type: "new" })} />}
            {screen === "flow" && <Outlook5 data={data} today={today} onOpen={openEntry} />}
            {screen === "plans" && <>
              <Plans5 store={store} data={data} today={today} openPart={setPart} />
              <details className="panel"><summary>v4 の計画（切り替えまで、比べるために残す）</summary><PlansView store={store} data={data} today={today} openId={planId} setOpenId={setPlanId} /></details>
            </>}
            {screen === "settings" && <SettingsView store={store} data={data} month={month} onOpen={openEntry} />}
            {screen === "review" && <ReviewView store={store} data={data} today={today} onOpen={openEntry} />}
          </main>
        )}
      </div>

      <nav className="tabs" role="tablist">
        {(["home", "ledger", "flow", "plans", "settings"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={screen === t} onClick={() => { if (t === "ledger") setFocusCat(null); if (t === "plans") setPlanId(null); go(t); }}>
            <svg viewBox="0 0 24 24">{ICONS[t]}</svg>{TAB_LABEL[t]}
          </button>
        ))}
      </nav>

      {menu && (
        <>
          <div className="drawerbg" onClick={() => setMenu(false)} />
          <nav className="drawer" aria-label="メニュー">
            <h3>メニュー</h3>
            <button onClick={() => { setMenu(false); setSheet({ type: "balance" }); }}>口座残高</button>
            <button onClick={() => go("review")}>要確認 <span className="num">{reviews || ""}</span></button>
            <button onClick={() => go("flow")}>見通し</button>
            <button onClick={() => go("plans")}>計画</button>
            <button onClick={() => go("settings")}>設定</button>
            <button onClick={() => { setMenu(false); store.refresh(); }}>再読込</button>
            {supabase && <button onClick={() => supabase!.auth.signOut()}>ログアウト</button>}
            <div className="note">{backend.mode === "local" ? "お試しモード：データはこの端末のブラウザの中だけにあります。" : "データは Supabase に保存しています。"}</div>
            <div className="note">{VERSION_LABEL}</div>
          </nav>
        </>
      )}

      {data && sheet?.type === "new" && <NewSheet store={store} data={data} plan={sheet.plan} onClose={() => setSheet(null)} />}
      {data && sheet?.type === "card" && <CardSheet store={store} data={data} entry={sheet.entry} preset={sheet.preset} onClose={() => setSheet(null)} />}
      {data && sheet?.type === "account" && <AccountSheet store={store} data={data} entry={sheet.entry} preset={sheet.preset} onClose={() => setSheet(null)} />}
      {data && sheet?.type === "balance" && <BalanceSheet store={store} data={data} today={today} onClose={() => setSheet(null)} />}
      {part && <PartSheet part={part} onClose={() => setPart(null)} onRow={openPartRow} />}
      <Toaster />
    </>
  );
}
