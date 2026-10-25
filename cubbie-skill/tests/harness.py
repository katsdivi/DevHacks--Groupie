#!/usr/bin/env python3
"""Replay the Cubbie import fixtures through scripts/send.py and print what happened to each one.

Offline (default): starts a stub Groupie server on a random local port that checks the HMAC signature over the
raw body, enforces single-use codes, and answers with contract-shaped responses. Every result is asserted, so
exit 0 means signing and the exit code mapping work.

    python3 tests/harness.py
    python3 tests/harness.py --url http://localhost:3000 --code K7Q2MX --key "$CUBBIE_HMAC_SECRET"

With --url the fixtures go to that server instead and the results are printed, not asserted (except that the
malformed fixture must be rejected before sending). Codes are single use, so against a real server only the first
fixture can succeed; make a fresh code with /canvas for each run.

Run from the repo root or from cubbie-skill/; fixtures are read from <repo>/fixtures/cubbie/.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import hmac
import importlib.util
import io
import json
import os
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
SEND_PATH = SKILL / "scripts" / "send.py"
FIXTURES = SKILL.parent / "fixtures" / "cubbie"

# Reserved codes the stub treats specially (all from the pair code alphabet).
UNKNOWN_CODE, EXPIRED_CODE, BUSY_CODE, RATE_CODE = "ZZZZZZ", "XXXXXX", "NNNNNN", "RRRRRR"


def load_send():
    spec = importlib.util.spec_from_file_location("groupie_send", SEND_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


send = load_send()


class StubGroupie(ThreadingHTTPServer):
    """A tiny stand-in for POST /api/cubbie/import."""

    daemon_threads = True

    def __init__(self, key: str):
        super().__init__(("127.0.0.1", 0), StubHandler)
        self.key = key.encode("utf-8")
        self.used = set()
        self.requests = 0
        self.lock = threading.Lock()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


class StubHandler(BaseHTTPRequestHandler):
    server: StubGroupie

    def log_message(self, *args) -> None:  # keep the harness output short
        pass

    def reply(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self) -> None:
        with self.server.lock:
            self.server.requests += 1
        if self.path != send.IMPORT_PATH:
            return self.reply(404, {"error": "not_found", "message": "No such route."})
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        expected = "sha256=" + hmac.new(self.server.key, raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, self.headers.get("X-Groupie-Signature") or ""):
            return self.reply(401, {"error": "bad_signature", "message": "Signature does not match."})
        if self.headers.get("Content-Type") != "application/json":
            return self.reply(400, {"error": "bad_payload", "message": "Expected JSON."})
        try:
            payload = json.loads(raw)
        except ValueError:
            return self.reply(400, {"error": "bad_payload", "message": "Body is not JSON."})
        if send.validate(payload):
            return self.reply(400, {"error": "bad_payload", "message": "Payload does not match the contract."})
        code = payload["pairCode"]
        if code != code.upper():
            return self.reply(400, {"error": "bad_payload", "message": "Code was not uppercased."})
        if code == RATE_CODE:
            return self.reply(429, {"error": "rate_limited", "message": "Too many imports."})
        if code == UNKNOWN_CODE:
            return self.reply(404, {"error": "unknown_code", "message": "No such code."})
        if code == EXPIRED_CODE:
            return self.reply(409, {"error": "code_expired", "message": "Code expired."})
        if code == BUSY_CODE:
            return self.reply(409, {"error": "not_expecting", "message": "The group already has its assignment."})
        with self.server.lock:
            if code in self.server.used:
                return self.reply(409, {"error": "code_used", "message": "Code already used."})
            self.server.used.add(code)
            import_id = len(self.server.used)
        self.reply(200, {"ok": True, "importId": import_id, "message": "Sent to Groupie. Check your group."})


def run_send(args: list, key: str) -> tuple:
    """Run send.py's main in process with the given key; return (exit code, printed line)."""
    send.GROUPIE_SIGNING_KEY = key
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        code = send.main(args)
    return code, out.getvalue().strip()


