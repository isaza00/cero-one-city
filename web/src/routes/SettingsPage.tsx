// Screen 13: account settings - profile, password, sessions, notifications.

import { FormEvent, useEffect, useState } from "react";
import { get, patch, post } from "../api/client";
import type { NotificationOut } from "../api/types";
import { ErrorText } from "../components/bits";
import { useAuth } from "../store/auth";

export default function SettingsPage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [sessions, setSessions] = useState<{ id: string; created_at: string }[]>([]);
  const [notifications, setNotifications] = useState<NotificationOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => {
    get<{ sessions: typeof sessions }>("/api/auth/sessions")
      .then((r) => setSessions(r.sessions)).catch(() => undefined);
    get<{ notifications: NotificationOut[] }>("/api/notifications")
      .then((r) => setNotifications(r.notifications)).catch(() => undefined);
  };

  useEffect(reload, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setNotice(null);
    try {
      await patch("/api/auth/me", {
        display_name: displayName || undefined,
        old_password: oldPassword || undefined,
        new_password: newPassword || undefined,
      });
      setNotice("Saved.");
      setOldPassword(""); setNewPassword("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const markAllRead = async () => {
    await post("/api/notifications/read",
               { ids: notifications.filter((n) => !n.read).map((n) => n.id) });
    reload();
  };

  return (
    <div className="row">
      <div className="col">
        <form className="card" onSubmit={save}>
          <h3>Profile</h3>
          <label>Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <label>Current password (only to change it)</label>
          <input type="password" value={oldPassword}
                 onChange={(e) => setOldPassword(e.target.value)} />
          <label>New password</label>
          <input type="password" value={newPassword}
                 onChange={(e) => setNewPassword(e.target.value)} />
          <ErrorText error={error} />
          {notice && <p className="hint">{notice}</p>}
          <button type="submit">Save</button>
        </form>

        <div className="card">
          <h3>Active sessions</h3>
          {sessions.map((s) => (
            <p key={s.id} className="hint">
              {new Date(s.created_at).toLocaleString()}{" "}
              <a href="#" onClick={async (e) => {
                e.preventDefault();
                await post(`/api/auth/sessions/${s.id}/revoke`);
                reload();
              }}>revoke</a>
            </p>
          ))}
        </div>
      </div>

      <div className="col">
        <div className="card">
          <div className="row" style={{ alignItems: "center" }}>
            <h3 className="col">Notifications</h3>
            <button className="secondary" onClick={markAllRead}>Mark all read</button>
          </div>
          {notifications.length === 0 && <p className="hint">Nothing yet.</p>}
          {notifications.map((n) => (
            <div className="card subtle" key={n.id}
                 style={{ opacity: n.read ? 0.55 : 1 }}>
              <strong>{n.type.replace(/_/g, " ")}</strong>{" "}
              <span className="hint">{new Date(n.created_at).toLocaleString()}</span>
              <div className="hint mono">{JSON.stringify(n.payload)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
