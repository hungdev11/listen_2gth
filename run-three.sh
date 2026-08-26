#!/usr/bin/env bash
# Run 3 listen_2gth server instances on ports 3000, 3001, 3002 — each with
# its own DATA_DIR (data-1, data-2, data-3) and its own HOST_PASSWORD so
# the 3 instances are fully isolated.
#
# Usage:
#   ./run-three.sh                # start all three
#   ./run-three.sh stop           # stop all three
#   ./run-three.sh logs           # tail all three logs

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PORTS=(3000 3001 3002)
PIDS_FILE="$ROOT/.run-three.pids"
LOGS_DIR="$ROOT/.run-three-logs"
mkdir -p "$LOGS_DIR"
pass="123456"

start() {
  if [ -f "$PIDS_FILE" ]; then
    echo "Already running (PID file exists). Use '$0 stop' first." >&2
    exit 1
  fi
  : > "$PIDS_FILE"
  for i in "${!PORTS[@]}"; do
    port="${PORTS[$i]}"
    n=$((i + 1))
    data_dir="$ROOT/data-$n"
    log_file="$LOGS_DIR/server-$n.log"
    mkdir -p "$data_dir"
    PORT="$port" \
    DATA_DIR="$data_dir" \
    HOST_PASSWORD="${pass}" \
      node server.js >"$log_file" 2>&1 &
    pid=$!
    echo "$pid" >> "$PIDS_FILE"
    echo "started instance $n on port $port (pid $pid, data=$data_dir, password=${pass})"
    echo "  → http://localhost:$port  (logs: $log_file)"
  done
  echo "All 3 instances running. Tail logs with: $0 logs"
}

stop() {
  if [ ! -f "$PIDS_FILE" ]; then
    echo "Not running."
    exit 0
  fi
  while read -r pid; do
    [ -z "$pid" ] && continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && echo "stopped pid $pid"
    fi
  done < "$PIDS_FILE"
  rm -f "$PIDS_FILE"
}

logs() {
  ls "$LOGS_DIR"/server-*.log 2>/dev/null | xargs -I {} echo "==> {} <=="
  tail -F "$LOGS_DIR"/server-*.log
}

case "${1:-start}" in
  start|"") start ;;
  stop) stop ;;
  logs) logs ;;
  *) echo "usage: $0 [start|stop|logs]" >&2; exit 2 ;;
esac