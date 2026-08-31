// Screen 4: create agent - name, lineage cards, hosted/remote, charter editor.

import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { post } from "../api/client";
import type { AgentPublic } from "../api/types";
import { ErrorText } from "../components/bits";
import { LINEAGES } from "../game/meta";

const CHARTER_EXAMPLES = [
  "Be cautious. Do not attack before you have ten units. Prioritize metal over energy. Never trust a truce.",
  "Rush. Strikers as early as possible, hit their workers, never stop attacking.",
  "Play the long game: tech to firmware v3, keep truces while teching, then break everything with walking towers.",
];

export default function CreateAgent() {
  const [name, setName] = useState("");
  const [lineage, setLineage] = useState("forge");
  const [kind, setKind] = useState<"hosted" | "remote">("hosted");
  const [charter, setCharter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await post<{ agent: AgentPublic }>("/api/agents", {
        name, lineage, kind, charter: kind === "hosted" ? charter : undefined,
      });
      navigate(kind === "hosted"
        ? `/agents/${r.agent.id}/connect`
        : `/agents/${r.agent.id}/remote-setup`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} style={{ maxWidth: 860, margin: "0 auto" }}>
      <h2>Create your agent</h2>

      <div className="card">
        <label>Name (public, unique)</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
               minLength={2} maxLength={40} required placeholder="rustbucket-9000" />
      </div>

      <div className="card">
        <h3>Lineage</h3>
        <div className="lineage-grid">
          {Object.entries(LINEAGES).map(([id, l]) => (
            <div key={id}
                 className={`card lineage-card ${lineage === id ? "selected" : ""}`}
                 onClick={() => setLineage(id)}>
              <strong>{l.label}</strong>
              <p className="hint">{l.blurb}</p>
              <p className="hint">Weakness: {l.weakness}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>How does it connect?</h3>
        <label>
          <input type="radio" checked={kind === "hosted"} onChange={() => setKind("hosted")}
                 style={{ width: "auto", marginRight: 8 }} />
          Hosted - lives on our server, you plug in your API key (no code)
        </label>
        <label>
          <input type="radio" checked={kind === "remote"} onChange={() => setKind("remote")}
                 style={{ width: "auto", marginRight: 8 }} />
          Remote - runs on your machine over WebSocket (you write the code)
        </label>
      </div>

      {kind === "hosted" && (
        <div className="card">
          <h3>Charter <span className="hint">({charter.length}/4000)</span></h3>
          <p className="hint">
            Its personality, priorities and strategy - private, in plain language.
            Between matches you can make ONE edit of up to ~25% (change a rule,
            not rewrite it).
          </p>
          <textarea value={charter} onChange={(e) => setCharter(e.target.value)}
                    maxLength={4000} required
                    placeholder="Be cautious. Prioritize metal over energy..." />
          <a href="#" onClick={(e) => { e.preventDefault(); setShowExamples(!showExamples); }}>
            {showExamples ? "Hide examples" : "Show examples"}
          </a>
          {showExamples && CHARTER_EXAMPLES.map((ex, i) => (
            <p key={i} className="hint" style={{ cursor: "pointer" }}
               onClick={() => setCharter(ex)}>· {ex}</p>
          ))}
        </div>
      )}
      {kind === "remote" && (
        <div className="card">
          <p className="hint">Remote agents have no charter - their personality
            lives in your code. You will get a token and templates next.</p>
        </div>
      )}

      <ErrorText error={error} />
      <button type="submit">Create agent</button>
    </form>
  );
}
