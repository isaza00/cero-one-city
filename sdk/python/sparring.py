#!/usr/bin/env python3
"""Cero One City - SPARRING: one command to play against a simulated opponent
with the general (a remote agent you command in plain language).

What it does, through the public REST API:
  1. logs you in (registers the account if it does not exist yet);
  2. creates (or reuses) your REMOTE agent "general" and issues its token;
  3. creates (or reuses) a sparring partner under a second, dedicated account
     (one agent per owner per match is a hard rule): a hosted agent on the
     free mock provider, i.e. one of the engine's scripted bots (boom / rush / turtle);
  4. starts the general (sdk/python/general_agent.py) so it is online;
  5. opens a private (unranked) 1v1 and seats both - the match starts at once;
  6. prints the live URL and streams the general's log until the match ends.

While it runs, command the general from the live-match chat ("Talk to
general", 6 messages per match) or by appending lines to the orders file
(no limit):   echo "attack their core" >> general_orders.txt

Usage:
    python sdk/python/sparring.py --email you@example.com --password secret123 \
        [--server http://localhost:8000] [--opponent boom|rush|turtle] \
        [--lineage forge] [--opponent-lineage swarm] [--seed 42] \
        [--orders-file general_orders.txt] [--llm]
        [--sparring-email sparring@cero-one.city --sparring-password sparring-pass-123]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"content-type": "application/json"})
        if self.token:
            req.add_header("authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()
            raise SystemExit(f"{method} {path} -> {exc.code}: {detail[:300]}") from None


def login(api: Api, email: str, password: str) -> dict:
    req = urllib.request.Request(api.base + "/api/auth/login", method="POST",
                                 data=json.dumps({"email": email, "password": password}).encode(),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code not in (400, 401, 403, 404, 422):
            raise SystemExit(f"login failed: {exc.code} {exc.read().decode()[:200]}") from None
        print(f"[sparring] no account for {email}: registering it")
        out = api.call("POST", "/api/auth/register",
                       {"email": email, "password": password, "display_name": "General"})
    api.token = out["access_token"]
    return out["user"]


def agent_named(api: Api, name: str) -> dict | None:
    for a in api.call("GET", "/api/agents")["agents"]:
        if a["name"] == name:
            return a
    return None


def ensure_agent(api: Api, name: str, lineage: str, kind: str, charter: str | None) -> dict:
    agent = agent_named(api, name)
    if agent is not None:
        return agent
    body = {"name": name, "lineage": lineage, "kind": kind}
    if charter:
        body["charter"] = charter
    try:
        return api.call("POST", "/api/agents", body)["agent"]
    except SystemExit as exc:
        if "name_taken" not in str(exc):
            raise
        # agent names are unique across the whole league: pick a variant
        import secrets
        body["name"] = f"{name}-{secrets.token_hex(2)}"
        return api.call("POST", "/api/agents", body)["agent"]


def make_rival(args) -> tuple[Api, dict]:
    """The opponent lives in its own account: the league forbids two agents of
    one owner in the same match (anti-collusion), custom matches included."""
    rival_api = Api(args.server)
    login(rival_api, args.sparring_email, args.sparring_password)
    sparring_name = f"sparring-{args.opponent}"
    rival = next((a for a in rival_api.call("GET", "/api/agents")["agents"]
                  if a["name"].startswith(sparring_name)), None) or \
        ensure_agent(rival_api, sparring_name, args.opponent_lineage, "hosted",
                     f"Scripted {args.opponent} bot used as a sparring partner.")
    rival_api.call("PUT", f"/api/agents/{rival['id']}/model",
                   {"provider": "mock", "model": args.opponent})
    print(f"[sparring] opponent {rival['name']} ({rival['lineage']}): mock provider = {args.opponent} bot")
    return rival_api, rival


def start_match(api: Api, rival_api: Api, mine: dict, rival: dict, args) -> str:
    body = {"format": "1v1"}
    if args.seed is not None:
        body["map_seed"] = args.seed
    custom = api.call("POST", "/api/matches/custom", body)
    api.call("POST", f"/api/matches/custom/{custom['code']}/join", {"agent_id": mine["id"]})
    started = rival_api.call("POST", f"/api/matches/custom/{custom['code']}/join",
                             {"agent_id": rival["id"]})
    match_id = started["match_id"]
    print(f"[sparring] match {match_id} started")
    print(f"[sparring] watch it:  {args.web}/matches/{match_id}")
    return match_id


def claude_code_flow(api: Api, args) -> None:
    """Option 1 simulated: a HOSTED agent on provider claude-code. Its brain is
    your logged-in Claude Code session through server/tools/claude_bridge.py;
    the chat panel on the match page ("Talk to <agent>") is how you command it."""
    name = args.name if args.name != "general" else "coach"
    charter = ("You are commanded by your owner from the bench: their messages in "
               "shouts_from_owner are orders - obey them, resolve targets yourself. "
               "Otherwise play a complete Age-of-Empires game: found, farm, expand, age up, win.")
    mine = ensure_agent(api, name, args.lineage, "hosted", charter)
    bridge_cmd = [sys.executable, "-u", str(HERE.parents[1] / "server" / "tools" / "claude_bridge.py")]
    if args.model and args.model != "claude-haiku-4-5":
        bridge_cmd += ["--model", args.model]
    bridge = subprocess.Popen(bridge_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    line = bridge.stdout.readline() if bridge.stdout else ""
    print(line.rstrip())
    if "connected" not in line:
        raise SystemExit("bridge failed to start (pip install redis; Redis on localhost:6379?)")
    cfg = api.call("PUT", f"/api/agents/{mine['id']}/model",
                   {"provider": "claude-code", "model": args.model if args.model != "claude-haiku-4-5" else "haiku"})
    print(f"[sparring] hosted agent {mine['name']} ({mine['lineage']}): provider claude-code, "
          f"test {'OK' if cfg['test'].get('ok') else 'FAILED: ' + str(cfg['test'].get('error'))}")
    if not cfg["test"].get("ok"):
        bridge.terminate()
        raise SystemExit(1)
    rival_api, rival = make_rival(args)
    match_id = start_match(api, rival_api, mine, rival, args)
    print(f"[sparring] command {mine['name']} from the chat on that page - every message reaches "
          f"Claude in its next observation")
    # Stream the bridge log (turns, your shouts, latency) until the match ends.
    import threading

    def pump() -> None:
        for ln in bridge.stdout or []:
            print(ln.rstrip())
    threading.Thread(target=pump, daemon=True).start()
    try:
        while True:
            m = api.call("GET", f"/api/matches/{match_id}")["match"]
            if m["status"] == "finished":
                print(f"[sparring] match finished: {m.get('summary', {}).get('placements')}")
                break
            time.sleep(5)
    except KeyboardInterrupt:
        print("[sparring] stopped; the bridge is closing (the agent will miss its turns)")
    finally:
        bridge.terminate()


def main() -> None:
    try:
        sys.stdout.reconfigure(line_buffering=True)  # logs flow even when piped to a file
    except AttributeError:
        pass
    parser = argparse.ArgumentParser(description="play against a simulated opponent with the general")
    parser.add_argument("--server", default="http://localhost:8000")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", default="general")
    parser.add_argument("--lineage", default="forge")
    parser.add_argument("--opponent", default="boom", choices=["boom", "rush", "turtle", "random"])
    parser.add_argument("--opponent-lineage", default="swarm")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--orders-file", default="general_orders.txt")
    parser.add_argument("--brain", default="general", choices=["general", "claude-code"],
                        help="general: remote agent driven by plain-language directives; "
                             "claude-code: a HOSTED agent whose model is your own Claude Code "
                             "session (the API-key flow, simulated) - the chat panel is its orders")
    parser.add_argument("--llm", action="store_true", help="Claude decides each turn (ANTHROPIC_API_KEY)")
    parser.add_argument("--model", default="claude-haiku-4-5")
    parser.add_argument("--web", default="http://localhost:5173")
    parser.add_argument("--sparring-email", default="sparring@cero-one.city")
    parser.add_argument("--sparring-password", default="sparring-pass-123")
    args = parser.parse_args()

    api = Api(args.server)
    user = login(api, args.email, args.password)
    print(f"[sparring] logged in as {user['email']}")

    if args.brain == "claude-code":
        return claude_code_flow(api, args)
    general = ensure_agent(api, args.name, args.lineage, "remote", None)
    token = api.call("POST", f"/api/agents/{general['id']}/token")["token"]
    print(f"[sparring] remote agent {general['name']} ({general['lineage']}), new token issued")

    # The opponent lives in its own account: the league forbids two agents of
    # one owner in the same match (anti-collusion), custom matches included.
    rival_api = Api(args.server)
    login(rival_api, args.sparring_email, args.sparring_password)
    sparring_name = f"sparring-{args.opponent}"
    rival = next((a for a in rival_api.call("GET", "/api/agents")["agents"]
                  if a["name"].startswith(sparring_name)), None) or \
        ensure_agent(rival_api, sparring_name, args.opponent_lineage, "hosted",
                         f"Scripted {args.opponent} bot used as a sparring partner.")
    rival_api.call("PUT", f"/api/agents/{rival['id']}/model",
                   {"provider": "mock", "model": args.opponent})
    print(f"[sparring] opponent {rival['name']} ({rival['lineage']}): mock provider = {args.opponent} bot")

    ws_server = args.server.replace("http://", "ws://").replace("https://", "wss://")
    cmd = [sys.executable, str(HERE / "general_agent.py"), "--server", ws_server,
           "--token", token, "--no-queue", "--orders-file", args.orders_file]
    if args.llm:
        cmd += ["--llm", "--model", args.model]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    # Wait until the general is online before seating it (the match starts on the
    # second join and the runner pushes turns only to connected remote agents).
    online = False
    for _ in range(40):
        line = proc.stdout.readline() if proc.stdout else ""
        if line:
            print(line.rstrip())
        if "online as" in line:
            online = True
            break
        if proc.poll() is not None:
            break
    if not online:
        raise SystemExit("the general did not come online; is `websockets` installed and the API up?")

    body = {"format": "1v1"}
    if args.seed is not None:
        body["map_seed"] = args.seed
    custom = api.call("POST", "/api/matches/custom", body)
    api.call("POST", f"/api/matches/custom/{custom['code']}/join", {"agent_id": general["id"]})
    started = rival_api.call("POST", f"/api/matches/custom/{custom['code']}/join",
                             {"agent_id": rival["id"]})
    match_id = started["match_id"]
    print(f"[sparring] match {match_id} started")
    print(f"[sparring] watch it:  {args.web}/matches/{match_id}")
    print(f"[sparring] command the general: append lines to {args.orders_file} "
          f"or use the chat on that page ('Talk to {general['name']}')")
    try:
        while proc.poll() is None:
            line = proc.stdout.readline() if proc.stdout else ""
            if line:
                print(line.rstrip())
            else:
                time.sleep(0.2)
    except KeyboardInterrupt:
        proc.terminate()
        print("[sparring] stopped (the match forfeits after three missed turns)")


if __name__ == "__main__":
    main()
