"""Local IPC fixture; never sends network requests."""
import json
import os
import sys
import time

print(json.dumps({"type": "ready", "protocol": 1}), flush=True)
count = 0
for line in sys.stdin:
    item = json.loads(line)
    count += 1
    mode = item["params"].get("mode", "success")
    if mode == "hang":
        time.sleep(60)
    if mode == "crash":
        sys.exit(2)
    if mode == "blocked":
        message = {"id": item["id"], "ok": False, "kind": "http", "status": 403}
    else:
        message = {"id": item["id"], "ok": True, "data": {"pid": os.getpid(), "count": count}}
    print(json.dumps(message), flush=True)
