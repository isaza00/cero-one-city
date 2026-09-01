// Spectator WebSocket hook: snapshot + live turns with auto-reconnect.

import { useEffect, useRef, useState } from "react";
import type {
  FeedLine, GameEvent, GameState, MatchOut, MatchPlayerOut, ScoreboardRow,
  SpectateSnapshot,
} from "../api/types";

export interface SpectateData {
  match: MatchOut | null;
  players: MatchPlayerOut[];
  turn: number;
  state: GameState | null;
  /** Events of the latest resolved turn (attacks, kills, builds...). */
  events: GameEvent[];
  feed: FeedLine[];
  highlights: { turn: number; kind: string; text?: string }[];
  scoreboard: ScoreboardRow[];
  connected: boolean;
  finished: boolean;
}

export function useSpectate(matchId: string | undefined): SpectateData {
  const [data, setData] = useState<SpectateData>({
    match: null, players: [], turn: 0, state: null, events: [], feed: [],
    highlights: [], scoreboard: [], connected: false, finished: false,
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
            events: msg.events ?? [],
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

    // REST safety net: WS is the fast path, but if the socket stalls or the
    // match ends while we are not listening, polling heals the page.
    let finishedSeen = false;
    const poll = setInterval(async () => {
      if (finishedSeen) return;
      try {
        const r = await fetch(`/api/matches/${matchId}`);
        const body = await r.json();
        const match = body.match as MatchOut;
        const turn = match.turn ?? 0;
        finishedSeen = match.status === "finished";
        const rt = await fetch(`/api/matches/${matchId}/turns/${turn}`);
        const td = rt.ok ? await rt.json() : null;
        setData((d) => {
          if (turn < d.turn && !finishedSeen) return d; // WS is ahead: keep it
          return {
            ...d,
            match, players: body.players ?? d.players, turn,
            state: td?.state ?? d.state,
            feed: td?.feed?.length
              ? [...d.feed.filter((f: FeedLine) => (f.turn ?? -1) !== turn),
                 ...td.feed.map((f: FeedLine) => ({ ...f, turn }))].slice(-80)
              : d.feed,
            finished: d.finished || match.status === "finished",
          };
        });
      } catch {
        /* backend unreachable; keep whatever we have */
      }
    }, 3000);

    return () => {
      closed = true;
      clearInterval(poll);
      wsRef.current?.close();
    };
  }, [matchId]);

  return data;
}
