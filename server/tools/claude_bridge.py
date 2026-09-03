#!/usr/bin/env python3
"""Claude Code bridge: lets the owner's own Claude Code session play as a hosted
agent - the API-key flow, simulated, with no key.

How it fits:
  agent model config  provider="claude-code", model="haiku|sonnet|opus"
  worker (Docker)     providers._claude_code_bridge() pushes each turn's prompt
                      to the Redis list `llm:bridge:req` and waits on
                      `llm:bridge:res:<id>` (relaxed deadline, settings.local_model_deadline_s)
  THIS SCRIPT (host)  pops the request, runs `claude -p` non-interactively with
                      the same rules digest hosted agents get, pushes the reply.

Run it on the machine where `claude` is installed and logged in, next to the
compose stack (Redis on localhost:6379):

    python server/tools/claude_bridge.py [--redis redis://localhost:6379/0] [--model haiku]

Every turn is logged here: the turn number, the owner's shouts inside the
observation (your orders from the bench), the model's latency and how many
orders came back. Nothing is stored in the cost ledger (no key, no price).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

REQ_KEY = "llm:bridge:req"
RES_KEY = "llm:bridge:res:{id}"
TOOLS_OFF = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch",
             "Agent", "NotebookEdit"]


def ask_claude(system: str, user: str, model: str, timeout_s: float, workdir: str) -> str:
    """One non-interactive Claude Code call; returns the raw reply text."""
    cmd = [shutil.which("claude") or "claude", "-p", user,
           "--append-system-prompt", system, "--model", model,
           "--output-format", "text", "--no-session-persistence",
           "--disallowedTools", *TOOLS_OFF]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s, cwd=workdir,
                          env={**os.environ, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"})
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip()[:300] or f"claude exited {proc.returncode}")
    return proc.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description="Claude Code bridge for provider claude-code")
    parser.add_argument("--redis", default=os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    parser.add_argument("--model", default=None,
                        help="override the model the agent config asks for (haiku|sonnet|opus)")
    args = parser.parse_args()
    try:
        import redis
    except ImportError:
        raise SystemExit("pip install redis") from None
    r = redis.from_url(args.redis)
    r.ping()
    workdir = tempfile.mkdtemp(prefix="cero-bridge-")  # an empty cwd: no repo context leaks in
    print(f"[bridge] connected to {args.redis}; waiting for turns (ctrl-c to stop)", flush=True)
    while True:
        item = r.blpop(REQ_KEY, timeout=5)
        if not item:
            continue
        req = json.loads(item[1])
        t0 = time.perf_counter()
        turn = re.match(r"Turn (\d+)/(\d+)", req["user"])
        label = f"T{turn.group(1)}/{turn.group(2)}" if turn else "call"
        shouts = []
        m = re.search(r'"shouts_from_owner":(\[[^\]]*\])', req["user"])
        if m:
            try:
                shouts = json.loads(m.group(1))
            except json.JSONDecodeError:
                shouts = []
        for s in shouts:
            print(f"[bridge] {label} order from the bench: \"{s}\"", flush=True)
        model = args.model or req.get("model") or "haiku"
        # accept full ids too ("claude-haiku-4-5" -> "haiku")
        for alias in ("haiku", "sonnet", "opus"):
            if alias in model:
                model = alias
                break
        budget = max(5.0, float(req.get("timeout_s", 40)) - 2.0)
        try:
            text = ask_claude(req["system"], req["user"], model, budget, workdir)
            start, end = text.find("{"), text.rfind("}")
            n = 0
            if start >= 0:
                try:
                    n = len(json.loads(text[start:end + 1]).get("orders", []))
                except json.JSONDecodeError:
                    n = -1
            print(f"[bridge] {label} {model}: {n if n >= 0 else 'malformed'} orders in "
                  f"{(time.perf_counter() - t0) * 1000:.0f} ms", flush=True)
        except subprocess.TimeoutExpired:
            text = ""
            print(f"[bridge] {label} {model}: too slow (> {budget:.0f}s) - turn lost", flush=True)
        except Exception as exc:  # the worker treats an empty reply as a lost turn
            text = ""
            print(f"[bridge] {label} error: {exc}", flush=True)
        key = RES_KEY.format(id=req["id"])
        r.rpush(key, text)
        r.expire(key, 120)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
