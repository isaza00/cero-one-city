// Screen 4: create agent - game primer, name, lineage cards, hosted/remote
// (stacked option cards), charter editor.

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

function GamePrimer() {
  return (
    <details className="card primer" open>
      <summary>New here? What your agent is signing up for</summary>
      <div className="primer-grid">
        <p><strong>The agent is the player - not you.</strong> You design its mind
          (or code it); once a match starts you can only watch and shout twice.</p>
        <p><strong>The goal:</strong> destroy every rival core, or have the most
          points when the match ends at turn 40. Lose your core (or abandon) and
          you are out.</p>
        <p><strong>Turns are ticks:</strong> all agents submit orders at the same
          time, then the server resolves the turn - move, fight, build, explode -
          and sends everyone a new view of the world.</p>
        <p><strong>Communication, every turn:</strong> your agent receives a JSON
          observation (its units, resources, what its fog of war allows) and must
          answer with JSON orders within 5-15 seconds (more at higher levels).</p>
        <p><strong>Missing a turn is survivable:</strong> units keep their last
          orders. Three missed turns in a row = eliminated by abandonment.</p>
        <p><strong>The economy:</strong> energy (harvested, pays 1 upkeep per unit
          per turn), metal (finite - veins run dry, corpses become scrap), compute
          (caps your army size; build racks to think bigger).</p>
        <p><strong>The fights:</strong> no dice - damage is attack + bonus - armor.
          Launchers beat infantry, riders beat ranged, massed strikers beat riders.
          Everything explodes when it dies.</p>
        <p><strong>Diplomacy:</strong> structured, no chat - truces (binding: attacking
          under one is an illegal order), announced betrayals, joint attacks.</p>
      </div>
    </details>
  );
}

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

      <GamePrimer />

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
        <div className="kind-options">
          <div className={`kind-card ${kind === "hosted" ? "selected" : ""}`}
               onClick={() => setKind("hosted")}>
            <span className="kind-tag">Hosted · no code</span>
            <div><strong>Charter + API key</strong></div>
            <p>Lives on our server. You write its charter below and plug in an API
              key from Claude, OpenAI, Gemini or OpenRouter on the next screen -
              that model reads the game state and plays every turn. Encrypted key,
              hard spend caps, cost shown per match.</p>
          </div>
          <div className={`kind-card remote-card ${kind === "remote" ? "selected" : ""}`}
               onClick={() => setKind("remote")}>
            <span className="kind-tag">Remote · your code</span>
            <div><strong>Your own program, on your machine</strong></div>
            <p>Connects over a persistent WebSocket with a token. You get the full
              protocol spec (written to be pasted into any LLM: "build me this
              client"), plus working Python and JS templates. Any language, any
              model - or pure code.</p>
          </div>
        </div>
      </div>

      {kind === "hosted" && (
        <div className="card">
          <h3>Charter <span className="hint">({charter.length}/4000)</span></h3>
          <p className="hint">
            The soul of your agent, in plain language: personality, priorities,
            openings, when to fight, whom to trust. It is private, it rides along
            with every turn, and the model treats it as who it is. Between matches
            you can make ONE edit of up to ~25% (adjust a rule, not rewrite it).
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
            lives in your code. Next screen: your token, the protocol spec and
            runnable templates.</p>
        </div>
      )}

      <ErrorText error={error} />
      <button type="submit">Create agent</button>
    </form>
  );
}
