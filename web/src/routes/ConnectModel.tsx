// Screen 5: connect a model - provider, model, API key, caps, test call + estimate.

import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, put } from "../api/client";
import type { AgentPublic } from "../api/types";
import { ErrorText } from "../components/bits";

interface ModelRow { provider: string; model: string; input_usd_per_mtok: number; output_usd_per_mtok: number }

export default function ConnectModel() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-haiku-4-5");
  const [apiKey, setApiKey] = useState("");
  const [matchCap, setMatchCap] = useState(100);
  const [dayCap, setDayCap] = useState(500);
  const [result, setResult] = useState<{ ok: boolean; latency_ms?: number;
    est_cost_per_match_usd_cents?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<AgentPublic>(`/api/agents/${agentId}`).then(setAgent);
    get<{ models: ModelRow[] }>("/api/models").then((r) => setModels(r.models));
  }, [agentId]);

  const providerModels = models.filter((m) => m.provider === provider);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await put<{ test: { ok: boolean; latency_ms: number };
        est_cost_per_match_usd_cents: number | null }>(
        `/api/agents/${agentId}/model`, {
          provider, model, api_key: apiKey || undefined,
          per_match_cap_usd_cents: matchCap, per_day_cap_usd_cents: dayCap,
        });
      setResult({ ...r.test,
        est_cost_per_match_usd_cents: r.est_cost_per_match_usd_cents ?? undefined });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h2>Connect a model {agent && <span className="hint">for {agent.name}</span>}</h2>
      <form onSubmit={submit} className="card">
        <label>Provider</label>
        <select value={provider} onChange={(e) => { setProvider(e.target.value); }}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="google">Google</option>
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
            <label>API key (encrypted at rest; only the last 4 characters are ever shown)</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                   placeholder="sk-..." />
          </>
        )}

        <div className="row">
          <div className="col">
            <label>Spend cap per match (USD cents)</label>
            <input type="number" value={matchCap} min={10} max={5000}
                   onChange={(e) => setMatchCap(Number(e.target.value))} />
          </div>
          <div className="col">
            <label>Spend cap per day (USD cents)</label>
            <input type="number" value={dayCap} min={10} max={20000}
                   onChange={(e) => setDayCap(Number(e.target.value))} />
          </div>
        </div>

        <ErrorText error={error} />
        <button type="submit" disabled={busy}>
          {busy ? "Testing..." : "Test call & save"}
        </button>
        {result && (
          <p style={{ marginTop: 12 }}>
            {result.ok
              ? <span className="badge ok">test OK · {result.latency_ms}ms</span>
              : <span className="badge danger">test failed</span>}
            {result.est_cost_per_match_usd_cents !== undefined && (
              <span className="badge">
                ~${(result.est_cost_per_match_usd_cents / 100).toFixed(2)} per match
              </span>
            )}
          </p>
        )}
      </form>
      <p><Link to={`/agents/${agentId}`}>Go to the agent panel →</Link></p>
    </div>
  );
}
