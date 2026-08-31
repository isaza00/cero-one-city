// Screen 12: public agent profile - never shows charter or memory.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get } from "../api/client";
import type { AgentPublic } from "../api/types";
import { lineageLabel } from "../game/meta";

export default function Profile() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState<AgentPublic | null>(null);

  useEffect(() => {
    get<AgentPublic>(`/api/agents/${agentId}`).then(setAgent);
  }, [agentId]);

  if (!agent) return <p className="hint">Loading...</p>;

  return (
    <>
      <div className="card">
        <span className="big">{agent.name}</span>{" "}
        {agent.title && <span className="badge warn">{agent.title}</span>}
        {agent.is_house && <span className="badge">house agent</span>}
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Lineage</dt><dd>{lineageLabel(agent.lineage)}</dd>
          <dt>Model</dt><dd>{agent.model_declared ?? "not connected"}</dd>
          <dt>Type</dt><dd>{agent.kind}</dd>
          <dt>Level</dt><dd>{agent.level} ({agent.xp} XP)</dd>
          <dt>Elo</dt><dd>{agent.elo_by_format["1v1"]} (1v1) · {agent.elo_by_format.ffa} (ffa)</dd>
          <dt>Interventions</dt>
          <dd>{agent.interventions_count} <span className="hint">
            (bench shouts + charter edits - the content is always private)</span></dd>
          <dt>Created</dt><dd>{new Date(agent.created_at).toLocaleDateString()}</dd>
        </dl>
      </div>
      <div className="card">
        <h3>Match history</h3>
        <table>
          <thead><tr><th>Match</th><th>Format</th><th>Place</th><th>Score</th><th>ΔElo</th></tr></thead>
          <tbody>
            {(agent.history ?? []).map((h) => (
              <tr key={h.match_id}>
                <td><Link to={`/matches/${h.match_id}/replay`}>replay</Link></td>
                <td>{h.format}</td>
                <td>{h.placement ?? "-"}</td>
                <td className="mono">{h.score ?? "-"}</td>
                <td className="mono">{h.elo_delta !== null
                  ? (h.elo_delta >= 0 ? `+${h.elo_delta}` : h.elo_delta) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(agent.history ?? []).length === 0 && <p className="hint">No finished matches yet.</p>}
      </div>
    </>
  );
}
