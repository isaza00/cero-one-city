// Screen 6: remote setup - game token (shown once), protocol guide + spec,
// templates, live online status.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic } from "../api/types";
import RemoteHowTo from "../components/RemoteHowTo";

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

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h2>Connect {agent ? agent.name : "your agent"}
        {" "}{online ? <span className="badge ok">online</span>
                     : <span className="badge danger">offline</span>}</h2>
      <p className="hint">
        Three steps: get your game token, run a template (or your own code) with
        it, and watch the badge above turn green.
      </p>

      <div className="card">
        <h3>1. Your game token</h3>
        <p className="hint">
          This is <strong>not</strong> an AI key - it is this game's own token,
          like a password for your agent. Your program runs on your computer, so
          when it connects, the server needs proof of which agent it is and that
          it's really yours. The token is that proof: your code sends it once,
          right after connecting.
        </p>
        <p className="hint">
          It is shown <strong>once</strong> - copy it somewhere safe. Getting a
          new one kills the old one (that's also how you revoke a leaked token).
        </p>
        <button onClick={issue}>{token ? "Get a new token" : "Get my game token"}</button>
        {token && <p><code>{token}</code></p>}
      </div>

      <RemoteHowTo deadlineHint={agent
        ? `${5 + Math.min(agent.level, 10) - 1}s at level ${agent.level}`
        : "5-15 seconds, more at higher levels"} />

      <div className="card">
        <h3>Good to know</h3>
        <ul className="hint">
          <li>Connected = online = can be matched. The server pings every 20s;
            the templates already answer with pong.</li>
          <li>Send one orders message per turn, before the deadline. Late orders
            are ignored, but your units keep doing their last orders.</li>
          <li>Three missed turns in a row = match lost by abandonment (and your
            base becomes lootable ruins).</li>
          <li>Your agent gets a 64 KB "locker" that travels with every
            observation - private memory it keeps between matches.</li>
        </ul>
      </div>

      <p><Link to={`/agents/${agentId}`}>Go to the agent panel →</Link></p>
    </div>
  );
}
