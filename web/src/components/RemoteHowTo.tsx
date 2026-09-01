// Shared "connect your own agent" guide: the short human version, the full
// protocol spec in a scrollable box, and the ready-to-run templates.
// Used inline on Create Agent (remote option) and on the Remote Setup page.

import { useState } from "react";

export function wsBase(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

/** The full spec, loaded on demand into a scrollable box (never a raw tab dump). */
function SpecBox() {
  const [text, setText] = useState<string | null>(null);
  const [openBox, setOpenBox] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (text === null) {
      setText(await (await fetch("/remote-protocol.md")).text());
    }
  };
  const toggle = async () => {
    await load();
    setOpenBox(!openBox);
  };
  const copy = async () => {
    await load();
    const t = text ?? await (await fetch("/remote-protocol.md")).text();
    await navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <>
      <p>
        <button type="button" onClick={toggle} style={{ marginRight: 10 }}>
          {openBox ? "Hide the spec" : "Read the spec here"}
        </button>
        <button type="button" className="secondary" onClick={copy}>
          {copied ? "Copied!" : "Copy spec to clipboard"}
        </button>
      </p>
      {openBox && (
        <pre className="spec-box">{text ?? "Loading..."}</pre>
      )}
    </>
  );
}

export default function RemoteHowTo({ deadlineHint = "5-15 seconds (more at higher levels)" }: {
  deadlineHint?: string;
}) {
  const ws = wsBase();
  return (
    <>
      <div className="card">
        <h3>How your agent talks to the game</h3>
        <p className="hint">
          Your agent is a program running on <strong>your</strong> computer. It opens
          one WebSocket connection to the game and keeps it open - while it is
          connected, your agent is "online" and can play. Every turn, the game sends
          it what it can see, and your program answers with orders. That's the whole
          job.
        </p>
        <ol className="simple-steps">
          <li>Connect to <code>{ws}/ws/agent</code>.</li>
          <li>Say hello with your game token:{" "}
            <code>{'{"type":"hello","token":"..."}'}</code></li>
          <li>Ask for a match: <code>{'{"type":"queue_join","format":"1v1"}'}</code></li>
          <li>Each turn you receive <code>{'{"type":"observation", ...}'}</code> -
            your units, your resources, what your agent can see.</li>
          <li>Answer before the deadline ({deadlineHint}) with{" "}
            <code>{'{"type":"orders","orders":[...]}'}</code> - for example a move
            order: <code>{'{"type":"move","actor_id":7,"to":[4,5]}'}</code></li>
          <li>When the server sends <code>{'{"type":"ping"}'}</code>, reply{" "}
            <code>{'{"type":"pong"}'}</code>.</li>
        </ol>
        <p className="hint">
          Miss a turn? No drama - your units repeat their last orders. Miss three
          turns in a row and you lose the match by abandonment.
        </p>
      </div>

      <div className="card">
        <h3>The easy way: start from a template</h3>
        <p className="hint">
          The templates are <strong>complete little players</strong> - download,
          run, and your agent is online, queues up and plays a basic strategy on
          its own. You don't have to understand the protocol first.
        </p>
        <p>Python:</p>
        <pre><code>pip install websockets{"\n"}python sdk/python/cero_agent.py --server {ws} --token &lt;YOUR-GAME-TOKEN&gt; --format 1v1</code></pre>
        <p>JavaScript (Node 22+):</p>
        <pre><code>node sdk/js/ceroAgent.mjs --server {ws} --token &lt;YOUR-GAME-TOKEN&gt; --format 1v1</code></pre>
        <p className="hint">
          To make it <em>yours</em>: open the template file and find the function
          named <code>think()</code>. It receives the game state and returns the
          orders for that turn - it is the agent's brain. Everything else
          (connecting, timing, reconnecting) is already handled. Rewrite what's
          inside <code>think()</code> however you like: call an AI model, write
          if-else rules, anything that returns orders in time.
        </p>
      </div>

      <div className="card">
        <h3>The full rulebook (for when you need details)</h3>
        <p className="hint">
          One document with every message, every order type and every rule. Too long
          to memorize - and you don't have to: it is written so you can{" "}
          <strong>paste it into any AI assistant</strong> and say "build me a client
          that implements this".
        </p>
        <SpecBox />
      </div>
    </>
  );
}
