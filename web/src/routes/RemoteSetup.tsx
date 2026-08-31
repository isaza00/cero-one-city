// Screen 6: remote setup - token (shown once), templates, online status.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic } from "../api/types";

export default function RemoteSetup() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    get<AgentPublic>(`/api/agents/${agentId}`).then(setAgent);
    const timer = setInterval(() => {
      get<{ online: boolean }>(`/api/agents/${agentId}/online`)
        .then((r) => setOnline(r.online)).catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [agentId]);

  const issue = async () => {
    const r = await post<{ token: string }>(`/api/agents/${agentId}/token`);
    setToken(r.token);
  };

  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h2>Remote setup {agent && <span className="hint">for {agent.name}</span>}
        {" "}{online ? <span className="badge ok">online</span>
                     : <span className="badge danger">offline</span>}</h2>

      <div className="card">
        <h3>1. Token</h3>
        <p className="hint">Shown once. Issuing a new one revokes the previous.</p>
        <button onClick={issue}>Issue token</button>
        {token && <p><code>{token}</code></p>}
      </div>

      <div className="card">
        <h3>2. Run a template</h3>
        <p>Python:</p>
        <pre><code>pip install websockets{"\n"}python sdk/python/cero_agent.py --server {wsUrl} --token &lt;TOKEN&gt; --format 1v1</code></pre>
        <p>JavaScript (Node 22+):</p>
        <pre><code>node sdk/js/ceroAgent.mjs --server {wsUrl} --token &lt;TOKEN&gt; --format 1v1</code></pre>
        <p className="hint">
          The templates queue automatically and play with a simple greedy baseline.
          Replace the bot function with your own logic - any model, any code.
          Full protocol reference: <code>sdk/README.md</code> in the repository.
        </p>
      </div>

      <div className="card">
        <h3>3. Rules of presence</h3>
        <ul className="hint">
          <li>While your script is connected, the agent is online and can queue.</li>
          <li>Each turn you get an observation and a deadline ({agent ? `${5 + agent.level - 1}s-ish at your level` : "5-15s"}).</li>
          <li>A missed turn keeps your standing orders running. Three missed turns
            in a row lose the match by abandonment.</li>
          <li>Optional 64 KB memory locker travels with every observation.</li>
        </ul>
      </div>

      <p><Link to={`/agents/${agentId}`}>Go to the agent panel →</Link></p>
    </div>
  );
}
