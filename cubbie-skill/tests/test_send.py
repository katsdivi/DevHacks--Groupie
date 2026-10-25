"""Unit tests for scripts/send.py. Run: python3 -m unittest discover -s cubbie-skill/tests"""

from __future__ import annotations

import contextlib
import copy
import hashlib
import hmac
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest import mock

SKILL = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("groupie_send_under_test", SKILL / "scripts" / "send.py")
send = importlib.util.module_from_spec(spec)
spec.loader.exec_module(send)

SAMPLE = json.loads((SKILL / "assets" / "sample_payload.json").read_text())
FIXTURES = SKILL.parent / "fixtures" / "cubbie"


def quiet(fn, *args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        return fn(*args), out.getvalue().strip()


class Signing(unittest.TestCase):
    def test_signature_matches_hmac_sha256(self):
        key, body = b"secret-key", send.encode(SAMPLE)
        self.assertEqual(send.sign(key, body), "sha256=" + hmac.new(key, body, hashlib.sha256).hexdigest())

    def test_signs_exactly_the_bytes_it_sends(self):
        seen = {}

        def fake_post(url, body, headers):
            seen.update(url=url, body=body, headers=headers)
            return 200, b'{"ok": true, "importId": 1, "message": "Sent to Groupie. Check your group."}'

        with mock.patch.object(send, "post", fake_post), mock.patch.object(send, "GROUPIE_SIGNING_KEY", "k"):
            code, line = quiet(send.main, ["--sample", "--code", " k7q2mx ", "--url", "http://stub.test/"])
        self.assertEqual(code, send.EXIT_OK)
        self.assertEqual(line, "Sent to Groupie. Check your group.")
        self.assertEqual(seen["url"], "http://stub.test/api/cubbie/import")
        self.assertEqual(seen["headers"]["Content-Type"], "application/json")
        expected = "sha256=" + hmac.new(b"k", seen["body"], hashlib.sha256).hexdigest()
        self.assertEqual(seen["headers"]["X-Groupie-Signature"], expected)
        self.assertEqual(json.loads(seen["body"])["pairCode"], "K7Q2MX")

    def test_key_is_never_printed(self):
        with mock.patch.object(send, "post", return_value=(401, b'{"error":"bad_signature"}')), \
                mock.patch.object(send, "GROUPIE_SIGNING_KEY", "super-secret-value"):
            code, line = quiet(send.main, ["--sample", "--url", "http://stub.test"])
        self.assertEqual(code, send.EXIT_SIGNATURE)
        self.assertNotIn("super-secret-value", line)


class Validation(unittest.TestCase):
    def test_invalid_code_rejected_before_sending(self):
        for bad in ("0O1IL!", "K7Q2M", "K7Q2MXX", "ABCDE1", "abcde0", ""):
            with self.subTest(code=bad), mock.patch.object(send, "post") as post:
                code, _ = quiet(send.main, ["--sample", "--code", bad, "--url", "http://stub.test"])
                self.assertEqual(code, send.EXIT_CODE)
                post.assert_not_called()

    def test_lowercase_code_is_accepted(self):
        self.assertEqual(send.normalize_code(" k7q2mx "), "K7Q2MX")

    def test_fixtures(self):
        self.assertEqual(send.validate(json.loads((FIXTURES / "import_full.json").read_text())), [])
        self.assertEqual(send.validate(json.loads((FIXTURES / "import_text_only.json").read_text())), [])
        self.assertEqual(send.validate(SAMPLE), [])
        self.assertTrue(send.validate(json.loads((FIXTURES / "import_malformed.json").read_text())))

    def test_malformed_payload_not_sent(self):
        with mock.patch.object(send, "post") as post:
            code, _ = quiet(send.main, ["--file", str(FIXTURES / "import_malformed.json"), "--code", "K7Q2MX",
                                        "--url", "http://stub.test"])
        self.assertEqual(code, send.EXIT_PAYLOAD)
        post.assert_not_called()

    def test_due_dates(self):
        for good in (None, "2026-11-20T23:59:00-07:00", "2026-11-21T06:59:00Z", "2026-11-21T06:59:00.123+00:00"):
            self.assertTrue(send.valid_due(good), good)
        for bad in ("next friday", "2026-11-20", "2026-11-20T23:59:00", "2026-13-01T00:00:00Z", 42):
            self.assertFalse(send.valid_due(bad), bad)

    def test_limits(self):
        payload = copy.deepcopy(SAMPLE)
        payload["attachments"] = [{"filename": "a.pdf", "text": "x"}] * 6
        self.assertTrue(send.validate(payload))
        payload = copy.deepcopy(SAMPLE)
        payload["assignment"]["descriptionText"] = "x" * 60_001
        self.assertTrue(send.validate(payload))
        payload = copy.deepcopy(SAMPLE)
        payload["rubric"] = {"criteria": [{"name": "Report", "points": 1001}]}
        self.assertTrue(send.validate(payload))
        payload["rubric"] = {"criteria": [{"name": "Report", "points": 15, "ratings": ["Full", "Missing"]}]}
        self.assertEqual(send.validate(payload), [])


class ExitCodes(unittest.TestCase):
    def status(self, status, body):
        raw = json.dumps(body).encode()
        with mock.patch.object(send, "post", return_value=(status, raw)):
            code, line = quiet(send.main, ["--sample", "--url", "http://stub.test"])
        return code, line

    def test_exit_code_per_status(self):
        cases = [
            (200, {"ok": True, "importId": 3, "message": "Sent to Groupie. Check your group."}, send.EXIT_OK),
            (400, {"error": "bad_payload"}, send.EXIT_BAD_PAYLOAD),
            (401, {"error": "bad_signature"}, send.EXIT_SIGNATURE),
            (404, {"error": "unknown_code"}, send.EXIT_FRESH_CODE),
            (409, {"error": "code_used"}, send.EXIT_FRESH_CODE),
            (409, {"error": "code_expired"}, send.EXIT_FRESH_CODE),
            (409, {"error": "not_expecting"}, send.EXIT_NOT_EXPECTING),
            (429, {"error": "rate_limited"}, send.EXIT_RATE),
            (500, {"error": "boom"}, send.EXIT_SERVER),
        ]
        for status, body, expected in cases:
            with self.subTest(status=status, error=body.get("error")):
                self.assertEqual(self.status(status, body)[0], expected)

    def test_distinct_codes(self):
        codes = [send.EXIT_ARGS, send.EXIT_CODE, send.EXIT_PAYLOAD, send.EXIT_NETWORK, send.EXIT_BAD_PAYLOAD,
                 send.EXIT_SIGNATURE, send.EXIT_FRESH_CODE, send.EXIT_NOT_EXPECTING, send.EXIT_RATE, send.EXIT_SERVER]
        self.assertEqual(len(set(codes)), len(codes))
        self.assertNotIn(send.EXIT_OK, codes)

    def test_network_error_retries_once(self):
        with mock.patch.object(send, "post", side_effect=OSError("down")) as post:
            code, line = quiet(send.main, ["--sample", "--url", "http://stub.test"])
        self.assertEqual(code, send.EXIT_NETWORK)
        self.assertEqual(post.call_count, 2)
        self.assertLess(len(line), 200)

    def test_retry_then_success(self):
        ok = (200, b'{"ok": true, "importId": 1, "message": "Sent to Groupie. Check your group."}')
        with mock.patch.object(send, "post", side_effect=[OSError("blip"), ok]) as post:
            code, _ = quiet(send.main, ["--sample", "--url", "http://stub.test"])
        self.assertEqual((code, post.call_count), (send.EXIT_OK, 2))

    def test_sample_without_url_sends_nothing(self):
        with mock.patch.object(send, "post") as post:
            code, line = quiet(send.main, ["--sample"])
        self.assertEqual(code, send.EXIT_OK)
        self.assertIn("Nothing was sent", line)
        post.assert_not_called()

    def test_missing_file(self):
        code, _ = quiet(send.main, ["--file", "/nonexistent/payload.json"])
        self.assertEqual(code, send.EXIT_ARGS)


if __name__ == "__main__":
    unittest.main()
