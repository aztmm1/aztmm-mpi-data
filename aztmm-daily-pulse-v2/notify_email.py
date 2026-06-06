#!/usr/bin/env python3
"""Send pipeline status email via Resend HTTP API.

Personal-use notifier (Path C). Posts an HTML status email to
nikhil.kothari17@gmail.com after every cron tick of every AZTMM
workflow that wires this step.

Auth: requires RESEND_API_KEY env var. If missing, the script prints
'skipping' and exits 0 so it never fails the job.

CLI:
    notify_email.py <ok|fail> <run_type> [--mpi N] [--post URL] [--err MSG]
"""
import os
import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

RESEND_API = "https://api.resend.com/emails"
TO_ADDR = "nikhil.kothari17@gmail.com"
# Default to Resend's sandbox sender so notifications work WITHOUT a
# verified domain. Override via FROM_ADDR env var once you verify
# aztmm.com in Resend.
FROM_ADDR = os.environ.get("FROM_ADDR", "AZTMM Pipeline <onboarding@resend.dev>")


def send_email(subject: str, html_body: str, status: str = "ok") -> bool:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        print("[notify_email] RESEND_API_KEY missing; skipping notification (not a failure)")
        return False

    payload = {
        "from": FROM_ADDR,
        "to": [TO_ADDR],
        "subject": subject,
        "html": html_body,
    }

    req = urllib.request.Request(
        RESEND_API,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode()
            print(f"[notify_email] sent: HTTP {r.status} {body[:200]}")
            return True
    except urllib.error.HTTPError as e:
        print(f"[notify_email] HTTPError {e.code}: {e.read().decode()[:300]}")
        return False
    except Exception as e:
        print(f"[notify_email] failed: {e}")
        return False


def build_html(status: str, run_type: str, mpi=None, post_url=None, errors=None) -> str:
    color = "#10b981" if status == "ok" else "#fb7185"
    badge = "OK" if status == "ok" else "FAILED"
    rows = []
    rows.append(f"<tr><td style='padding:6px 12px;'><b>Run</b></td><td style='padding:6px 12px;'>{run_type}</td></tr>")
    rows.append(f"<tr><td style='padding:6px 12px;'><b>Time</b></td><td style='padding:6px 12px;'>{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</td></tr>")
    if mpi is not None:
        rows.append(f"<tr><td style='padding:6px 12px;'><b>MPI</b></td><td style='padding:6px 12px;'>{mpi}</td></tr>")
    if post_url:
        rows.append(f"<tr><td style='padding:6px 12px;'><b>Post</b></td><td style='padding:6px 12px;'><a href='{post_url}' style='color:#60a5fa;'>{post_url}</a></td></tr>")
    if errors:
        safe = str(errors).replace("<", "&lt;").replace(">", "&gt;")[:1500]
        rows.append(f"<tr><td style='padding:6px 12px;vertical-align:top;'><b>Errors</b></td><td style='padding:6px 12px;'><pre style='white-space:pre-wrap;margin:0;'>{safe}</pre></td></tr>")
    return f"""<html><body style='font-family:-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;'>
      <h2 style='color:{color};margin:0 0 16px 0;'>AZTMM Pipeline &middot; {badge}</h2>
      <table style='border-collapse:collapse;background:#1e293b;border-radius:8px;'>{''.join(rows)}</table>
      <hr style='border:0;border-top:1px solid #334155;margin-top:24px;' />
      <p style='font-size:12px;color:#94a3b8;'><a href='https://aztmm-cron-v2.aztmmhldgs.workers.dev/status' style='color:#60a5fa;'>View full status page</a></p>
    </body></html>"""


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        print("Usage: notify_email.py <ok|fail> <run_type> [--mpi N] [--post URL] [--err MSG]")
        return 2
    status, run_type = args[0], args[1]
    if status not in ("ok", "fail"):
        print(f"[notify_email] invalid status '{status}' (must be ok|fail)")
        return 2

    extra = {}
    i = 2
    while i < len(args):
        if args[i] == "--mpi" and i + 1 < len(args):
            extra["mpi"] = args[i + 1]
            i += 2
        elif args[i] == "--post" and i + 1 < len(args):
            extra["post_url"] = args[i + 1]
            i += 2
        elif args[i] == "--err" and i + 1 < len(args):
            extra["errors"] = args[i + 1]
            i += 2
        else:
            i += 1

    subject = f"AZTMM Pipeline {('OK' if status == 'ok' else 'FAILED')} - {run_type} - {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    html = build_html(status, run_type, **extra)
    send_email(subject, html, status=status)
    # Never fail the job because of notification problems.
    return 0


if __name__ == "__main__":
    sys.exit(main())
