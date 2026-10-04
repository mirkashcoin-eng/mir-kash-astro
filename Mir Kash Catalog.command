#!/bin/bash
# Double-click to open the Mir Kash catalog tool in your browser (add products, preview, push to Shopify).
# Keep the window that opens running while you work; close it when you're done.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
URL="http://localhost:4321/catalog-tool"

if curl -s -o /dev/null --max-time 3 "$URL"; then
  open "$URL"
  echo "The catalog tool is already running. It has opened in your browser."
  exit 0
fi

if ! command -v node > /dev/null; then
  echo "Node.js isn't installed on this Mac, so the tool can't start."
  read -r -p "Press Enter to close."
  exit 1
fi
[ -d node_modules ] || npm install

echo ""
echo "  Starting the Mir Kash catalog tool…"
echo "  Your browser opens by itself in a few seconds."
echo "  Keep this window open while you work. Close it when you're done."
echo ""
(until curl -s -o /dev/null --max-time 2 "$URL"; do sleep 1; done; open "$URL") &
MK_CATALOG=1 npx astro dev --port 4321
