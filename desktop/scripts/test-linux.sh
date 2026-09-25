#!/usr/bin/env bash
# Run inside xvfb-run. A real window manager is needed for fullscreen and pointer lock.
set -euo pipefail
openbox > "${RUNNER_TEMP:-/tmp}/backrooms-openbox.log" 2>&1 &
manager=$!
trap 'kill "$manager" 2>/dev/null || true' EXIT
for attempt in {1..100}; do
    if wmctrl -m > /dev/null 2>&1; then
        export BACKROOMS_WINDOW_MANAGER=1
        npx playwright test -c desktop
        exit 0
    fi
    sleep 0.1
done
echo 'Window manager did not start.' >&2
exit 1
