#!/bin/sh
set -e

# Start the collector in the background
node /app/apps/collector/dist/worker.js &
COLLECTOR_PID=$!

# Forward SIGTERM/SIGINT to both processes so the container shuts down cleanly
cleanup() {
  echo "Shutting down..."
  kill "$COLLECTOR_PID" 2>/dev/null || true
  wait "$COLLECTOR_PID" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# Run the API in the foreground — when it exits, the container exits
node /app/apps/api/dist/server.js
API_EXIT=$?

# API exited unexpectedly; kill the collector and propagate the exit code
kill "$COLLECTOR_PID" 2>/dev/null || true
wait "$COLLECTOR_PID" 2>/dev/null || true
exit "$API_EXIT"
