// Screen 9: replay - play/pause, speed, turn slider, fog perspective selector.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { get } from "../api/client";
import type { FeedLine, GameState, MatchPlayerOut } from "../api/types";
import { Feed, PlayerBadge } from "../components/bits";
import MapView from "../pixi/MapView";

interface TurnData { turn_number: number; state: GameState; feed: FeedLine[] }

export default function Replay() {
  const { matchId } = useParams();
  const [params, setParams] = useSearchParams();
  const [turns, setTurns] = useState<number[]>([]);
  const [players, setPlayers] = useState<MatchPlayerOut[]>([]);
  const [current, setCurrent] = useState(Number(params.get("t") ?? 0));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [perspective, setPerspective] = useState<number | null>(null);
  const cache = useRef(new Map<number, TurnData>());
  const [data, setData] = useState<TurnData | null>(null);
  const [feedAll, setFeedAll] = useState<FeedLine[]>([]);

  useEffect(() => {
    get<{ turns_available: number[] }>(`/api/matches/${matchId}/replay`)
      .then((r) => setTurns(r.turns_available));
    get<{ players: MatchPlayerOut[] }>(`/api/matches/${matchId}`)
      .then((r) => setPlayers(r.players));
  }, [matchId]);

  const loadTurn = useCallback(async (n: number) => {
    if (!cache.current.has(n)) {
      const d = await get<TurnData>(`/api/matches/${matchId}/turns/${n}`);
      cache.current.set(n, d);
    }
    const d = cache.current.get(n)!;
    setData(d);
    setFeedAll((prev) => {
      const upTo = [...prev.filter((f) => (f.turn ?? 0) < n),
                    ...(d.feed ?? []).map((f) => ({ ...f, turn: n }))];
      return upTo.slice(-60);
    });
  }, [matchId]);

  useEffect(() => {
    if (turns.length) loadTurn(Math.min(current, turns[turns.length - 1]));
  }, [turns, current, loadTurn]);

  useEffect(() => {
    if (!playing || turns.length === 0) return;
    const last = turns[turns.length - 1];
    const timer = setInterval(() => {
      setCurrent((c) => {
        if (c >= last) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 900 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, turns]);

  useEffect(() => {
    setParams({ t: String(current) }, { replace: true });
  }, [current, setParams]);

  const last = turns.length ? turns[turns.length - 1] : 0;

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <h2 className="col">Replay · turn {current}/{last}</h2>
        <Link to={`/matches/${matchId}/result`}><button className="secondary">Results</button></Link>
      </div>
      <div className="row">
        <div>
          <MapView state={data?.state ?? null} perspective={perspective} sizePx={620} />
          <div className="card subtle" style={{ marginTop: 10 }}>
            <button onClick={() => setPlaying(!playing)}>
              {playing ? "Pause" : "Play"}
            </button>{" "}
            <button className="secondary" onClick={() => setCurrent(Math.max(0, current - 1))}>−1</button>{" "}
            <button className="secondary" onClick={() => setCurrent(Math.min(last, current + 1))}>+1</button>{" "}
            {[1, 2, 4].map((s) => (
              <button key={s} className="secondary"
                      style={{ fontWeight: speed === s ? 700 : 400 }}
                      onClick={() => setSpeed(s)}>{s}×</button>
            ))}
            <input type="range" min={0} max={last} value={current}
                   onChange={(e) => setCurrent(Number(e.target.value))} />
            <label>Fog of war:</label>
            <select value={perspective === null ? "god" : String(perspective)}
                    onChange={(e) => setPerspective(
                      e.target.value === "god" ? null : Number(e.target.value))}>
              <option value="god">God view (everything)</option>
              {players.map((p) => (
                <option key={p.player_index} value={p.player_index}>
                  As {p.name} sees it
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="col">
          <div className="card">
            <h3>Players</h3>
            {players.map((p) => (
              <p key={p.player_index}>
                <PlayerBadge index={p.player_index} name={p.name} />
                <span className="hint"> {p.lineage} · lvl {p.level}</span>
              </p>
            ))}
          </div>
          <div className="card">
            <h3>Feed up to T{current}</h3>
            <Feed lines={feedAll} />
          </div>
        </div>
      </div>
    </>
  );
}
