"""Unit tests for scripts/status.py. Run: python3 -m unittest discover -s cubbie-skill/tests"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SKILL = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("groupie_status_under_test", SKILL / "scripts" / "status.py")
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)
g = status.g
SAMPLE = json.loads((SKILL / "assets" / "sample_status.json").read_text())

TOKEN = "grp_SECRET_TOKEN_VALUE_1234567890abcdefghijklmnop"


def quiet(fn, *args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        return fn(*args), out.getvalue().strip()


class TempHome(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        patcher = mock.patch.dict(os.environ, {"HOME": self.home})
        patcher.start()
        self.addCleanup(patcher.stop)

    def reply(self, code: int, body: dict):
        seen = {}

        def fake(method, url, headers, body_bytes=None):
            seen.update(method=method, url=url, headers=headers)
            return code, json.dumps(body).encode("utf-8")

        return seen, mock.patch.object(g, "request", fake)


class Status(TempHome):
    def test_not_linked_without_a_token(self):
        with mock.patch.object(g, "request") as request:
            code, line = quiet(status.main, [])
        self.assertEqual(code, g.EXIT_NOT_LINKED)
        self.assertIn("/imessage", line)
        self.assertIn("@CubbieGroupieBot", line)
        request.assert_not_called()

    def test_reads_the_token_and_prints_a_short_summary(self):
        g.save_token(TOKEN)
        seen, patch = self.reply(200, SAMPLE)
        with patch:
            code, line = quiet(status.main, ["--url", "http://stub.test"])
        self.assertEqual(code, 0)
        self.assertEqual(seen["method"], "GET")
        self.assertEqual(seen["url"], "http://stub.test/api/cubbie/me")
        self.assertEqual(seen["headers"]["Authorization"], f"Bearer {TOKEN}")
        self.assertNotIn(TOKEN, line)
        self.assertIn("Groupie: 2 tasks left", line)
        self.assertIn("- Write the requirements (5 pt, on track)", line)
        self.assertIn("Next meeting: Tue, Oct 28, 4:00 to 5:00 PM, Zoom\nhttps://zoom.us/j/123456789", line)
        self.assertIn("- CSE 340 (Fall 2026): Lab 4, Sun Oct 26, 11:59 PM", line)
        self.assertNotIn("**", line)
        self.assertLess(len(line), 1500)

    def test_long_status_stays_under_1500_characters(self):
        big = json.loads(json.dumps(SAMPLE))
        big["groups"] = [dict(SAMPLE["groups"][0], title=f"Team {i} " + "x" * 80) for i in range(20)]
        text = status.summary(big)
        self.assertLessEqual(len(text), 1500)
        self.assertTrue(text.endswith("(more in Telegram)"))

    def test_empty_status(self):
        text = status.summary({"summary": "0 tasks left, 0 things due in the next 7 days", "groups": [], "upcoming": []})
        self.assertIn("no group projects yet", text)

    def test_revoked_token_is_deleted(self):
        g.save_token(TOKEN)
        _, patch = self.reply(401, {"error": "not_linked"})
        with patch:
            code, line = quiet(status.main, [])
        self.assertEqual(code, g.EXIT_NOT_LINKED)
        self.assertIsNone(g.read_token())
        self.assertNotIn(TOKEN, line)

    def test_exit_codes(self):
        for code_in, want in ((429, g.EXIT_RATE), (500, g.EXIT_SERVER), (503, g.EXIT_SERVER)):
            g.save_token(TOKEN)
            _, patch = self.reply(code_in, {})
            with self.subTest(status=code_in), patch:
                code, line = quiet(status.main, [])
                self.assertEqual(code, want)
                self.assertNotIn(TOKEN, line)
                self.assertEqual(g.read_token(), TOKEN)

    def test_network_down(self):
        g.save_token(TOKEN)
        with mock.patch.object(g.urllib.request, "urlopen", side_effect=OSError("down")):
            code, _ = quiet(status.main, ["--url", "http://127.0.0.1:9"])
        self.assertEqual(code, g.EXIT_NETWORK)

    def test_sample_reads_no_token_and_sends_nothing(self):
        with mock.patch.object(g, "request") as request, mock.patch.object(g, "read_token") as read:
            code, line = quiet(status.main, ["--sample"])
        self.assertEqual(code, 0)
        request.assert_not_called()
        read.assert_not_called()
        self.assertIn("CSE 340 Team", line)


class Unlink(TempHome):
    def test_unlink_deletes_on_the_server_and_here(self):
        g.save_token(TOKEN)
        seen, patch = self.reply(200, {"ok": True})
        with patch:
            code, line = quiet(status.main, ["--unlink", "--url", "http://stub.test"])
        self.assertEqual(code, 0)
        self.assertEqual(seen["method"], "DELETE")
        self.assertEqual(seen["url"], "http://stub.test/api/cubbie/link")
        self.assertIsNone(g.read_token())
        self.assertNotIn(TOKEN, line)

    def test_unlink_when_already_revoked(self):
        g.save_token(TOKEN)
        _, patch = self.reply(401, {})
        with patch:
            code, _ = quiet(status.main, ["--unlink"])
        self.assertEqual(code, 0)
        self.assertIsNone(g.read_token())

    def test_unlink_without_a_token(self):
        with mock.patch.object(g, "request") as request:
            code, line = quiet(status.main, ["--unlink"])
        self.assertEqual(code, 0)
        request.assert_not_called()
        self.assertIn("was not linked", line)

    def test_unlink_keeps_the_token_when_the_server_fails(self):
        g.save_token(TOKEN)
        _, patch = self.reply(500, {})
        with patch:
            code, _ = quiet(status.main, ["--unlink"])
        self.assertEqual(code, g.EXIT_SERVER)
        self.assertEqual(g.read_token(), TOKEN)


if __name__ == "__main__":
    unittest.main()
