#!/usr/bin/env python3
"""Replay the Cubbie import fixtures through scripts/send.py and print what happened to each one.

It also runs the iMessage link flow offline: scripts/link.py against a stub POST /api/cubbie/link, then
scripts/status.py against stub GET /api/cubbie/me and DELETE /api/cubbie/link, with HOME in a temporary folder.

Offline (default): starts a stub Groupie server on a random local port that checks the HMAC signature over the
raw body, enforces single-use codes, and answers with contract-shaped responses. Every result is asserted, so
exit 0 means signing and the exit code mapping work.

    python3 tests/harness.py
    python3 tests/harness.py --url http://localhost:3000 --code K7Q2MX --key "$CUBBIE_PUBLIC_SIGNING_KEY"

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
import secrets
import socket
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
SEND_PATH = SKILL / "scripts" / "send.py"
FIXTURES = SKILL.parent / "fixtures" / "cubbie"

# Reserved codes the stub treats specially (all from the pair code alphabet).
UNKNOWN_CODE, EXPIRED_CODE, BUSY_CODE, RATE_CODE = "ZZZZZZ", "XXXXXX", "NNNNNN", "RRRRRR"
SERVER_ERROR_CODE, INVALID_CODE, NOT_JSON_CODE, ODD_ERROR_CODE = "SSSSSS", "VVVVVV", "HHHHHH", "QQQQQQ"
# BIG_CODE: 413 while the payload has attachments, then a normal import. ALWAYS_BIG_CODE: 413 every time.
BIG_CODE, ALWAYS_BIG_CODE = "BBBBBB", "TTTTTT"
# Import error replies carry this requestId, so tests can check it reaches stderr and never stdout.
STUB_REQUEST_ID = "stub-req-0001"


def load_send():
    spec = importlib.util.spec_from_file_location("groupie_send", SEND_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


send = load_send()


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(f"groupie_{name}_harness", SKILL / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


link_cli = load_script("link")
status_cli = load_script("status")
SAMPLE_STATUS = json.loads((SKILL / "assets" / "sample_status.json").read_text(encoding="utf-8"))


class StubGroupie(ThreadingHTTPServer):
    """A tiny stand-in for POST /api/cubbie/import."""

    daemon_threads = True

    def __init__(self, key: str):
        super().__init__(("127.0.0.1", 0), StubHandler)
        self.key = key.encode("utf-8")
        self.used = set()
        self.tokens = set()
        self.requests = 0
        self.imports = []  # every parsed import payload, in order
        self.linked = []  # every linked import: (Authorization header, parsed payload)
        self.choose_options = []  # when set, a linked import with no target answers choose_target with these
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

    def fail(self, status: int, error: str, message: str) -> None:
        """An import error in the server's documented shape: { error, message, requestId }."""
        self.reply(status, {"error": error, "message": message, "requestId": STUB_REQUEST_ID})

    def bearer(self):
        header = self.headers.get("Authorization") or ""
        token = header[7:] if header.startswith("Bearer ") else ""
        with self.server.lock:
            return token if token in self.server.tokens else None

    def do_GET(self) -> None:
        with self.server.lock:
            self.server.requests += 1
        if self.path != "/api/cubbie/me":
            return self.reply(404, {"error": "not_found", "message": "No such route."})
        if not self.bearer():
            return self.reply(401, {"error": "not_linked", "message": "Not linked."})
        self.reply(200, SAMPLE_STATUS)

    def do_DELETE(self) -> None:
        with self.server.lock:
            self.server.requests += 1
        if self.path != "/api/cubbie/link":
            return self.reply(404, {"error": "not_found", "message": "No such route."})
        token = self.bearer()
        if not token:
            return self.reply(401, {"error": "not_linked", "message": "Not linked."})
        with self.server.lock:
            self.server.tokens.discard(token)
        self.reply(200, {"ok": True, "message": "Unlinked from Groupie."})

    def link(self, raw: bytes) -> None:
        try:
            code = send.normalize_code(json.loads(raw).get("pairCode"))
        except (ValueError, AttributeError):
            code = None
        if code is None:
            return self.reply(400, {"error": "bad_payload", "message": "pairCode must be a code."})
        if code == UNKNOWN_CODE:
            return self.reply(404, {"error": "unknown_code", "message": "No such code."})
        with self.server.lock:
            if code in self.server.used:
                return self.reply(409, {"error": "code_used", "message": "Code already used."})
            self.server.used.add(code)
            token = "grp_" + secrets.token_urlsafe(32)
            self.server.tokens.add(token)
        self.reply(200, {"ok": True, "token": token, "name": "Ana", "message": "Linked to Groupie."})

    def do_POST(self) -> None:
        with self.server.lock:
            self.server.requests += 1
        if self.path not in (send.IMPORT_PATH, send.LINKED_PATH, "/api/cubbie/link"):
            return self.reply(404, {"error": "not_found", "message": "No such route."})
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        expected = "sha256=" + hmac.new(self.server.key, raw, hashlib.sha256).hexdigest()
        is_import = self.path in (send.IMPORT_PATH, send.LINKED_PATH)
        if not hmac.compare_digest(expected, self.headers.get("X-Groupie-Signature") or ""):
            if is_import:
                return self.fail(401, "bad_signature", "Signature does not match.")
            return self.reply(401, {"error": "bad_signature", "message": "Signature does not match."})
        if self.headers.get("Content-Type") != "application/json":
            return self.reply(400, {"error": "bad_payload", "message": "Expected JSON."})
        if self.path == "/api/cubbie/link":
            return self.link(raw)
        if self.path == send.LINKED_PATH:
            return self.linked_import(raw)
        try:
            payload = json.loads(raw)
        except ValueError:
            return self.fail(400, "invalid_payload", "Body is not JSON.")
        if send.validate(payload):
            return self.fail(400, "invalid_payload", "Payload does not match the contract.")
        code = payload["pairCode"]
        if code != code.upper():
            return self.fail(400, "invalid_payload", "Code was not uppercased.")
        with self.server.lock:
            self.server.imports.append(payload)
        if code == RATE_CODE:
            return self.fail(429, "rate_limited", "Too many imports.")
        if code == UNKNOWN_CODE:
            return self.fail(404, "code_unknown", "No such code.")
        if code == EXPIRED_CODE:
            return self.fail(410, "code_expired", "Code expired.")
        if code == BUSY_CODE:
            return self.fail(409, "not_expecting", "The group already has its assignment.")
        if code == SERVER_ERROR_CODE:
            return self.fail(500, "server_error", "Something broke.")
        if code == INVALID_CODE:
            return self.fail(422, "invalid_payload", "Could not use this assignment.")
        if code == ODD_ERROR_CODE:
            return self.fail(422, "no_team_size", "Set the team size first.")
        if code == NOT_JSON_CODE:
            html = b"<html><body>502 Bad Gateway</body></html>"
            self.send_response(502)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return None
        if code == ALWAYS_BIG_CODE or (code == BIG_CODE and payload.get("attachments")):
            return self.fail(413, "payload_too_large", "Too large.")
        with self.server.lock:
            if code in self.server.used:
                return self.fail(409, "code_used", "Code already used.")
            self.server.used.add(code)
            import_id = len(self.server.used)
        self.reply(200, {"ok": True, "importId": import_id, "message": "Sent to Groupie. Check your group."})

    def linked_import(self, raw: bytes) -> None:
        """POST /api/cubbie/import/linked: a live bearer token, then choose_target or a normal import."""
        if not self.bearer():
            return self.fail(401, "bad_link", "Link not found.")
        try:
            payload = json.loads(raw)
        except ValueError:
            return self.fail(400, "invalid_payload", "Body is not JSON.")
        if "pairCode" in payload or send.validate(payload, linked=True):
            return self.fail(400, "invalid_payload", "Payload does not match the linked contract.")
        with self.server.lock:
            self.server.linked.append((self.headers.get("Authorization"), payload))
            options = list(self.server.choose_options)
        if options and "target" not in payload:
            body = {"error": "choose_target", "message": "Which group should this go to?", "options": options,
                    "requestId": STUB_REQUEST_ID}
            return self.reply(409, body)
        message = "Sent to Groupie. Check your Telegram messages." if payload.get("target", {}).get("kind") == "me" \
            else "Sent to Groupie. Check your group."
        self.reply(200, {"ok": True, "importId": len(self.server.linked), "message": message})


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
        ("import_text_only.json (same code again)", ["--file", text_only, "--code", code], key, send.EXIT_CODE_USED),
        ("import_malformed.json (rejected before sending)", ["--file", malformed, "--code", code], key, send.EXIT_PAYLOAD),
        ("import_malformed.json, its own bad code", ["--file", malformed], key, send.EXIT_CODE),
        ("import_text_only.json, wrong key", ["--file", text_only, "--code", "HJKMNP"], key + "x", send.EXIT_SIGNATURE),
        ("import_text_only.json, unknown code", ["--file", text_only, "--code", UNKNOWN_CODE], key, send.EXIT_FRESH_CODE),
        ("import_text_only.json, expired code", ["--file", text_only, "--code", EXPIRED_CODE], key, send.EXIT_FRESH_CODE),
        ("import_text_only.json, group not expecting", ["--file", text_only, "--code", BUSY_CODE], key, send.EXIT_NOT_EXPECTING),
        ("import_text_only.json, rate limited", ["--file", text_only, "--code", RATE_CODE], key, send.EXIT_RATE),
        ("import_text_only.json, server error", ["--file", text_only, "--code", SERVER_ERROR_CODE], key, send.EXIT_SERVER),
        ("import_text_only.json, invalid payload", ["--file", text_only, "--code", INVALID_CODE], key, send.EXIT_BAD_PAYLOAD),
        ("import_text_only.json, unlisted error code", ["--file", text_only, "--code", ODD_ERROR_CODE], key, send.EXIT_SERVER),
        ("import_text_only.json, HTML body", ["--file", text_only, "--code", NOT_JSON_CODE], key, send.EXIT_SERVER),
        ("sample payload, too big, sent as text", ["--sample", "--code", BIG_CODE], key, send.EXIT_OK),
        ("sample payload, too big even as text", ["--sample", "--code", ALWAYS_BIG_CODE], key, send.EXIT_TOO_LARGE),
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
    failures += offline_link(stub, key)
    stub.shutdown()
    print(f"{'All passed' if not failures else f'{failures} failed'} ({stub.requests} requests reached the stub)")
    return 1 if failures else 0


