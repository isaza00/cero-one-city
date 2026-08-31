// Screen 15: minimal admin - spend, prices, seasons, house agents, kill-switches.

import { useEffect, useState } from "react";
import { get, patch, post, put } from "../api/client";
import { ErrorText } from "../components/bits";

interface Price { provider: string; model: string; input: number; cached: number;
  output: number; active: boolean }
interface HouseAgent { id: string; name: string; tier: string; lineage: string;
  level: number; active: boolean; charter: string | null }

export default function Admin() {
  const [costs, setCosts] = useState<{ llm_spend_today_usd: number; live_matches: number;
    by_purpose_provider: { purpose: string; provider: string; usd: number; calls: number }[] } | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [house, setHouse] = useState<HouseAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => {
    get<typeof costs>("/api/admin/costs").then(setCosts).catch((e) => setError(e.message));
    get<{ prices: Price[] }>("/api/admin/model-prices").then((r) => setPrices(r.prices));
    get<{ agents: HouseAgent[] }>("/api/admin/house-agents").then((r) => setHouse(r.agents));
  };
  useEffect(reload, []);

  const savePrices = async () => {
    await put("/api/admin/model-prices", prices);
    setNotice("Prices saved.");
  };

  const kill = async (key: "matchmaking" | "practice", value: boolean) => {
    await post("/api/admin/killswitch", { [key]: value });
    setNotice(`${key} set to ${value}.`);
  };

  const closeSeason = async () => {
    const r = await post<{ closed: number; opened: number | null }>("/api/admin/seasons/close");
    setNotice(`Season ${r.closed} closed; season ${r.opened} opened.`);
  };

  return (
    <>
      <h2>Admin</h2>
      <ErrorText error={error} />
      {notice && <p className="hint">{notice}</p>}

      <div className="row">
        <div className="col card">
          <h3>Today</h3>
          <p className="big">${costs?.llm_spend_today_usd?.toFixed(2) ?? "0.00"} LLM spend</p>
          <p>{costs?.live_matches ?? 0} live matches</p>
          <table>
            <thead><tr><th>Purpose</th><th>Provider</th><th>USD</th><th>Calls</th></tr></thead>
            <tbody>
              {costs?.by_purpose_provider.map((r, i) => (
                <tr key={i}><td>{r.purpose}</td><td>{r.provider}</td>
                  <td className="mono">${r.usd.toFixed(3)}</td><td>{r.calls}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="col card">
          <h3>Switches</h3>
          <p>
            <button onClick={() => kill("matchmaking", false)} className="danger">Stop matchmaking</button>{" "}
            <button onClick={() => kill("matchmaking", true)}>Enable matchmaking</button>
          </p>
          <p>
            <button onClick={() => kill("practice", false)} className="danger">Stop practice</button>{" "}
            <button onClick={() => kill("practice", true)}>Enable practice</button>
          </p>
          <h3>Season</h3>
          <button className="danger" onClick={closeSeason}>
            Close current season & roll over
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Model prices (USD micros per MTok)</h3>
        <table>
          <thead><tr><th>Provider</th><th>Model</th><th>Input</th><th>Cached</th>
            <th>Output</th><th>Active</th></tr></thead>
          <tbody>
            {prices.map((p, i) => (
              <tr key={`${p.provider}/${p.model}`}>
                <td>{p.provider}</td><td>{p.model}</td>
                <td><input type="number" value={p.input} style={{ width: 120 }}
                  onChange={(e) => setPrices(prices.map((q, j) =>
                    j === i ? { ...q, input: Number(e.target.value) } : q))} /></td>
                <td><input type="number" value={p.cached} style={{ width: 120 }}
                  onChange={(e) => setPrices(prices.map((q, j) =>
                    j === i ? { ...q, cached: Number(e.target.value) } : q))} /></td>
                <td><input type="number" value={p.output} style={{ width: 120 }}
                  onChange={(e) => setPrices(prices.map((q, j) =>
                    j === i ? { ...q, output: Number(e.target.value) } : q))} /></td>
                <td><input type="checkbox" checked={p.active} style={{ width: "auto" }}
                  onChange={(e) => setPrices(prices.map((q, j) =>
                    j === i ? { ...q, active: e.target.checked } : q))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={savePrices}>Save prices</button>
      </div>

      <div className="card">
        <h3>House agents</h3>
        <table>
          <thead><tr><th>Name</th><th>Tier</th><th>Lineage</th><th>Lvl</th><th>Active</th></tr></thead>
          <tbody>
            {house.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td><td>{a.tier}</td><td>{a.lineage}</td><td>{a.level}</td>
                <td>
                  <input type="checkbox" checked={a.active} style={{ width: "auto" }}
                    onChange={async (e) => {
                      await patch(`/api/admin/house-agents/${a.id}`,
                                  { active: e.target.checked });
                      reload();
                    }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
