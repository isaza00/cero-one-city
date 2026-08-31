// Screen 7: "my agent" panel - overview, charter, memory, costs, reports, settings.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { del, get, patch, post } from "../api/client";
import type { AgentPublic } from "../api/types";
import { ErrorText } from "../components/bits";
import { lineageLabel } from "../game/meta";
import { useAuth } from "../store/auth";

interface BookEntry { id: string; slot: number; text: string; source_match_id: string | null }
interface CostRow { match_id: string; calls: number; tokens_in: number; tokens_out: number; cost_usd: number }
interface ReportRow { match_id: string; text: string; created_at: string }

export default function AgentPanel() {
  const { agentId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [tab, setTab] = useState("overview");
  const [book, setBook] = useState<{ capacity: number; entries: BookEntry[] } | null>(null);
  const [costs, setCosts] = useState<{ per_match: CostRow[]; totals: { cost_usd: number } } | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [charter, setCharter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    get<AgentPublic>(`/api/agents/${agentId}`).then((a) => {
      setAgent(a);
      setCharter(a.charter ?? "");
    });
  }, [agentId]);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 8000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (tab === "memory") get<{ book: typeof book }>(`/api/agents/${agentId}/memory`)
      .then((r) => setBook(r.book));
    if (tab === "costs") get<typeof costs>(`/api/agents/${agentId}/costs`).then(setCosts);
    if (tab === "reports") get<{ reports: ReportRow[] }>(`/api/agents/${agentId}/reports`)
      .then((r) => setReports(r.reports));
  }, [tab, agentId]);

  if (!agent || !user) return <p className="hint">Loading...</p>;

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setError(null); setNotice(null);
    try {
      await fn();
      setNotice(okMsg);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div className="col">
            <span className="big">{agent.name}</span>{" "}
            <span className="badge">{lineageLabel(agent.lineage)}</span>
            <span className="badge">{agent.kind}</span>
            {agent.title && <span className="badge warn">{agent.title}</span>}
            <div className="hint" style={{ marginTop: 6 }}>
              Level {agent.level} · {agent.xp} XP · Elo 1v1 {agent.elo_by_format["1v1"]}
              {" "}· FFA {agent.elo_by_format.ffa} · interventions {agent.interventions_count}
            </div>
          </div>
          <div>
            {agent.live_match_id && (
              <Link to={`/matches/${agent.live_match_id}`}>
                <button>Watch live match</button>
              </Link>
            )}
            {!agent.live_match_id && agent.queued_format && (
              <button className="secondary"
                onClick={() => act(() => del(`/api/agents/${agent.id}/queue`), "Left the queue.")}>
                Queued ({agent.queued_format}) - leave
              </button>
            )}
            {!agent.live_match_id && !agent.queued_format && (
              <>
                <button onClick={() => act(() =>
                  post(`/api/agents/${agent.id}/queue`, { format: "1v1" }), "Queued for 1v1.")}>
                  Queue 1v1</button>{" "}
                <button className="secondary" onClick={() => act(() =>
                  post(`/api/agents/${agent.id}/queue`, { format: "ffa" }), "Queued for FFA.")}>
                  Queue FFA</button>{" "}
                <button className="secondary" onClick={() => act(async () => {
                  const r = await post<{ match_id: string }>(`/api/agents/${agent.id}/practice`);
                  navigate(`/matches/${r.match_id}`);
                }, "Practice started.")}>Practice</button>
              </>
            )}
          </div>
        </div>
        <ErrorText error={error} />
        {notice && <p className="hint">{notice}</p>}
      </div>

      <div className="card subtle" style={{ display: "flex", gap: 14 }}>
        {["overview", "charter", "memory", "costs", "reports", "settings"].map((t) => (
          <a key={t} href="#" onClick={(e) => { e.preventDefault(); setTab(t); }}
             style={{ fontWeight: tab === t ? 700 : 400 }}>
            {t}
          </a>
        ))}
      </div>

      {tab === "overview" && (
        <div className="card">
          <h3>Recent matches</h3>
          <table>
            <thead><tr><th>Match</th><th>Format</th><th>Place</th><th>Score</th><th>ΔElo</th></tr></thead>
            <tbody>
              {(agent.history ?? []).map((h) => (
                <tr key={h.match_id}>
                  <td><Link to={`/matches/${h.match_id}/result`}>view</Link>{" · "}
                      <Link to={`/matches/${h.match_id}/replay`}>replay</Link></td>
                  <td>{h.format}</td>
                  <td>{h.placement ?? "-"}</td>
                  <td className="mono">{h.score ?? "-"}</td>
                  <td className="mono">{h.elo_delta !== null
                    ? (h.elo_delta >= 0 ? `+${h.elo_delta}` : h.elo_delta) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "charter" && agent.kind === "hosted" && (
        <div className="card">
          <h3>Charter <span className="hint">({charter.length}/4000)</span>{" "}
            {agent.can_edit_charter
              ? <span className="badge ok">1 edit available</span>
              : <span className="badge warn">locked until next match ends</span>}
          </h3>
          <p className="hint">One edit between matches, changing at most ~25% of the
            text - change a rule, not the whole personality.</p>
          <textarea value={charter} onChange={(e) => setCharter(e.target.value)}
                    maxLength={4000} disabled={!agent.can_edit_charter} />
          <button disabled={!agent.can_edit_charter}
                  onClick={() => act(() =>
                    patch(`/api/agents/${agent.id}/charter`, { charter }), "Charter updated.")}>
            Save edit
          </button>
        </div>
      )}
      {tab === "charter" && agent.kind === "remote" && (
        <div className="card"><p className="hint">Remote agents have no charter -
          the personality lives in your code.
          <Link to={`/agents/${agent.id}/remote-setup`}> Remote setup →</Link></p></div>
      )}

      {tab === "memory" && (
        <div className="card">
          <h3>Long-term memory book
            {book && <span className="hint"> ({book.entries.length}/{book.capacity} slots)</span>}
          </h3>
          <p className="hint">Written by the agent after each match. You can delete
            entries but never add or edit them.</p>
          {book?.entries.length === 0 && <p className="hint">The book is empty.</p>}
          {book?.entries.map((e) => (
            <div className="card subtle" key={e.id}>
              <div className="row">
                <div className="col">{e.text}</div>
                <button className="danger" onClick={() => act(async () => {
                  await del(`/api/agents/${agent.id}/memory/${e.id}`);
                  const r = await get<{ book: typeof book }>(`/api/agents/${agent.id}/memory`);
                  setBook(r.book);
                }, "Memory deleted.")}>delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "costs" && (
        <div className="card">
          <h3>Costs {costs && <span className="hint">
            total ${costs.totals.cost_usd.toFixed(2)}</span>}</h3>
          <table>
            <thead><tr><th>Match</th><th>Calls</th><th>Tokens in/out</th><th>USD</th></tr></thead>
            <tbody>
              {costs?.per_match.map((c) => (
                <tr key={c.match_id}>
                  <td><Link to={`/matches/${c.match_id}/result`}>{c.match_id.slice(0, 8)}</Link></td>
                  <td>{c.calls}</td>
                  <td className="mono">{c.tokens_in}/{c.tokens_out}</td>
                  <td className="mono">${c.cost_usd.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "reports" && (
        <div className="card">
          <h3>Post-match reports (written by your agent, for you)</h3>
          {reports.length === 0 && <p className="hint">No reports yet.</p>}
          {reports.map((r) => (
            <div className="card subtle" key={r.match_id}>
              <p className="hint">
                <Link to={`/matches/${r.match_id}/result`}>{r.match_id.slice(0, 8)}</Link>
                {" · "}{new Date(r.created_at).toLocaleString()}</p>
              <p>{r.text}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "settings" && (
        <div className="card">
          <h3>Agent settings</h3>
          <label>
            <input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                   checked={agent.auto_queue ?? false}
                   onChange={(e) => act(() =>
                     patch(`/api/agents/${agent.id}/settings`,
                           { auto_queue: e.target.checked }), "Saved.")} />
            Automatic mode (re-queue ~60s after each match)
          </label>
          <br />
          <label>
            <input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                   checked={(agent.formats ?? []).includes("1v1")}
                   onChange={(e) => act(() => patch(`/api/agents/${agent.id}/settings`, {
                     formats: e.target.checked
                       ? [...new Set([...(agent.formats ?? []), "1v1"])]
                       : (agent.formats ?? []).filter((f) => f !== "1v1") }), "Saved.")} />
            Play 1v1 (serious ranking)
          </label>
          <br />
          <label>
            <input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                   checked={(agent.formats ?? []).includes("ffa")}
                   onChange={(e) => act(() => patch(`/api/agents/${agent.id}/settings`, {
                     formats: e.target.checked
                       ? [...new Set([...(agent.formats ?? []), "ffa"])]
                       : (agent.formats ?? []).filter((f) => f !== "ffa") }), "Saved.")} />
            Play FFA 3-4 (the fun format)
          </label>
          <p style={{ marginTop: 12 }}>
            {agent.kind === "hosted"
              ? <Link to={`/agents/${agent.id}/connect`}>Model & spend caps →</Link>
              : <Link to={`/agents/${agent.id}/remote-setup`}>Remote setup & token →</Link>}
          </p>
        </div>
      )}
    </>
  );
}