def run_cli(module, args: list, key: str) -> tuple:
    """Run link.py or status.py in process; return (exit code, printed text)."""
    module.send.GROUPIE_SIGNING_KEY = key
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        code = module.main(args)
    return code, out.getvalue().strip()


def offline_link(stub: StubGroupie, key: str) -> int:
    """Link, status, unlink, status again, all against the stub with a throwaway HOME."""
    home = tempfile.mkdtemp()
    old_home = os.environ.get("HOME")
    os.environ["HOME"] = home
    url = ["--url", stub.url]
    failures = 0
    try:
        cases = [
            ("status before linking", status_cli, [], key, 12, "/imessage"),
            ("link, wrong key", link_cli, ["--code", "MNKCDE"], key + "x", 7, "signature"),
            ("link with a fresh code", link_cli, ["--code", "mnkcde"], key, 0, "Linked to Groupie, Ana."),
            ("link, same code again", link_cli, ["--code", "MNKCDE"], key, 8, "used"),
            ("link, unknown code", link_cli, ["--code", UNKNOWN_CODE], key, 8, "unknown"),
            ("status", status_cli, [], key, 0, "Next meeting:"),
            ("unlink", status_cli, ["--unlink"], key, 0, "Unlinked"),
            ("status after unlinking", status_cli, [], key, 12, "Not linked"),
        ]
        for label, module, args, use_key, expected, needle in cases:
            got, text = run_cli(module, args + url, use_key)
            tokens = list(stub.tokens)
            ok = got == expected and needle in text and not any(t in text for t in tokens)
            failures += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {label}: exit {got} (want {expected})  {text.splitlines()[0] if text else ''}")
        token_file = Path(home) / ".config" / "groupie" / "token"
        ok = not token_file.exists()
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  the token file is gone after unlinking")
    finally:
        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home
    return failures


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
    parser.add_argument("--key", default=os.environ.get("CUBBIE_PUBLIC_SIGNING_KEY") or "harness-test-key",
                        help="signing key (default $CUBBIE_PUBLIC_SIGNING_KEY, else a test key)")
    args = parser.parse_args(argv)
    code = send.normalize_code(args.code)
    if code is None:
        print("--code must be 6 characters from ABCDEFGHJKMNPQRSTUVWXYZ23456789", file=sys.stderr)
        return 2
    return online(args.url, args.code, args.key) if args.url else offline(code, args.key)


if __name__ == "__main__":
    sys.exit(main())
