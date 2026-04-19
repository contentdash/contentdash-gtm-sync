#!/bin/zsh
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: $0 <admin-board.json> <spreadsheet-id> <access-token>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

python3 "$SCRIPT_DIR/enrich_pipeline_from_admin_board.py" "$1" "$2" "$3"
