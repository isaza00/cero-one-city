// Screens 2: register / login.

import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { post } from "../api/client";
import type { User } from "../api/types";
import { ErrorText } from "../components/bits";
import { useAuth } from "../store/auth";

interface Tokens { user: User; access_token: string; refresh_token: string }

export function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setTokens = useAuth((s) => s.setTokens);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const t = await post<Tokens>("/api/auth/register",
        { email, password, display_name: displayName });
      setTokens(t.access_token, t.refresh_token, t.user);
      navigate("/onboarding");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h2>Sign up</h2>
      <form onSubmit={submit}>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Display name</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
               minLength={2} required />
        <label>Password (8+ characters)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
               minLength={8} required />
        <ErrorText error={error} />
        <button type="submit">Create account</button>
      </form>
      <p className="hint">Already have one? <Link to="/login">Log in</Link></p>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setTokens = useAuth((s) => s.setTokens);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const t = await post<Tokens>("/api/auth/login", { email, password });
      setTokens(t.access_token, t.refresh_token, t.user);
      navigate("/agents");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h2>Log in</h2>
      <form onSubmit={submit}>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <ErrorText error={error} />
        <button type="submit">Log in</button>
      </form>
      <p className="hint">New here? <Link to="/register">Sign up</Link></p>
    </div>
  );
}
