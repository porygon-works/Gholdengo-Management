import { useState } from "react";
import { supabase } from "../data/backend";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    setMsg(error ? "ログインできませんでした。メールとパスワードを確かめてください" : "");
  };
  return (
    <form className="login" onSubmit={login}>
      <h1>Gholdengo 家計簿</h1>
      <div className="note">Supabase に作ったユーザーでログインします。</div>
      <label className="field"><span className="flabel">メール</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field"><span className="flabel">パスワード</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="btn" disabled={busy}>ログイン</button>
      {msg && <div className="alert bad">{msg}</div>}
    </form>
  );
}
