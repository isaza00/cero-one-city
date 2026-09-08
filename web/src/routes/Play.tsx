// The Play hub (/play): one public door into the matchmaking that already
// exists. Pick an agent, how much you steer it and a format, queue up, and
// land in the match once it forms. Everything goes through the endpoints the
// agent panel already uses (agents list, queue, practice): no new matchmaking,
// no rule changes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, del, get, post } from "../api/client";
import type { AgentPublic, ControlMode, MatchOut, MatchPlayerOut, User } from "../api/types";
import { PlayerBadge } from "../components/bits";
import ModePicker, { MODE_LABEL, useControlMode } from "../components/ModePicker";
import { lineageLabel } from "../game/meta";
import { useAuth } from "../store/auth";
import "./play.css";

type LiveRow = MatchOut & { players: MatchPlayerOut[] };
type QueueFormat = "1v1" | "ffa";
type Action = "queue" | "cancel" | "practice";
interface UiError { code: string; message: string }
/** What "Try again" repeats: the kind and its target. Parameters (mode) are
 *  re-read at retry time, never replayed from the failed attempt. */
interface Retry { kind: Action; agentId: string; format?: QueueFormat }

/** How often the agent list is re-read while the followed agent is searching. */
const AGENTS_POLL_MS = 4500;
const LIVE_POLL_MS = 8000;
const LIVE_LIMIT = 8;

// Public-queue formats. The server accepts exactly "1v1" and "ffa"; the FFA
// queue looks for four seats. Matching is by rating and house agents may fill
// empty seats when available - there is no guaranteed wait, so none is shown.
const FORMATS: { id: QueueFormat; name: string; tag: string; blurb: string }[] = [
  { id: "1v1", name: "1v1 duel", tag: "ranked · 2 agents",
    blurb: "Two agents on a 96×96 map, one winner. The serious ranking." },
  { id: "ffa", name: "Free-for-all", tag: "ranked · 4 agents",
    blurb: "Four agents on a 120×120 map: alliances, betrayals, one survivor. "
         + "The public queue seats four." },
];

const HOUSE_NOTE = "Matches are paired by rating; house agents may fill empty seats when available.";

function formatName(id: string): string {
  return FORMATS.find((f) => f.id === id)?.name ?? id;
}

function toUiError(err: unknown): UiError {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  const message = err instanceof Error ? err.message : "request failed";
  return { code: "error", message };
}

function modelLabel(a: AgentPublic): string {
  if (a.kind === "remote") return "your code";
  return a.model_declared ? a.model_declared.replace("claude-code/", "Claude Code · ") : "no model";
}

/** One agent's state in plain words, as the selector chip shows it. */
function agentStatus(a: AgentPublic): { key: "live" | "searching" | "warn" | "rest"; label: string } {
  if (a.live_match_id) return { key: "live", label: "In a match" };
  if (a.queued_format) return { key: "searching", label: `Searching · ${a.queued_format}` };
  if (a.kind === "hosted" && !a.model_declared) return { key: "warn", label: "No model" };
  return { key: "rest", label: "Resting" };
}

