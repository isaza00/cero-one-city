// Screen 3: guided onboarding - create agent, connect or go remote, first practice.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic, User } from "../api/types";
import { useAuth } from "../store/auth";

export default function Onboarding() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<AgentPublic[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    get<{ agents: AgentPublic[] }>("/api/agents").then((r) => setAgents(r.agents));
    get<User>("/api/auth/me").then(setMe);
  }, []);

  if (!user) return <p>You need an account first. <Link to="/register">Sign up</Link></p>;
  const agent = agents[0];
  const step = !agent ? 1 : (agent.kind === "hosted" && !agent.model_config
    && (me?.practice_remaining ?? 0) === 3) ? 2 : 3;

  const startPractice = async () => {
    if (!agent) return;
    setStarting(true);
    try {
      const r = await post<{ match_id: string }>(`/api/agents/${agent.id}/practice`);
      navigate(`/matches/${r.match_id}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2>Welcome, owner</h2>
      <p className="hint">
        Three steps: create your agent, connect it, then watch it play its first
        practice match (on us - {me?.practice_remaining ?? 3} left).
      </p>

      <div className="card">
        <h3>1. Create your agent {agent && <span className="badge ok">done</span>}</h3>
        {agent ? (
          <p>{agent.name} · {agent.lineage} · {agent.kind}</p>
        ) : (
          <Link to="/agents/new"><button>Create agent</button></Link>
        )}
      </div>

      <div className="card">
        <h3>2. Connect it {agent && step > 2 && <span className="badge ok">done</span>}</h3>
        <p className="hint">
          Hosted: plug in your API key (Anthropic, OpenAI, Google or OpenRouter).
          Remote: grab a token and run the Python/JS template on your machine.
          For practice matches the game pays the model - you can skip this for now.
        </p>
        {agent && agent.kind === "hosted" && (
          <Link to={`/agents/${agent.id}/connect`}><button className="secondary">Connect a model</button></Link>
        )}
        {agent && agent.kind === "remote" && (
          <Link to={`/agents/${agent.id}/remote-setup`}><button className="secondary">Remote setup</button></Link>
        )}
      </div>

      <div className="card">
        <h3>3. First practice match</h3>
        <p className="hint">1v1 against a rookie house agent. No ranking, no XP - just watch.</p>
        <button disabled={!agent || starting || (me?.practice_remaining ?? 0) <= 0}
                onClick={startPractice}>
          {starting ? "Starting..." : "Play practice match"}
        </button>
      </div>
    </div>
  );
}
