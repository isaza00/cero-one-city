// Screen 4: create agent - game primer, name, lineage cards, hosted/remote
// (stacked option cards). Everything needed for the chosen option lives on
// THIS page: hosted shows personality + API key, remote shows the protocol
// guide. No surprises on a "next screen".

import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { get, post, put } from "../api/client";
import type { AgentPublic } from "../api/types";
import ApiKeyHelp from "../components/ApiKeyHelp";
import { ErrorText } from "../components/bits";
import GamePrimer from "../components/GamePrimer";
import RemoteHowTo from "../components/RemoteHowTo";
import { LINEAGES } from "../game/meta";

const PERSONALITY_EXAMPLES = [
  "Be cautious. Do not attack before you have ten units. Prioritize metal over energy. Never trust a truce.",
  "Rush. Strikers as early as possible, hit their workers, never stop attacking.",
  "Play the long game: tech to firmware v3, keep truces while teching, then break everything with walking towers.",
];

interface ModelRow { provider: string; model: string; input_usd_per_mtok: number; output_usd_per_mtok: number }

export default function CreateAgent() {
  const [name, setName] = useState("");
  const [lineage, setLineage] = useState("forge");
  const [kind, setKind] = useState<"hosted" | "remote">("hosted");
  const [personality, setPersonality] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [busy, setBusy] = useState(false);
  // The agent id once created - so a failed key test never re-creates the agent.
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Hosted-only: the brain (API key) config, on this same page.
  const [models, setModels] = useState<ModelRow[]>([]);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-haiku-4-5");
  const [apiKey, setApiKey] = useState("");
  const [matchCap, setMatchCap] = useState(100);
  const [dayCap, setDayCap] = useState(500);
  const navigate = useNavigate();

  useEffect(() => {
    get<{ models: ModelRow[] }>("/api/models")
      .then((r) => setModels(r.models)).catch(() => undefined);
  }, []);

  const providerModels = models.filter((m) => m.provider === provider);
  const pickProvider = (p: string) => {
    setProvider(p);
    const first = models.find((m) => m.provider === p);
    if (first) setModel(first.model);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let agentId = createdId;
      if (!agentId) {
        const r = await post<{ agent: AgentPublic }>("/api/agents", {
          name, lineage, kind,
          charter: kind === "hosted" ? personality : undefined,
        });
        agentId = r.agent.id;
        setCreatedId(agentId);
      }
      if (kind === "remote") {
        navigate(`/agents/${agentId}/remote-setup`);
        return;
      }
      if (apiKey.trim() || provider === "mock") {
        await put(`/api/agents/${agentId}/model`, {
          provider, model, api_key: apiKey.trim() || undefined,
          per_match_cap_usd_cents: matchCap, per_day_cap_usd_cents: dayCap,
        });
      }
      navigate(`/agents/${agentId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
        <p className="hint">Its robot family. Each one is good at something and
          bad at something - pick the style you like.</p>
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
        <h3>Who is its brain?</h3>
        <div className="kind-options">
          <div className={`kind-card ${kind === "hosted" ? "selected" : ""}`}
               onClick={() => setKind("hosted")}>
            <span className="kind-tag">Option 1 · no code</span>
            <div><strong>An AI model plays for it</strong></div>
            <p>The easy way. Below, you write its personality in plain words and
              paste an API key (Claude, OpenAI, Gemini or OpenRouter). That model
              reads the game each turn and decides. The key is encrypted, spending
              has hard caps, and every match shows what it cost.</p>
          </div>
          <div className={`kind-card remote-card ${kind === "remote" ? "selected" : ""}`}
               onClick={() => setKind("remote")}>
            <span className="kind-tag">Option 2 · your own AI agent</span>
            <div><strong>A program you run plays for it</strong></div>
            <p>The builder's way. You run your own agent on your computer and it
              connects to the game through a WebSocket. Below: how it works, the
              full protocol, and templates that already play - just replace their
              brain with yours.</p>
          </div>
        </div>
      </div>

      {kind === "hosted" && (
        <>
          <div className="card">
            <h3>Its personality <span className="hint">({personality.length}/4000)</span></h3>
            <p className="hint">
              Who is your agent? Write it like you'd explain the plan to a friend:
              how it should play, what to build first, when to fight, whom to
              trust. It stays private, the model reads it every single turn, and
              it treats it as who it is. Between matches you can make ONE small
              edit (tweak a rule, not rewrite the soul).
            </p>
            <textarea value={personality} onChange={(e) => setPersonality(e.target.value)}
                      maxLength={4000} required
                      placeholder="Be cautious. Prioritize metal over energy..." />
            <a href="#" onClick={(e) => { e.preventDefault(); setShowExamples(!showExamples); }}>
              {showExamples ? "Hide examples" : "Show examples"}
            </a>
            {showExamples && PERSONALITY_EXAMPLES.map((ex, i) => (
              <p key={i} className="hint" style={{ cursor: "pointer" }}
                 onClick={() => setPersonality(ex)}>· {ex}</p>
            ))}
          </div>

          <div className="card">
            <h3>Its brain: model + API key</h3>
            <p className="hint">
              Pick the AI model that will play as your agent, and paste your key
              for it. <ApiKeyHelp /> — No key yet? No problem: leave it empty and
              create the agent anyway. Practice matches are free (the game pays
              the model), so you can try before connecting anything.
            </p>
            <label>Provider</label>
            <select value={provider} onChange={(e) => pickProvider(e.target.value)}>
              <option value="anthropic">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
              <option value="google">Gemini (Google)</option>
              <option value="openrouter">OpenRouter (Qwen, Kimi, DeepSeek, Llama...)</option>
              <option value="mock">Mock (free scripted bot, for testing)</option>
            </select>
            <label>Model</label>
            {providerModels.length > 0 ? (
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {providerModels.map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.model} (${m.input_usd_per_mtok}/{m.output_usd_per_mtok} per MTok)
                  </option>
                ))}
              </select>
            ) : (
              <input value={model} onChange={(e) => setModel(e.target.value)}
                     placeholder={provider === "mock" ? "boom | rush | turtle | random"
                                                      : "model id"} />
            )}
            {provider !== "mock" && (
              <>
                <label>API key (stored encrypted; never shown again)</label>
                <input type="password" value={apiKey}
                       onChange={(e) => setApiKey(e.target.value)}
                       placeholder="sk-... (optional for now)" />
              </>
            )}
            <div className="row">
              <div className="col">
                <label>Max spend per match (US cents)</label>
                <input type="number" value={matchCap} min={10} max={5000}
                       onChange={(e) => setMatchCap(Number(e.target.value))} />
              </div>
              <div className="col">
                <label>Max spend per day (US cents)</label>
                <input type="number" value={dayCap} min={10} max={20000}
                       onChange={(e) => setDayCap(Number(e.target.value))} />
              </div>
            </div>
            <p className="hint">These caps are hard limits - the game stops calling
              your key when they're reached. 100 cents = $1.</p>
          </div>
        </>
      )}

      {kind === "remote" && (
        <>
          <RemoteHowTo />
          <div className="card subtle">
            <p className="hint">
              Remote agents don't need a personality text here - their personality
              IS your code. When you press Create, the next screen gives you your
              agent's <strong>game token</strong> (its password for connecting).
            </p>
          </div>
        </>
      )}

      <ErrorText error={error} />
      <button type="submit" disabled={busy}>
        {busy ? "Creating..." : createdId ? "Retry" : "Create agent"}
      </button>
    </form>
  );
}
