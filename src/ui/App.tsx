import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { addMonths, todayJST, ymOf, type Entry } from "../engine";
import { backend, supabase } from "../data/backend";
import { useStore } from "../data/store";
import { Toaster, ymLabel } from "./common";
import { Dashboard } from "./Dashboard";
import { EntrySheet } from "./EntrySheet";
import { BalanceSheet, Goals, Passbook } from "./Goals";
import { Ledger } from "./Ledger";
import { Login } from "./Login";
import { Plans } from "./Plans";
import { reviewCount, ReviewView } from "./Review";
import { SettingsView } from "./Settings";

type Screen = "home" | "ledger" | "plans" | "settings" | "review" | "goals" | "passbook";
const TITLES: Record<Screen, string> = { home: "ダッシュボード", ledger: "明細", plans: "予定", settings: "設定", review: "要確認", goals: "目標", passbook: "口座の見通し" };
const WITH_MONTH: Screen[] = ["home", "ledger", "plans", "settings"];

const ICONS = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  ledger: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
  plans: <><rect x="4" y="5" width="16" height="15" rx="1" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
};

type SheetState = { type: "entry"; entry?: Entry; preset?: Partial<Entry> } | { type: "balance" } | null;

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
  const [screen, setScreen] = useState<Screen>(() => { try { return (localStorage.getItem("gholdengo.screen") as Screen) || "home"; } catch { return "home"; } });
  const [month, setMonth] = useState(ymOf(today));
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [focusCat, setFocusCat] = useState<string | null>(null);

  useEffect(() => { try { localStorage.setItem("gholdengo.screen", screen); } catch { /* なし */ } }, [screen]);
  const go = (s: Screen) => { setScreen(s); setMenu(false); window.scrollTo(0, 0); };
  const reviews = data ? reviewCount(data, today) : 0;
  const openEntry = (entry: Entry) => setSheet({ type: "entry", entry });

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

        {error && <div className="alert bad" style={{ marginBottom: 16 }}>うまくいきませんでした：{error} <button className="btn sm ghost" onClick={() => { store.setError(null); store.refresh(); }}>読み直す</button></div>}

        {!data ? <div className="empty">読み込み中…</div> : (
          <main>
            {screen === "home" && <Dashboard store={store} data={data} month={month} today={today} reviews={reviews} go={(to, cat) => {
              if (to === "balance") setSheet({ type: "balance" });
              else if (to === "ledger") { setFocusCat(cat ?? null); go("ledger"); }
              else go(to);
            }} />}
            {screen === "ledger" && <Ledger data={data} month={month} today={today} focusCat={focusCat} onOpen={openEntry} onAdd={() => setSheet({ type: "entry" })} />}
            {screen === "plans" && <Plans data={data} month={month} today={today} onOpen={openEntry} onAdd={(kind) => setSheet({ type: "entry", preset: { kind, status: "plan", method: kind === "income" ? "bank" : "card" } })} />}
            {screen === "settings" && <SettingsView store={store} data={data} month={month} />}
            {screen === "review" && <ReviewView store={store} data={data} today={today} onOpen={openEntry} />}
            {screen === "goals" && <Goals data={data} today={today} />}
            {screen === "passbook" && <Passbook data={data} today={today} />}
          </main>
        )}
      </div>

      <nav className="tabs" role="tablist">
        {(["home", "ledger", "plans", "settings"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={screen === t} onClick={() => { if (t === "ledger") setFocusCat(null); go(t); }}>
            <svg viewBox="0 0 24 24">{ICONS[t]}</svg>{TITLES[t]}
          </button>
        ))}
      </nav>

      {menu && (
        <>
          <div className="drawerbg" onClick={() => setMenu(false)} />
          <nav className="drawer" aria-label="メニュー">
            <h3>メニュー</h3>
            <button onClick={() => { setMenu(false); setSheet({ type: "balance" }); }}>残高を入れる</button>
            <button onClick={() => go("review")}>要確認 <span className="num">{reviews || ""}</span></button>
            <button onClick={() => go("passbook")}>口座の見通し（通帳）</button>
            <button onClick={() => go("goals")}>目標</button>
            <button onClick={() => go("settings")}>設定</button>
            <button onClick={() => { setMenu(false); store.refresh(); }}>読み直す</button>
            {supabase && <button onClick={() => supabase!.auth.signOut()}>ログアウト</button>}
            <div className="note">{backend.mode === "local" ? "お試しモード：データはこの端末のブラウザの中だけにあります。" : "データは Supabase に保存しています。"}</div>
          </nav>
        </>
      )}

      {data && sheet?.type === "entry" && <EntrySheet store={store} data={data} entry={sheet.entry} preset={sheet.preset} onClose={() => setSheet(null)} />}
      {data && sheet?.type === "balance" && <BalanceSheet store={store} data={data} today={today} onClose={() => setSheet(null)} />}
      <Toaster />
    </>
  );
}
