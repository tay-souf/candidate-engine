#!/bin/bash
# ============================================
# Wrapper script for client setup
# ============================================

# Ensure we're in the project root
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

if [ -z "$1" ]; then
  echo "Usage: ./scripts/setup-client.sh <path-to-config.yaml>"
  exit 1
fi

if [ ! -f "$1" ]; then
  echo "Error: Config file not found at $1"
  exit 1
fi

echo "Running client setup..."
node scripts/setup-client.js "$1"
