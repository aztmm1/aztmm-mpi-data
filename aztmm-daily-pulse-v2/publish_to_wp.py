"""
WordPress REST API publish shim.

Called by the GH Actions workflow after run_daily_pulse.py emits a payload JSON.
Reads:
    WP_SITE         e.g. "aztmm.com"
    WP_USERNAME     e.g. "nikhil"
    WP_APP_PASSWORD WordPress application password (NOT account password)

If the payload root is `{"_action": "wpcom.publish_post", "payload": {...}}`
or just `{...}` (the bare post payload), both shapes are handled.

Featured-image policy: every published post defaults to the AZTMM HLDGS
seal (media id 1033). Payload can override via featured_media key.
"""

from __future__ import annotations

import json
import os
import sys

import requests

DEFAULT_SITE = "aztmm.com"
DEFAULT_FEATURED_MEDIA = 1033  # AZTMM HLDGS green seal


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: publish_to_wp.py PAYLOAD.json", file=sys.stderr)
        return 1
    with open(sys.argv[1]) as f:
        blob = json.load(f)
    if isinstance(blob, dict) and "_action" in blob:
        payload = blob.get("payload") or {}
    else:
        payload = blob

    if not payload:
        print("empty payload", file=sys.stderr)
        return 2

    site = os.environ.get("WP_SITE", DEFAULT_SITE).strip()
    user = (os.environ.get("WP_USERNAME") or "").strip()
    pw = (os.environ.get("WP_APP_PASSWORD") or "").strip()
    if not (user and pw):
        print("WP_USERNAME / WP_APP_PASSWORD not set", file=sys.stderr)
        return 3

    url = f"https://{site}/wp-json/wp/v2/posts"
    r = requests.post(url, auth=(user, pw), json={
        "title": payload["title"],
        "content": payload["content"],
        "excerpt": payload.get("excerpt", ""),
        "status": payload.get("status", "publish"),
        "slug": payload.get("slug"),
        "featured_media": payload.get("featured_media", DEFAULT_FEATURED_MEDIA),
    }, timeout=30)
    if r.status_code not in (200, 201):
        print(f"wp publish failed: {r.status_code} {r.text[:400]}", file=sys.stderr)
        return 4
    body = r.json()
    print(json.dumps({
        "status": "ok",
        "post_id": body.get("id"),
        "link": body.get("link"),
        "wp_status": body.get("status"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
