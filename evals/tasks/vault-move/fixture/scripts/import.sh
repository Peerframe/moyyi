#!/bin/sh
# Imports web clippings into the notes vault.
NOTES_DIR="./Notes"
INBOX="$NOTES_DIR/收件箱"
mkdir -p "$INBOX"
cp clippings/*.md "$INBOX"/
echo "imported into $NOTES_DIR"
