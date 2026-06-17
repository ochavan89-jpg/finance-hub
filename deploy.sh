#!/bin/bash
# Build production assets into dist/ (nginx serves /var/www/finance-hub/dist)
set -euo pipefail
cd "$(dirname "$0")"
echo "Installing dependencies..."
npm ci
echo "Building Finance Hub..."
npm run build
echo "Done. dist/ is ready to serve."
