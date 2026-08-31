// Spectator WebSocket hook: snapshot + live turns with auto-reconnect.

import { useEffect, useRef, useState } from "react";
import type {
  FeedLine, GameState, MatchOut, MatchPlayerOut, ScoreboardRow, SpectateSnapshot,
} from "../api/types";

export interface SpectateData {
  match: MatchOut | null;
  players: MatchPlayerOut[];
  turn: number;
  state: GameState | null;
  feed: FeedLine[];
  highlights: { turn: number; kind: string; text?: string }[];
  scoreboard: ScoreboardRow[];
  connected: boolean;
  finished: boolean;
}

export function useSpectate(matchId: string | undefined): SpectateData {
  const [data, setData] = useState<SpectateData>({
    match: null, players: [], turn: 0, state: null, feed: [], highlights: [],
    scoreboard: [], connected: false, finished: false,
  });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let closed = false;
    let retry = 0;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/matches/${matchId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setData((d) => ({ ...d, connected: true }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "snapshot") {
          const snap = msg as SpectateSnapshot;
          setData((d) => ({
            ...d,
            match: snap.match, players: snap.players, turn: snap.turn_number,
            state: snap.state, feed: snap.feed_recent ?? [],
            highlights: snap.highlights ?? [],
            finished: snap.match.status === "finished",
          }));
        } else if (msg.type === "turn_resolved") {
          setData((d) => ({
            ...d,
            turn: msg.turn_number,
            state: msg.state,
            scoreboard: msg.scoreboard ?? d.scoreboard,
            feed: [...d.feed, ...(msg.feed ?? []).map((f: FeedLine) =>
              ({ ...f, turn: msg.turn_number }))].slice(-80),
          }));
        } else if (msg.type === "highlight") {
          setData((d) => ({
            ...d,
            highlights: [...d.highlights, { turn: msg.turn, kind: msg.kind, text: msg.text }]
              .slice(-30),
          }));
        } else if (msg.type === "match_end") {
          setData((d) => ({ ...d, finished: true }));
        }
      };
      ws.onclose = () => {
        setData((d) => ({ ...d, connected: false }));
        if (!closed && retry < 8) {
          retry += 1;
          setTimeout(connect, Math.min(1000 * retry, 5000));
        }
      };
    };

    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, [matchId]);

  return data;
}
