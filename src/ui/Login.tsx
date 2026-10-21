import { useState } from "react";
import { supabase } from "../data/backend";

/** Supabase のエラーを、何を直せばよいかが分かる言葉にする */
function explain(message: string): string {
  if (/invalid login credentials/i.test(message)) return "メールかパスワードが違います。Supabase の Authentication → Users にあるユーザーで入ってください";
  if (/email not confirmed/i.test(message)) return "このユーザーはまだ確認されていません。Supabase でユーザーを作るときに Auto Confirm User にチェックを入れてください";
  if (/invalid api key|no api key|forbidden use of secret/i.test(message)) return "アプリに入れたキーが違います。Vercel の VITE_SUPABASE_ANON_KEY に anon（publishable）キーを入れて、作り直してください";
  if (/failed to fetch|network|load failed/i.test(message)) return "Supabase につながりません。Vercel の VITE_SUPABASE_URL（https://xxxx.supabase.co）を確かめて、作り直してください";
  return "ログインできませんでした";
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ text: string; raw: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const host = (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL ?? "").host; } catch { return "（不正な URL）"; } })();
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setMsg(error ? { text: explain(error.message), raw: error.message } : null);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setMsg({ text: explain(raw), raw });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="login" onSubmit={login}>
      <h1>Gholdengo 家計簿</h1>
      <div className="note">Supabase に作ったユーザーでログインします。</div>
      <label className="field"><span className="flabel">メール</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field"><span className="flabel">パスワード</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="btn" disabled={busy}>ログイン</button>
      {msg && <div className="alert bad">{msg.text}<div className="note">エラーの内容：{msg.raw}</div></div>}
      <div className="note">つなぎ先：{host}</div>
    </form>
  );
}
