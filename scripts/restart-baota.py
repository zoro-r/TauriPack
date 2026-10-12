#!/usr/bin/env python3
"""Restart a BaoTa Node project using deployment environment credentials."""

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    config = {}
    for name in ("BT_PANEL_URL", "BT_API_KEY", "BT_APP_NAME"):
        config[name] = os.environ.get(name, "")
        if not config[name]:
            raise ValueError(f"Missing required environment variable: {name}")

    request_time = str(int(time.time()))
    key_hash = hashlib.md5(config["BT_API_KEY"].encode()).hexdigest()
    token = hashlib.md5((request_time + key_hash).encode()).hexdigest()
    body = urllib.parse.urlencode({
        "request_time": request_time,
        "request_token": token,
        "data": json.dumps({"project_name": config["BT_APP_NAME"]}),
    }).encode()
    request = urllib.request.Request(
        config["BT_PANEL_URL"].rstrip("/") + "/project/nodejs/restart_project",
        data=body,
    )
    print(f"Restarting BaoTa Node project: {config['BT_APP_NAME']}", flush=True)
    with urllib.request.urlopen(request, timeout=40) as response:
        result = json.load(response)
    if not isinstance(result, dict) or result.get("status") is not True:
        message = result.get("msg", "unexpected response") if isinstance(result, dict) else "unexpected response"
        raise ValueError(f"BaoTa restart failed: {message}")
    print("BaoTa application restart succeeded")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, urllib.error.URLError) as exc:
        print(f"Application restart failed: {exc}", file=sys.stderr)
        sys.exit(1)
