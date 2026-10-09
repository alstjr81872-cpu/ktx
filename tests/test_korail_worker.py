import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("korail_worker", ROOT / "scripts/korail-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_identity_survives_restarts_and_corruption_is_not_silently_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            first = worker.load_identity(path)
            self.assertEqual(first, worker.load_identity(path))
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            path.write_text('{"android_id": "invalid"}')
            with self.assertRaises(ValueError):
                worker.load_identity(path)
            self.assertIn("invalid", path.read_text())

    def test_query_has_current_version_and_no_account_or_booking_fields(self):
        params = worker.build_params({"txtGoStart":"서울","txtGoEnd":"부산","txtGoAbrdDt":"20261010","txtGoHour":"080000","txtPsgFlg_1":"2"})
        self.assertEqual(params["Version"], "250722001")
        self.assertEqual(params["Sid"], "")
        self.assertEqual(params["mbCrdNo"], "")
        self.assertNotIn("Key", params)
        self.assertEqual(params["txtPsgFlg_1"], "2")
        with self.assertRaises(ValueError):
            worker.build_params({**params, "url":"https://example.com/"})

    def test_worker_transports_raw_search_responses_without_exposing_auth(self):
        calls = []
        class FakeApi:
            def __init__(self, session, signer): pass
            def sign(self, url, include_sid):
                self.asserted_url = url
                return {"x-dynapath-m-token":"private-test-token"}, None
            def post(self, url, params, headers):
                calls.append((url, params, headers))
                return {"strResult":"SUCC", "trn_infos":{"trn_info":[]}}
            def close(self): pass
        request = {"id":1,"operation":"search","params":{"txtGoStart":"서울","txtGoEnd":"부산","txtGoAbrdDt":"20261010","txtGoHour":"080000","txtPsgFlg_1":"1"}}
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, \
            patch.dict(os.environ, {"KORAIL_STATE_FILE": str(Path(directory)/"state.json")}), \
            patch("pykorail.api.ApiClient", FakeApi), \
            patch("pykorail.transport.create_session", return_value=SimpleNamespace()), \
            patch("sys.stdin", io.StringIO(json.dumps(request)+"\n")), \
            contextlib.redirect_stdout(output):
            worker.run()
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(messages[1]["data"]["strResult"], "SUCC")
        self.assertTrue(calls[0][0].endswith(".seatMovie.ScheduleView"))
        self.assertEqual(calls[0][1]["Sid"], "")
        self.assertEqual(calls[0][2]["x-dynapath-m-token"], "private-test-token")
        self.assertNotIn("private-test-token", output.getvalue())


if __name__ == "__main__":
    unittest.main()