def closed_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def offline(code: str, key: str) -> int:
    stub = StubGroupie(key)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    full, text_only, malformed = (str(FIXTURES / f"import_{name}.json") for name in ("full", "text_only", "malformed"))
    lower = code.lower()
    cases = [
        # (label, args, key, expected exit code)
        ("import_full.json", ["--file", full, "--code", lower], key, send.EXIT_OK),
        ("import_text_only.json (same code again)", ["--file", text_only, "--code", code], key, send.EXIT_FRESH_CODE),
        ("import_malformed.json (rejected before sending)", ["--file", malformed, "--code", code], key, send.EXIT_PAYLOAD),
        ("import_malformed.json, its own bad code", ["--file", malformed], key, send.EXIT_CODE),
        ("import_text_only.json, wrong key", ["--file", text_only, "--code", "HJKMNP"], key + "x", send.EXIT_SIGNATURE),
        ("import_text_only.json, unknown code", ["--file", text_only, "--code", UNKNOWN_CODE], key, send.EXIT_FRESH_CODE),
        ("import_text_only.json, expired code", ["--file", text_only, "--code", EXPIRED_CODE], key, send.EXIT_FRESH_CODE),
        ("import_text_only.json, group not expecting", ["--file", text_only, "--code", BUSY_CODE], key, send.EXIT_NOT_EXPECTING),
        ("import_text_only.json, rate limited", ["--file", text_only, "--code", RATE_CODE], key, send.EXIT_RATE),
        ("sample payload, fresh code", ["--sample", "--code", "HJKMNP"], key, send.EXIT_OK),
    ]
    failures = 0
    print(f"Stub Groupie at {stub.url}")
    for label, args, use_key, expected in cases:
        got, line = run_send(args + ["--url", stub.url], use_key)
        ok = got == expected
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {label}: exit {got} (want {expected})  {line}")
    before = stub.requests
    run_send(["--file", malformed, "--code", code, "--url", stub.url], key)
    if stub.requests != before:
        failures += 1
        print("FAIL  the malformed fixture reached the server")
    else:
        print("PASS  the malformed fixture never reached the server")
    got, line = run_send(["--file", text_only, "--code", "PQRSTU", "--url", f"http://127.0.0.1:{closed_port()}"], key)
    ok = got == send.EXIT_NETWORK
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'}  server down (one retry): exit {got} (want {send.EXIT_NETWORK})  {line}")
    stub.shutdown()
    print(f"{'All passed' if not failures else f'{failures} failed'} ({stub.requests} requests reached the stub)")
    return 1 if failures else 0


def online(url: str, code: str, key: str) -> int:
    failures = 0
    for name in ("full", "text_only", "malformed"):
        got, line = run_send(["--file", str(FIXTURES / f"import_{name}.json"), "--code", code, "--url", url], key)
        print(f"import_{name}.json: exit {got}  {line}")
        if name == "malformed" and got != send.EXIT_PAYLOAD:
            failures += 1
            print("FAIL  the malformed fixture should be rejected before sending")
    return 1 if failures else 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", help="a running Groupie server, for example http://localhost:3000 (default: offline stub)")
    parser.add_argument("--code", default="K7Q2MX", help="pair code to put in every fixture (default K7Q2MX)")
    parser.add_argument("--key", default=os.environ.get("CUBBIE_HMAC_SECRET") or "harness-test-key",
                        help="signing key (default $CUBBIE_HMAC_SECRET, else a test key)")
    args = parser.parse_args(argv)
    code = send.normalize_code(args.code)
    if code is None:
        print("--code must be 6 characters from ABCDEFGHJKMNPQRSTUVWXYZ23456789", file=sys.stderr)
        return 2
    return online(args.url, args.code, args.key) if args.url else offline(code, args.key)


if __name__ == "__main__":
    sys.exit(main())
