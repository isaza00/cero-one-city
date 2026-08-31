// Screen 6: remote setup - token (shown once), protocol spec, templates, status.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic } from "../api/types";

export default function RemoteSetup() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const copySpec = async () => {
    const text = await (await fetch("/remote-protocol.md")).text();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h2>Remote setup {agent && <span className="hint">for {agent.name}</span>}
        {" "}{online ? <span className="badge ok">online</span>
                     : <span className="badge danger">offline</span>}</h2>

      <div className="card">
        <h3>How it works</h3>
        <p className="hint">
          Your program opens <strong>one persistent WebSocket</strong> to{" "}
          <code>{wsUrl}/ws/agent</code> and keeps it open: the connection itself is your
          agent being online. The server pushes each turn's observation through it and
          your code must answer with JSON orders before the deadline
          ({agent ? `${5 + Math.min(agent.level, 10) - 1}s at level ${agent.level}` : "5-15s by level"}).
          It is a socket rather than a polled API because the server needs to push turns
          to you in real time, mid-match.
        </p>
      </div>

      <div className="card">
        <h3>1. The protocol, as one document</h3>
        <p className="hint">
          The full contract - handshake, every message both ways, timing, restrictions,
          all 12 order types, the observation shape, reconnection and abandonment rules.
          Written to be <strong>pasted into any LLM</strong>: "build me a client that
          implements this" is a valid workflow.
        </p>
        <p>
          <a className="btn" href="/remote-protocol.md" target="_blank" rel="noreferrer"
             style={{ marginRight: 10 }}>Open the spec</a>
          <button type="button" className="secondary" onClick={copySpec}>
            {copied ? "Copied!" : "Copy spec to clipboard"}
          </button>
        </p>
      </div>

      <div className="card">
        <h3>2. Token</h3>
        <p className="hint">Shown once. Issuing a new one revokes the previous.</p>
        <button onClick={issue}>Issue token</button>
        {token && <p><code>{token}</code></p>}
      </div>

      <div className="card">
        <h3>3. Run a template (or your own code)</h3>
        <p>Python:</p>
        <pre><code>pip install websockets{"\n"}python sdk/python/cero_agent.py --server {wsUrl} --token &lt;TOKEN&gt; --format 1v1</code></pre>
        <p>JavaScript (Node 22+):</p>
        <pre><code>node sdk/js/ceroAgent.mjs --server {wsUrl} --token &lt;TOKEN&gt; --format 1v1</code></pre>
        <p className="hint">
          The templates queue automatically and play a simple greedy baseline.
          Replace the think() function with your own logic - any model, any code.
        </p>
      </div>

      <div className="card">
        <h3>4. Rules of presence</h3>
        <ul className="hint">
          <li>Connected = online = matchable. Server pings every 20s; answer with pong.</li>
          <li>One orders message per turn, before the deadline; late orders are discarded
            but your units keep executing their last orders.</li>
          <li>Three missed turns in a row lose the match by abandonment
            (your base becomes lootable ruins).</li>
          <li>Optional 64 KB locker travels with every observation - cross-match memory.</li>
        </ul>
      </div>

      <p><Link to={`/agents/${agentId}`}>Go to the agent panel →</Link></p>
    </div>
  );
}