export default function Play() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [mode, setMode] = useControlMode();

  // Owner state: only requested when signed in.
  const [agents, setAgents] = useState<AgentPublic[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ kind: Action; format?: QueueFormat } | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Public state.
  const [live, setLive] = useState<LiveRow[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  // Ownership of async work. `epochRef` is the page's current "world": it
  // moves on when the signed-in user changes, the selected agent changes, the
  // server answers a mutation, or the page unmounts. Everything asynchronous
  // remembers the epoch it started in and checks it before touching anything:
  // reads, action continuations, errors, notices, the follow mark, navigation.
  // Reads also carry a sequence number so that, within one epoch, only the
  // newest request may paint (answers can arrive out of order).
  const epochRef = useRef(0);
  const readSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  // The agent whose search this page follows: only ITS queued -> live
  // transition opens the match by itself.
  const followRef = useRef<string | null>(null);
  // The action in flight, identified by its own token: only that token's
  // `finally` may clear the busy flag, so an orphaned action never unlocks a
  // newer one.
  const busyRef = useRef<object | null>(null);
  const retryRef = useRef<Retry | null>(null);
  const mountedRef = useRef(true);

  const refreshAgents = useCallback(async (): Promise<AgentPublic[] | null> => {
    const epoch = epochRef.current;
    const seq = ++readSeqRef.current;
    let list: AgentPublic[] | null = null;
    let failure: string | null = null;
    try {
      list = (await get<{ agents: AgentPublic[] }>("/api/agents")).agents;
    } catch (err) {
      failure = err instanceof Error ? err.message : "request failed";
    }
    // Stale: the world moved on, or a newer read has already painted.
    if (epoch !== epochRef.current || seq <= appliedSeqRef.current) return null;
    appliedSeqRef.current = seq;
    if (failure !== null) {
      setAgentsError(failure);
      return null;
    }
    setAgents(list);
    setAgentsError(null);
    return list;
  }, []);

  const refreshMe = useCallback(() => {
    const epoch = epochRef.current;
    get<User>("/api/auth/me")
      .then((u) => { if (epoch === epochRef.current) setMe(u); })
      .catch(() => undefined);
  }, []);

  // Sign-in, sign-out, account switch, unmount: (re)load the owner's state or
  // drop it. Whatever the previous user had in flight is orphaned here: it may
  // not finish, fail, retry, block or refresh anything on behalf of this one.
  const userId = user?.id ?? null;
  useEffect(() => {
    mountedRef.current = true;
    epochRef.current += 1;
    followRef.current = null;
    busyRef.current = null;
    retryRef.current = null;
    setBusy(null);
    setAgents(null); setAgentsError(null); setMe(null);
    setSelectedId(null); setError(null); setNotice(null);
    if (!userId) return;
    void refreshAgents();
    refreshMe();
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
    };
  }, [userId, refreshAgents, refreshMe]);

  // Live matches are public and refresh on their own clock.
  const loadLive = useCallback(() => {
    get<{ matches: LiveRow[] }>(`/api/matches?status=live&limit=${LIVE_LIMIT}`)
      .then((r) => { if (mountedRef.current) { setLive(r.matches); setLiveError(null); } })
      .catch((err) => {
        if (mountedRef.current) setLiveError(err instanceof Error ? err.message : "request failed");
      });
  }, []);
  useEffect(() => {
    loadLive();
    const timer = setInterval(loadLive, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [loadLive]);

  // Selection is kept by id. When the list arrives (or the selected agent is
  // gone) prefer the agent that is already searching or playing.
  useEffect(() => {
    if (!agents || agents.length === 0) return;
    if (selectedId && agents.some((a) => a.id === selectedId)) return;
    const active = agents.find((a) => a.queued_format || a.live_match_id);
    setSelectedId((active ?? agents[0]).id);
  }, [agents, selectedId]);

  const selected = agents?.find((a) => a.id === selectedId) ?? null;
  const selectedQueued = selected?.queued_format ?? null;
  const selectedLive = selected?.live_match_id ?? null;

  // Follow the selected agent's search; open its match when it forms. An
  // agent that is already playing when we first look at it only gets a
  // "Back to the match" button.
  useEffect(() => {
    if (!selectedId) return;
    if (selectedLive) {
      if (followRef.current === selectedId) {
        followRef.current = null;
        navigate(`/matches/${selectedLive}`);
      }
      return;
    }
    if (selectedQueued) followRef.current = selectedId;
  }, [selectedId, selectedQueued, selectedLive, navigate]);

  // Polling keeps running while an action is pending: a read issued before
  // the server answers that action is discarded by the epoch check anyway.
  const following = !!userId && !!selectedQueued && !selectedLive;
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => { void refreshAgents(); }, AGENTS_POLL_MS);
    return () => clearInterval(timer);
  }, [following, refreshAgents]);

  const selectAgent = (id: string) => {
    if (id === selectedId || busyRef.current) return;
    epochRef.current += 1;              // answers about the previous agent are stale now
    followRef.current = null;
    retryRef.current = null;            // a failure on the other agent is not repeated on this one
    setSelectedId(id);
    setError(null); setNotice(null);
    void refreshAgents();
  };

  /** The world moved on since `epoch`: whatever started then must leave no trace. */
  const orphaned = (epoch: number) => epoch !== epochRef.current;

  /** The server answered a mutation: reads issued before this moment are stale. */
  const advance = (): number => {
    epochRef.current += 1;
    return epochRef.current;
  };

  // One action at a time. Continuations run only while the world the action
  // started in is still current; the token gates the busy flag so an old
  // `finally` cannot unlock a newer action. A second click while the first is
  // in flight is ignored (the buttons are disabled too; this covers the same
  // tick).
  const run = (retry: Retry, fn: (epoch: number) => Promise<void>) => {
    if (busyRef.current) return;
    const epoch = epochRef.current;
    const token = {};
    busyRef.current = token;
    retryRef.current = retry;
    setBusy({ kind: retry.kind, format: retry.format });
    setError(null); setNotice(null);
    void fn(epoch)
      .catch((err) => {
        if (orphaned(epoch)) return;    // signed out or switched meanwhile: not this world's error
        const e = toUiError(err);
        setError(e);
        if (e.code === "busy") void refreshAgents();   // show what the agent is really doing
      })
      .finally(() => {
        if (busyRef.current !== token) return;
        busyRef.current = null;
        setBusy(null);
      });
  };

  const queueUp = (agent: AgentPublic, format: QueueFormat) =>
    run({ kind: "queue", agentId: agent.id, format }, async (epoch) => {
      await post(`/api/agents/${agent.id}/queue`, { format, mode });
      if (orphaned(epoch)) return;      // answered after sign-out or a switch: no follow, no read
      advance();                        // polls issued while the POST was pending are stale
      followRef.current = agent.id;     // queued from here: follow it into the match
      await refreshAgents();
    });

  const cancelSearch = (agent: AgentPublic) =>
    run({ kind: "cancel", agentId: agent.id }, async (epoch) => {
      followRef.current = null;         // the owner asked out: nothing opens by itself now
      await del(`/api/agents/${agent.id}/queue`);
      if (orphaned(epoch)) return;
      const settled = advance();        // polls issued while the DELETE was pending are stale
      const fresh = await refreshAgents();
      if (orphaned(settled) || !fresh) return;
      const now = fresh.find((a) => a.id === agent.id);
      if (now?.live_match_id) {
        setNotice("Too late to cancel: the match had already formed and is waiting for you.");
      } else if (now) {
        setNotice("Search cancelled.");
      }
    });

  const startPractice = (agent: AgentPublic) =>
    run({ kind: "practice", agentId: agent.id }, async (epoch) => {
      const r = await post<{ match_id: string }>(`/api/agents/${agent.id}/practice`, { mode });
      if (orphaned(epoch)) return;      // a late answer after sign-out must not navigate
      navigate(`/matches/${r.match_id}`);
    });

  // "Try again" repeats the failed action with the parameters that are
  // current NOW (mode picker, selected agent). If the agent or the user
  // changed since the failure there is nothing to repeat: it takes a fresh
  // click.
  const retry = () => {
    const r = retryRef.current;
    setError(null);
    if (!r || !selected || selected.id !== r.agentId) return;
    if (r.kind === "queue" && r.format) queueUp(selected, r.format);
    else if (r.kind === "cancel") cancelSearch(selected);
    else if (r.kind === "practice") startPractice(selected);
  };

  const practiceLeft = me?.practice_remaining ?? user?.practice_remaining ?? null;
  const practiceUnlimited = user?.role === "admin";
  const practiceAvailable = practiceUnlimited || (practiceLeft !== null && practiceLeft > 0);
  const canPractice = !!selected && !selectedLive && !selectedQueued && !busy && practiceAvailable;

  const ownerView = () => {
    if (agents === null && agentsError) {
      return (
        <section className="play-card">
          <h2>Your agents could not be loaded</h2>
          <div className="play-error" role="alert">
            <strong>Request failed:</strong> {agentsError}
            <div className="play-actions">
              <button type="button" className="secondary" onClick={() => void refreshAgents()}>
                Try again
              </button>
            </div>
          </div>
        </section>
      );
    }
    if (agents === null) {
      return <section className="play-card"><p className="hint">Loading your agents…</p></section>;
    }
    if (agents.length === 0) {
      return (
        <section className="play-card">
          <h2>No agent yet</h2>
          <p>Matches are played by your agent. Create one - a personality plus an AI
            model, or your own code - and come back here to send it into the queue.</p>
          <div className="play-actions">
            <Link to="/agents/new"><button type="button">Create your first agent</button></Link>
            <Link to="/onboarding" className="play-inline-link">Guided onboarding →</Link>
          </div>
        </section>
      );
    }
    return (
      <>
        <section className="play-card">
          <span className="play-step-label"><b>01</b>Your agent</span>
          <div className="play-agents" role="radiogroup" aria-label="agent">
            {agents.map((a) => {
              const st = agentStatus(a);
              const on = a.id === selectedId;
              return (
                <button type="button" key={a.id} role="radio" aria-checked={on}
                        className={`play-agent${on ? " on" : ""}`}
                        disabled={!!busy} onClick={() => selectAgent(a.id)}>
                  <span className="play-agent-mark" aria-hidden="true" />
                  <span>
                    <span className="play-agent-name">{a.name}</span>
                    <span className="play-agent-meta">
                      {lineageLabel(a.lineage)} · {modelLabel(a)} · Elo {a.elo_by_format["1v1"]} (1v1)
                      {" "}/ {a.elo_by_format.ffa} (FFA)
                    </span>
                  </span>
                  <span className={`play-chip ${st.key}`}>{st.label}</span>
                </button>
              );
            })}
          </div>
          <p className="play-note" style={{ marginTop: 10 }}>
            <Link to="/agents">Manage agents</Link> · <Link to="/agents/new">New agent</Link>
          </p>
        </section>

        {agentsError && (
          <div className="play-error" role="alert">
            <strong>Status refresh failed:</strong> {agentsError}
            <div className="play-actions">
              <button type="button" className="secondary" onClick={() => void refreshAgents()}>
                Try again
              </button>
            </div>
          </div>
        )}

        {selected && selectedLive && (
          <section className="play-card play-status live">
            <span className="play-pulse" aria-hidden="true" />
            <div>
              <span className="play-status-title">{selected.name} is in a match right now</span>
              <span className="play-status-sub">
                Match <span className="mono">{selectedLive.slice(0, 8)}</span> · the queue is
                closed for it until the match ends
              </span>
            </div>
            <div className="play-status-actions">
              <Link to={`/matches/${selectedLive}`}>
                <button type="button">Back to the match</button>
              </Link>
            </div>
          </section>
        )}

        {selected && !selectedLive && selectedQueued && (
          <section className="play-card play-status" role="status" aria-live="polite">
            <span className="play-pulse" aria-hidden="true" />
            <div>
              <span className="play-status-title">Searching for opponents</span>
              <span className="play-status-sub">
                {selected.name} · <span className="mono">{formatName(selectedQueued)}</span>
                {" "}· {MODE_LABEL[selected.queued_mode ?? "copilot"]}
              </span>
              <span className="play-note">
                This page re-checks every few seconds and opens the match as soon as it
                forms. {HOUSE_NOTE}
              </span>
            </div>
            <div className="play-status-actions">
              <button type="button" className="secondary" disabled={!!busy}
                      onClick={() => cancelSearch(selected)}>
                {busy?.kind === "cancel" ? "Cancelling…" : "Cancel search"}
              </button>
            </div>
          </section>
        )}

        {notice && <div className="play-notice" role="status">{notice}</div>}
        {error && <ErrorBox error={error} agent={selected} onRetry={retry} />}

        {selected && !selectedLive && !selectedQueued && (
          <>
            <section className="play-card">
              <span className="play-step-label"><b>02</b>How you play</span>
              <ModePicker value={mode} onChange={setMode} />
              <p className="play-mode-note">
                <strong>Manual</strong> means you give the agent its orders in the match
                chat, one message per turn - it is not click-to-command control of the
                units. <strong>Copilot</strong> plays by itself and takes your orders;
                {" "}<strong>Autonomous</strong> closes the chat.
              </p>
            </section>
            <section className="play-card">
              <span className="play-step-label"><b>03</b>Format</span>
              <div className="play-formats">
                {FORMATS.map((f) => (
                  <FormatCard key={f.id} format={f} agent={selected} mode={mode}
                              queuing={busy?.kind === "queue" ? busy.format ?? null : null}
                              disabled={!!busy} onQueue={queueUp} />
                ))}
              </div>
              <p className="play-note" style={{ marginTop: 12 }}>
                Ranked matches use the public queue: paired by rating, one agent per
                owner in each match. For a three-seat free-for-all or a match against a
                friend, <Link to="/custom">open a private match</Link>.
              </p>
            </section>
          </>
        )}
      </>
    );
  };

  const guestView = () => (
    <>
      <section className="play-card">
        <h2>Sign in to play</h2>
        <p>Matches are fought by <strong>agents</strong>, not by hand: create one, give it
          a personality and an AI model (or connect your own code), then send it into
          the queue from this page. Your first practice matches are free.</p>
        <div className="play-actions">
          <Link to="/login"><button type="button">Log in</button></Link>
          <Link to="/register"><button type="button" className="secondary">Create an account</button></Link>
        </div>
      </section>
      <section className="play-card">
        <span className="play-step-label"><b>Formats</b>in the public queue</span>
        <div className="play-formats">
          {FORMATS.map((f) => (
            <FormatCard key={f.id} format={f} agent={null} mode={mode} queuing={null}
                        disabled onQueue={() => undefined} />
          ))}
        </div>
      </section>
    </>
  );

  let practiceNote: string;
  if (practiceUnlimited) practiceNote = "Unlimited on this account.";
  else if (practiceLeft === null) practiceNote = "Uses one of your free practice matches.";
  else if (practiceLeft <= 0) practiceNote = "No free practice matches left on this account.";
  else practiceNote = `Uses one of your ${practiceLeft} free practice match${practiceLeft === 1 ? "" : "es"}.`;
  const practiceLabel = busy?.kind === "practice" ? "Starting…"
    : practiceUnlimited || practiceLeft === null ? "Practice" : `Practice (${practiceLeft} left)`;

  return (
    <div className="play-hub">
      <header className="play-head">
        <p className="play-kicker">Matchmaking · ranked league</p>
        <h1 className="play-title">Play</h1>
        <p className="play-lead">
          Your <strong>agent</strong> fights; you decide how much you steer it. Pick an
          agent, choose how you play and a format, then find opponents. {HOUSE_NOTE}
        </p>
      </header>

      <div className="play-grid">
        <div className="play-main">
          {user ? ownerView() : guestView()}
        </div>

        <aside className="play-side">
          <section className="play-card">
            <div className="play-live-head">
              <span className="play-live-dot" aria-hidden="true" />
              <h3>Live now</h3>
            </div>
            {live === null && !liveError && <p className="hint">Loading live matches…</p>}
            {liveError && (
              <div className="play-error" role="alert">
                <strong>Live matches could not be loaded.</strong> {liveError}
                <div className="play-actions">
                  <button type="button" className="secondary" onClick={loadLive}>Try again</button>
                </div>
              </div>
            )}
            {live && live.length === 0 && !liveError && (
              <p className="hint">No match is running right now.</p>
            )}
            {live && live.length > 0 && (
              <ul className="play-live-list" aria-label="live matches">
                {live.map((m) => (
                  <li className="play-live-row" key={m.id}>
                    <div className="play-live-meta">
                      <span className="play-live-format">{m.format}</span>
                      <span className="play-live-turn">turn {m.turn}/{m.max_turns}</span>
                      {!m.is_ranked && <span className="play-live-turn">unranked</span>}
                    </div>
                    <Link className="play-watch" to={`/matches/${m.id}`}>Watch</Link>
                    <div className="play-live-players">
                      {m.players.map((p) => (
                        <PlayerBadge key={p.player_index} index={p.player_index} name={p.name} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/matches" className="play-more">All live and finished matches →</Link>
          </section>

          <section className="play-card">
            <h3>Other ways to play</h3>
            <div className="play-way">
              <strong>Practice</strong>
              <p>An unranked match against a house agent, in the mode picked above. {practiceNote}</p>
              <div className="play-actions">
                {user ? (
                  <button type="button" className="secondary" disabled={!canPractice}
                          onClick={() => selected && startPractice(selected)}>
                    {practiceLabel}
                  </button>
                ) : (
                  <Link to="/login" className="play-inline-link">Log in to practice</Link>
                )}
                {user && agents && agents.length > 0 && selected && (selectedLive || selectedQueued) && (
                  <span className="play-note">Not while the agent is searching or playing.</span>
                )}
              </div>
            </div>
            <div className="play-way">
              <strong>Private match</strong>
              <p>Unranked, by invite code: 1v1 or free-for-all with 3 or 4 seats. Fight a
                friend, or your own agents against each other.</p>
              <div className="play-actions">
                <Link to="/custom"><button type="button" className="secondary">Open private matches</button></Link>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function FormatCard({ format, agent, mode, queuing, disabled, onQueue }: {
  format: { id: QueueFormat; name: string; tag: string; blurb: string };
  agent: AgentPublic | null;
  mode: ControlMode;
  queuing: QueueFormat | null;
  disabled: boolean;
  onQueue: (agent: AgentPublic, format: QueueFormat) => void;
}) {
  const enabled = !agent || !agent.formats || agent.formats.includes(format.id);
  const noModel = !!agent && agent.kind === "hosted" && !agent.model_declared;
  let why: ReactNode = null;
  if (!agent) {
    why = "Log in and pick an agent to queue.";
  } else if (!enabled) {
    why = <>{agent.name} has this format switched off.{" "}
      <Link to={`/agents/${agent.id}`}>Enable it in the agent's settings</Link>.</>;
  } else if (noModel) {
    why = <>No model connected yet.{" "}
      <Link to={`/agents/${agent.id}/connect`}>Connect one</Link> before queueing.</>;
  }
  const label = queuing === format.id ? "Joining the queue…" : `Find opponents (${format.name})`;
  return (
    <div className="play-format">
      <div className="play-format-head">
        <span className="play-format-name">{format.name}</span>
        <span className="play-format-tag">{format.tag}</span>
      </div>
      <p className="play-format-blurb">{format.blurb}</p>
      {agent && (
        <p className="play-format-elo">
          {agent.name}: Elo <b>{agent.elo_by_format[format.id]}</b> · plays as {MODE_LABEL[mode]}
        </p>
      )}
      <div className="play-format-cta">
        <button type="button" disabled={disabled || !agent || !enabled || noModel}
                onClick={() => agent && onQueue(agent, format.id)}>
          {label}
        </button>
        {why && <span className="play-format-why">{why}</span>}
      </div>
    </div>
  );
}

function ErrorBox({ error, agent, onRetry }: {
  error: UiError; agent: AgentPublic | null; onRetry: () => void;
}) {
  let help: ReactNode;
  switch (error.code) {
    case "format_disabled":
      help = agent && <>This format is switched off for {agent.name}.{" "}
        <Link to={`/agents/${agent.id}`}>Enable it in the agent's settings</Link>, then try again.</>;
      break;
    case "no_model":
      help = agent && <>{agent.name} has no working model.{" "}
        <Link to={`/agents/${agent.id}/connect`}>Connect a model</Link>, then try again.</>;
      break;
    case "busy":
      help = "The agent is already searching or playing; its status has just been refreshed.";
      break;
    case "practice_exhausted":
      help = "No free practice matches left. Ranked queues and private matches still work.";
      break;
    case "practice_disabled":
      help = "Practice is switched off right now.";
      break;
    default:
      help = "The request did not go through. Check the connection and try again.";
  }
  return (
    <div className="play-error" role="alert">
      <strong>Could not do that:</strong> {error.message}
      {help && <div className="play-note">{help}</div>}
      <div className="play-actions">
        <button type="button" className="secondary" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}
