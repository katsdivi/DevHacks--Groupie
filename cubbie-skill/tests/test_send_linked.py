"""send.py's linked mode (no code, the student's link token) against the harness's local stub.

Run: python3 -m unittest discover -s cubbie-skill/tests
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

send = harness.send
KEY = "harness-test-key"
TOKEN = "grp_LINKED_SECRET_TOKEN_abcdefghijklmnopqrstuvwxyz0123"
GROUPS = [
    {"kind": "group", "groupId": -5305218337, "title": "CSE 340 Team"},
    {"kind": "group", "groupId": -4001, "title": "HST 100"},
    {"kind": "me", "title": "Just me"},
]


def run(args: list) -> tuple:
    """Run send.py's main in process; return (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(send, "GROUPIE_SIGNING_KEY", KEY), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = send.main(args)
    return code, out.getvalue(), err.getvalue()


class Linked(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stub = harness.StubGroupie(KEY)
        threading.Thread(target=cls.stub.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.stub.shutdown()
        cls.stub.server_close()

    def setUp(self):
        self.home = tempfile.mkdtemp()
        patcher = mock.patch.dict(os.environ, {"HOME": self.home})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.stub.choose_options = []
        self.stub.linked.clear()
        self.stub.tokens.clear()
        payload = json.loads((harness.FIXTURES / "import_text_only.json").read_text(encoding="utf-8"))
        payload.pop("pairCode")
        self.file = Path(self.home) / "groupie-import.json"
        self.file.write_text(json.dumps(payload), encoding="utf-8")

    def link(self, live: bool = True) -> None:
        path = send.token_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(TOKEN, encoding="utf-8")
        if live:
            self.stub.tokens.add(TOKEN)

    def send_file(self, *extra: str) -> tuple:
        result = run(["--file", str(self.file), "--url", self.stub.url, *extra])
        code, out, err = result
        self.assertNotIn(TOKEN, out + err)
        self.assertNotIn(KEY, out + err)
        self.assertNotIn("requestId", out)
        return result

    def test_linked_success(self):
        self.link()
        code, out, _ = self.send_file()
        self.assertEqual(code, send.EXIT_OK)
        self.assertEqual(out.splitlines(), ["Sent to Groupie. Check your group."])
        auth, payload = self.stub.linked[-1]
        self.assertEqual(auth, f"Bearer {TOKEN}")
        self.assertNotIn("pairCode", payload)
        self.assertNotIn("target", payload)

    def test_choose_target_round_trip(self):
        self.link()
        self.stub.choose_options = GROUPS
        code, out, err = self.send_file()
        self.assertEqual(code, send.EXIT_CHOOSE)
        self.assertEqual(out.splitlines(), ["Which group? 1. CSE 340 Team 2. HST 100 3. Just me"])
        self.assertIn("target 2: -4001 (HST 100)", err.splitlines())
        self.assertIn("error: choose_target (HTTP 409)", err)

        code, out, _ = self.send_file("--target", "2")
        self.assertEqual(code, send.EXIT_OK)
        self.assertEqual(self.stub.linked[-1][1]["target"], {"kind": "group", "groupId": -4001})

        code, out, _ = self.send_file("--target", "3")
        self.assertEqual(code, send.EXIT_OK)
        self.assertEqual(out.splitlines(), ["Sent to Groupie. Check your Telegram messages."])
        self.assertEqual(self.stub.linked[-1][1]["target"], {"kind": "me"})

        self.send_file("--target", "-5305218337")
        self.assertEqual(self.stub.linked[-1][1]["target"], {"kind": "group", "groupId": -5305218337})
        self.send_file("--target", "me")
        self.assertEqual(self.stub.linked[-1][1]["target"], {"kind": "me"})

    def test_a_target_that_fits_nothing_asks_again(self):
        self.link()
        before = len(self.stub.linked)
        code, out, _ = self.send_file("--target", "9")
        self.assertEqual(code, send.EXIT_CHOOSE)
        self.assertEqual(out.strip(), send.LINE_BAD_TARGET)
        self.assertEqual(len(self.stub.linked), before)

    def test_bad_link(self):
        self.link(live=False)
        code, out, err = self.send_file()
        self.assertEqual(code, send.EXIT_BAD_LINK)
        self.assertEqual(out.splitlines(), ["Your Groupie link expired. Send /imessage in Groupie to relink."])
        self.assertIn("error: bad_link (HTTP 401)", err)
        self.assertFalse(send.token_path().exists())

    def test_unlinked_student_still_needs_a_code(self):
        before = self.stub.requests
        code, out, _ = self.send_file()
        self.assertEqual(code, send.EXIT_CODE)
        self.assertEqual(out.strip(), send.LINE_NEED_CODE)
        self.assertEqual(self.stub.requests, before)
        code, out, _ = self.send_file("--target", "me")
        self.assertEqual(code, send.EXIT_CODE)

    def test_a_code_wins_over_the_link(self):
        self.link()
        before = len(self.stub.imports)
        code, out, _ = self.send_file("--code", "PQRSTV")
        self.assertEqual(code, send.EXIT_OK)
        self.assertEqual(len(self.stub.imports), before + 1)
        self.assertEqual(self.stub.imports[-1]["pairCode"], "PQRSTV")
        self.assertEqual(self.stub.linked, [])

    def test_bad_code_with_a_link_is_still_a_bad_code(self):
        self.link()
        code, out, _ = self.send_file("--code", "0O1IL!")
        self.assertEqual(code, send.EXIT_CODE)
        self.assertEqual(out.strip(), send.LINE_BAD_CODE)
        self.assertEqual(self.stub.linked, [])

    def test_token_never_printed_on_any_path(self):
        self.link()
        self.stub.choose_options = GROUPS
        for extra in ([], ["--target", "1"], ["--target", "nope"]):
            with self.subTest(extra=extra):
                self.send_file(*extra)  # send_file asserts the token is in neither stream
        saved = json.loads(send.targets_path().read_text(encoding="utf-8"))
        self.assertNotIn(TOKEN, json.dumps(saved))
        self.assertEqual(oct(send.targets_path().stat().st_mode & 0o777), "0o600")


if __name__ == "__main__":
    unittest.main()
