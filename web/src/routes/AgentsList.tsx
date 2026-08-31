// My agents index.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api/client";
import type { AgentPublic } from "../api/types";
import { lineageLabel } from "../game/meta";

export default function AgentsList() {
  const [agents, setAgents] = useState<AgentPublic[]>([]);

  useEffect(() => {
    get<{ agents: AgentPublic[] }>("/api/agents").then((r) => setAgents(r.agents));
  }, []);

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <h2 className="col">My agents</h2>
        <Link to="/agents/new"><button>New agent</button></Link>
      </div>
      {agents.length === 0 && (
        <div className="card">
          <p>No agents yet.</p>
          <Link to="/onboarding"><button>Start onboarding</button></Link>
        </div>
      )}
      <div className="row">
        {agents.map((a) => (
          <div className="card col" key={a.id}>
            <h3><Link to={`/agents/${a.id}`}>{a.name}</Link></h3>
            <p>
              <span className="badge">{lineageLabel(a.lineage)}</span>
              <span className="badge">{a.kind}</span>
              <span className="badge">lvl {a.level}</span>
              {a.title && <span className="badge warn">{a.title}</span>}
            </p>
            <p className="hint">
              Elo {a.elo_by_format["1v1"]} (1v1) · {a.elo_by_format.ffa} (ffa)
            </p>
            <p>
              {a.live_match_id && <span className="badge ok">playing</span>}
              {a.queued_format && <span className="badge">queued {a.queued_format}</span>}
              {!a.live_match_id && !a.queued_format && <span className="badge">idle</span>}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
