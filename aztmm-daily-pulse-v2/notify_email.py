#!/usr/bin/env python3
"""Pipeline status notifier - STUB (Path B+C).

Resend was removed - GH Actions built-in failure email notifications
(configured at https://github.com/settings/notifications) now handle
operator alerting. This stub keeps the workflow step interface intact
so workflow YAMLs don't need to change beyond removing the env entry.

For success/run details, see the dashboard:
    https://aztmm-cron-v2.aztmmhldgs.workers.dev/status

CLI:
    notify_email.py <ok|fail> <run_type> [--mpi N] [--post URL] [--err MSG]
"""
import sys
from datetime import datetime, timezone


def send_email(subject: str, html_body: str, status: str = "ok") -> bool:
    """Resend removed - GH Actions built-in failure notifications now handle alerting.
    This stub keeps the workflow step interface but only logs."""
    print(f"[notify_email] {subject}")
    print(f"[notify_email] (status={status}) - relying on GH built-in failure email")
    return True


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
        if args[i] in ("--mpi", "--post", "--err") and i + 1 < len(args):
            extra[args[i].lstrip("-")] = args[i + 1]
            i += 2
        else:
            i += 1

    badge = "OK" if status == "ok" else "FAILED"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subject = f"AZTMM Pipeline {badge} - {run_type} - {stamp[:10]}"
    summary = " ".join(f"{k}={v}" for k, v in extra.items())
    print(f"[notify_email] {subject} | time={stamp} | {summary}")
    print("[notify_email] Resend disabled - rely on GH Actions failure email + /status dashboard")
    # Never fail the job because of notification problems.
    return 0


if __name__ == "__main__":
    sys.exit(main())
