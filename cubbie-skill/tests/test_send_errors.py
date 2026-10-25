"""What send.py tells the student for every server answer, against the harness's local stub (plain HTTP).

Run: python3 -m unittest discover -s cubbie-skill/tests
"""

from __future__ import annotations

import contextlib
import io
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

send = harness.send
KEY = "harness-test-key"
TEXT_ONLY = str(harness.FIXTURES / "import_text_only.json")


def run(args: list, key: str = KEY) -> tuple:
    """Run send.py's main in process; return (exit code, stdout, stderr) kept apart."""
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(send, "GROUPIE_SIGNING_KEY", key), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = send.main(args)
    return code, out.getvalue(), err.getvalue()


class AgainstStub(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stub = harness.StubGroupie(KEY)
        threading.Thread(target=cls.stub.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.stub.shutdown()
        cls.stub.server_close()

    def send_code(self, code: str, key: str = KEY, sample: bool = False) -> tuple:
        source = ["--sample"] if sample else ["--file", TEXT_ONLY]
        return run(source + ["--code", code, "--url", self.stub.url], key)

    def assertStudentLine(self, result: tuple, exit_code: int, *lines: str) -> None:
        code, out, err = result
        self.assertEqual(code, exit_code, out + err)
        self.assertEqual(out.splitlines(), list(lines))
        self.assertNotIn(KEY, out + err)
        self.assertNotIn("requestId", out)
        self.assertNotIn(harness.STUB_REQUEST_ID, out)

    def assertRequestIdOnStderr(self, result: tuple) -> None:
        self.assertIn(f"requestId: {harness.STUB_REQUEST_ID}", result[2].splitlines())

    def test_code_expired(self):
        result = self.send_code(harness.EXPIRED_CODE)
        self.assertStudentLine(result, send.EXIT_FRESH_CODE, send.LINE_EXPIRED)
        self.assertRequestIdOnStderr(result)

    def test_code_unknown(self):
        result = self.send_code(harness.UNKNOWN_CODE)
        self.assertStudentLine(result, send.EXIT_FRESH_CODE, send.LINE_EXPIRED)
        self.assertRequestIdOnStderr(result)

    def test_code_used(self):
        self.assertStudentLine(self.send_code("CDEFGH"), send.EXIT_OK, send.LINE_SENT)
        result = self.send_code("CDEFGH")
        self.assertStudentLine(result, send.EXIT_CODE_USED, send.LINE_USED)
        self.assertRequestIdOnStderr(result)

    def test_bad_signature(self):
        result = self.send_code("CDEFGJ", key=KEY + "x")
        self.assertStudentLine(result, send.EXIT_SIGNATURE, send.LINE_OUTDATED)
        self.assertIn("https://github.com/katsdivi/groupie-cubbie-skill/tree/main/groupie-import", result[1])
        self.assertRequestIdOnStderr(result)

    def test_invalid_payload(self):
        result = self.send_code(harness.INVALID_CODE)
        self.assertStudentLine(result, send.EXIT_BAD_PAYLOAD, send.LINE_SNAG)
        self.assertRequestIdOnStderr(result)

    def test_server_error(self):
        result = self.send_code(harness.SERVER_ERROR_CODE)
        self.assertStudentLine(result, send.EXIT_SERVER, send.LINE_SNAG)
        self.assertRequestIdOnStderr(result)

    def test_unlisted_error_code_is_server_error(self):
        result = self.send_code(harness.ODD_ERROR_CODE)
        self.assertStudentLine(result, send.EXIT_SERVER, send.LINE_SNAG)
        self.assertNotIn("rejected", result[1].lower())

    def test_rate_limited(self):
        result = self.send_code(harness.RATE_CODE)
        self.assertStudentLine(result, send.EXIT_RATE, send.LINE_RATE)
        self.assertRequestIdOnStderr(result)

    def test_not_expecting(self):
        result = self.send_code(harness.BUSY_CODE)
        self.assertStudentLine(result, send.EXIT_NOT_EXPECTING, send.LINE_NOT_EXPECTING)
        self.assertRequestIdOnStderr(result)

    def test_not_json_body_is_server_error(self):
        result = self.send_code(harness.NOT_JSON_CODE)
        self.assertStudentLine(result, send.EXIT_SERVER, send.LINE_SNAG)
        self.assertIn("error: server_error (HTTP 502)", result[2])

    def test_too_large_retries_once_without_attachments(self):
        before = len(self.stub.imports)
        result = self.send_code(harness.BIG_CODE, sample=True)
        self.assertStudentLine(result, send.EXIT_OK, send.LINE_TOO_BIG, send.LINE_SENT)
        tries = self.stub.imports[before:]
        self.assertEqual(len(tries), 2)
        self.assertTrue(tries[0].get("attachments"))
        self.assertNotIn("attachments", tries[1])
        self.assertEqual(tries[1]["assignment"], tries[0]["assignment"])

    def test_too_large_twice_says_too_big_once_then_snag(self):
        before = len(self.stub.imports)
        result = self.send_code(harness.ALWAYS_BIG_CODE, sample=True)
        self.assertStudentLine(result, send.EXIT_TOO_LARGE, send.LINE_TOO_BIG, send.LINE_SNAG)
        self.assertEqual(len(self.stub.imports) - before, 2)
        self.assertEqual(result[1].count(send.LINE_TOO_BIG), 1)

    def test_too_large_without_attachments_does_not_retry(self):
        before = len(self.stub.imports)
        result = self.send_code(harness.ALWAYS_BIG_CODE)  # the text only fixture has no attachments
        self.assertStudentLine(result, send.EXIT_TOO_LARGE, send.LINE_SNAG)
        self.assertEqual(len(self.stub.imports) - before, 1)

    def test_network_error_is_server_error_line(self):
        result = run(["--file", TEXT_ONLY, "--code", "CDEFGK", "--url", f"http://127.0.0.1:{harness.closed_port()}"])
        self.assertStudentLine(result, send.EXIT_NETWORK, send.LINE_SNAG)
        self.assertIn("unreachable", result[2])

    def test_timeout_is_server_error_line(self):
        with mock.patch.object(send, "post", side_effect=TimeoutError("slow")):
            result = run(["--file", TEXT_ONLY, "--code", "CDEFGM", "--url", self.stub.url])
        self.assertStudentLine(result, send.EXIT_NETWORK, send.LINE_SNAG)

    def test_bad_code_format_line(self):
        self.assertStudentLine(self.send_code("ABCDE1"), send.EXIT_CODE, send.LINE_BAD_CODE)

    def test_local_payload_problem_goes_to_stderr_only(self):
        code, out, err = run(["--file", str(harness.FIXTURES / "import_malformed.json"), "--code", "CDEFGN",
                              "--url", self.stub.url])
        self.assertEqual((code, out), (send.EXIT_PAYLOAD, ""))
        self.assertIn("not ready to send", err)


class Lines(unittest.TestCase):
    def test_no_em_dashes_and_no_rejected(self):
        for name in dir(send):
            if name.startswith("LINE_"):
                line = getattr(send, name)
                self.assertNotIn(chr(0x2014), line)  # no em dashes
                self.assertNotIn("rejected", line.lower())

    def test_request_id_is_never_echoed_raw(self):
        self.assertEqual(send.request_id({"requestId": "abc DEF\nsecret"}), "")
        self.assertEqual(send.request_id({"requestId": "EgwxIVeoS1u8hJ-ass7a6g"}), "EgwxIVeoS1u8hJ-ass7a6g")


if __name__ == "__main__":
    unittest.main()
