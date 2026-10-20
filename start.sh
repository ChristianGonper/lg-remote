#!/data/data/com.termux/files/usr/bin/sh
# Arranca el mando LG. En Termux mantiene la CPU despierta (termux-wake-lock) para que no lo mate Android.
cd "$(dirname "$0")" || exit 1
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
exec node server.js "$@"
