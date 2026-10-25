"""Unit tests for scripts/link.py. Run: python3 -m unittest discover -s cubbie-skill/tests"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import importlib.util
import io
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SKILL = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("groupie_link_cli_under_test", SKILL / "scripts" / "link.py")
link = importlib.util.module_from_spec(spec)
spec.loader.exec_module(link)
g = link.g

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

    def reply(self, status: int, body: dict):
        seen = {}

        def fake(method, url, headers, body_bytes=None):
            seen.update(method=method, url=url, headers=headers, body=body_bytes)
            return status, json.dumps(body).encode("utf-8")

        return seen, mock.patch.object(g, "request", fake)


class Linking(TempHome):
    def test_signs_the_body_and_saves_the_token_with_mode_600(self):
        seen, patch = self.reply(200, {"ok": True, "token": TOKEN, "name": "Ana", "message": "Linked"})
        with patch, mock.patch.object(link.send, "GROUPIE_SIGNING_KEY", "k"):
            code, line = quiet(link.main, ["--code", " k7q2mx ", "--url", "http://stub.test/"])
        self.assertEqual(code, 0)
        self.assertEqual(line, 'Linked to Groupie, Ana. Text me "Groupie status" any time.')
        self.assertEqual(seen["method"], "POST")
        self.assertEqual(seen["url"], "http://stub.test/api/cubbie/link")
        self.assertEqual(json.loads(seen["body"]), {"pairCode": "K7Q2MX"})
        expected = "sha256=" + hmac.new(b"k", seen["body"], hashlib.sha256).hexdigest()
        self.assertEqual(seen["headers"]["X-Groupie-Signature"], expected)
        path = Path(self.home) / ".config" / "groupie" / "token"
        self.assertEqual(path.read_text(), TOKEN)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)

    def test_never_prints_the_token(self):
        _, patch = self.reply(200, {"ok": True, "token": TOKEN, "name": None, "message": "Linked"})
        with patch:
            code, line = quiet(link.main, ["--code", "K7Q2MX"])
        self.assertEqual(code, 0)
        self.assertNotIn(TOKEN, line)
        self.assertEqual(line, 'Linked to Groupie. Text me "Groupie status" any time.')

    def test_replaces_an_old_token(self):
        g.save_token("grp_old")
        _, patch = self.reply(200, {"ok": True, "token": TOKEN, "name": "Ana", "message": "Linked"})
        with patch:
            quiet(link.main, ["--code", "K7Q2MX"])
        self.assertEqual(g.read_token(), TOKEN)

    def test_exit_codes(self):
        cases = [
            (401, {"error": "bad_signature"}, link.g.EXIT_SIGNATURE),
            (404, {"error": "unknown_code"}, link.g.EXIT_FRESH_CODE),
            (409, {"error": "code_used"}, link.g.EXIT_FRESH_CODE),
            (409, {"error": "code_expired"}, link.g.EXIT_FRESH_CODE),
            (429, {"error": "rate_limited"}, link.g.EXIT_RATE),
            (500, {}, link.g.EXIT_SERVER),
            (200, {"ok": True}, link.g.EXIT_SERVER),
        ]
        for status, body, want in cases:
            _, patch = self.reply(status, body)
            with self.subTest(status=status, body=body), patch:
                code, _ = quiet(link.main, ["--code", "K7Q2MX"])
                self.assertEqual(code, want)
        self.assertIsNone(g.read_token())

    def test_bad_code_sends_nothing(self):
        with mock.patch.object(g, "request") as request:
            code, line = quiet(link.main, ["--code", "K7Q2M0"])
        self.assertEqual(code, link.g.EXIT_CODE)
        request.assert_not_called()
        self.assertIn("6 letters and digits", line)

    def test_missing_code_is_an_argument_error(self):
        code, _ = quiet(link.main, [])
        self.assertEqual(code, link.g.EXIT_ARGS)

    def test_sample_sends_and_saves_nothing(self):
        with mock.patch.object(g, "request") as request:
            code, line = quiet(link.main, ["--code", "K7Q2MX", "--sample"])
        self.assertEqual(code, 0)
        request.assert_not_called()
        self.assertIn("Nothing was sent or saved", line)
        self.assertFalse((Path(self.home) / ".config").exists())

    def test_network_error_after_one_retry(self):
        calls = []

        def down(*args, **kwargs):
            calls.append(1)
            raise OSError("refused")

        with mock.patch.object(g.urllib.request, "urlopen", down):
            code, _ = quiet(link.main, ["--code", "K7Q2MX", "--url", "http://127.0.0.1:9"])
        self.assertEqual(code, link.g.EXIT_NETWORK)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
