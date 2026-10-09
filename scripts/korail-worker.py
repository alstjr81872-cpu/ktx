"""Read-only Korail transport, controlled by the local Node server via JSON lines.

pykorail owns the current app identity, request signatures and verified HTTPS
transport. Only ScheduleView is exposed; this worker has no login or booking API.
Neither request headers nor the persistent client identity leave this process.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_PARAMS = frozenset({
    "radJobId", "selGoTrain", "txtTrnGpCd", "txtGoAbrdDt", "txtGoStart",
    "txtGoEnd", "txtGoHour", "txtMenuId", "txtPsgFlg_1", "txtPsgFlg_2",
    "txtPsgFlg_3", "txtPsgFlg_4", "txtPsgFlg_5", "txtSeatAttCd_2",
    "txtSeatAttCd_3", "txtSeatAttCd_4",
})


def send(message: dict) -> None:
    print(json.dumps(message, ensure_ascii=False), flush=True)


def load_identity(path: Path) -> str:
    from pykorail.device.android_id import generate_android_id, validate_android_id

    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        # Exclusive creation preserves an existing identity, including across restarts.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump({"android_id": generate_android_id()}, file)
    return validate_android_id(json.loads(path.read_text(encoding="utf-8"))["android_id"])


def build_params(params: object) -> dict:
    from pykorail.constants import APP_VERSION, DEVICE

    if not isinstance(params, dict) or set(params) - ALLOWED_PARAMS:
        raise ValueError("Unexpected query parameters")
    if any(not isinstance(v, str) or len(v) > 100 for v in params.values()):
        raise ValueError("Invalid query value")
    required = {"txtGoStart", "txtGoEnd", "txtGoAbrdDt", "txtGoHour", "txtPsgFlg_1"}
    if not required.issubset(params):
        raise ValueError("Missing query parameters")
    return {
        **params,
        "Device": DEVICE,
        "Version": APP_VERSION,
        # Schedule lookup uses an empty Sid and no account or API Key.
        "Sid": "",
        "ebizCrossCheck": "N",
        "srtCheckYn": "N",
        "rtYn": "N",
        "adjStnScdlOfrFlg": "N",
        "mbCrdNo": "",
    }


def run() -> None:
    try:
        from pykorail.api import ApiClient
        from pykorail.auth.signer import RequestSigner
        from pykorail.constants import API_ENDPOINTS, DEFAULT_HEADERS
        from pykorail.exceptions import HttpStatusError
        from pykorail.transport import create_session

        state_file = Path(os.environ.get("KORAIL_STATE_FILE", str(ROOT / ".local" / "korail-device.json")))
        signer = RequestSigner(device_id=load_identity(state_file))
        session = create_session(DEFAULT_HEADERS)
        # curl_cffi session default; the Node parent also enforces a hard timeout.
        session.timeout = 12
        api = ApiClient(session, signer)
    except ImportError:
        send({"type": "fatal", "kind": "setup", "message": "코레일 연결 모듈을 설치해야 합니다. npm run setup:korail을 실행해 주세요."})
        return
    except Exception:
        send({"type": "fatal", "kind": "setup", "message": "코레일 연결 설정 파일을 읽지 못했습니다. 서버의 .local 폴더 권한과 설정을 확인해 주세요."})
        return

    send({"type": "ready", "protocol": 1})
    endpoint = API_ENDPOINTS["search_schedule"]
    try:
        for line in sys.stdin:
            request_id = None
            try:
                if len(line) > 16384:
                    raise ValueError("Request too large")
                request = json.loads(line)
                request_id = request["id"]
                if not isinstance(request_id, int) or request.get("operation") != "search":
                    raise ValueError("Invalid operation")
                params = build_params(request.get("params"))
                headers, _ = api.sign(endpoint, include_sid=False)
                # Keep pykorail's POST-with-query-parameters format. GET is not equivalent.
                payload = api.post(endpoint, params=params, headers=headers)
                send({"id": request_id, "ok": True, "data": payload})
            except (ValueError, KeyError, TypeError):
                send({"id": request_id, "ok": False, "kind": "setup", "message": "코레일 조회 요청 형식이 잘못되었습니다."})
            except HttpStatusError as error:
                send({"id": request_id, "ok": False, "kind": "http", "status": error.status_code})
            except Exception:
                # Transport exceptions can contain signed URLs. Never send/log them.
                send({"id": request_id, "ok": False, "kind": "network", "message": "코레일에 연결할 수 없습니다. 잠시 후 다시 조회합니다."})
    finally:
        api.close()


if __name__ == "__main__":
    run()
