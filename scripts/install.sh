#!/usr/bin/env bash
#
# Breakmine Desktop installer for Linux.
#
# There are no prebuilt AppImages published on the mod wiki or in GitHub
# Releases, so this script fetches the game source from GitHub, builds it
# locally and packages the result as an AppImage. That means Node, npm and a
# working network connection are required — it is a source install, not a
# binary download.
#
# Re-running the script finds an existing install, compares the installed
# commit against the remote one and offers to update.
#
# Usage:
#   ./scripts/install.sh                 install or update from the main branch
#   ./scripts/install.sh --ref v4.7.9a   install a specific tag
#   ./scripts/install.sh --force         rebuild even if already up to date
#   ./scripts/install.sh --dir ~/games/breakmine
#
set -euo pipefail

REPO="Breakmine-Team/breakmine-revived"
API="https://api.github.com/repos/${REPO}"

REF="main"
FORCE=0
INSTALL_DIR="${BREAKMINE_INSTALL_DIR:-$HOME/.local/share/breakmine}"
APPNAME="Breakmine"
APPIMAGE_NAME="Breakmine.AppImage"

DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"

# ---------------------------------------------------------------- helpers

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"
  RED="$(printf '\033[31m')"; GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"; RESET="$(printf '\033[0m')"
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

step()  { printf '%s==>%s %s%s%s\n' "$GREEN" "$RESET" "$BOLD" "$*" "$RESET"; }
info()  { printf '    %s\n' "$*"; }
warn()  { printf '%s !! %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
die()   { printf '%s xx %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed.${2:+ $2}"
}

cleanup() {
  if [ -n "${WORKDIR:-}" ] && [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
  fi
  return 0
}
trap cleanup EXIT

# Ask a yes/no question. Default is yes unless NO_DEFAULT is set.
confirm() {
  local prompt="$1" default_hint="${2:-y}" reply
  if [ "$default_hint" = "n" ]; then
    read -r -p "    $prompt [y/N] " reply </dev/tty || return 1
  else
    read -r -p "    $prompt [Y/n] " reply </dev/tty || return 1
  fi
  reply="$(printf '%s' "${reply:-}" | tr '[:upper:]' '[:lower:]')"
  if [ -z "$reply" ]; then [ "$default_hint" = "y" ]; return; fi
  case "$reply" in y|yes) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- args

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)   REF="${2:?--ref needs a value}"; shift 2 ;;
    --dir)   INSTALL_DIR="${2:?--dir needs a value}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help)
      sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

case "$INSTALL_DIR" in
  /*) ;;
  *) INSTALL_DIR="$PWD/$INSTALL_DIR" ;;
esac

# ---------------------------------------------------------------- preflight

step "Checking prerequisites"
need_cmd curl "Install it with: sudo apt install curl"
need_cmd tar  "Install it with: sudo apt install tar"
need_cmd node "Install Node 22 or newer from https://nodejs.org"
need_cmd npm  "It ships with Node."
info "node $(node --version), npm $(npm --version)"

# The commit currently installed, if any.
VERSION_FILE="$INSTALL_DIR/.breakmine-version"
INSTALLED_SHA=""
INSTALLED_REF=""
if [ -f "$VERSION_FILE" ]; then
  INSTALLED_SHA="$(sed -n 's/^sha=//p' "$VERSION_FILE" | head -n1)"
  INSTALLED_REF="$(sed -n 's/^ref=//p' "$VERSION_FILE" | head -n1)"
fi

if [ -f "$INSTALL_DIR/$APPIMAGE_NAME" ] && [ -z "$INSTALLED_SHA" ]; then
  warn "Found an install at $INSTALL_DIR but no version marker; treating it as unknown."
fi

# ---------------------------------------------------------------- remote state

step "Checking $REPO ($REF)"

# GITHUB_TOKEN is optional and only lifts the 60 requests/hour anonymous limit.
CURL_AUTH=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  CURL_AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

REMOTE_JSON="$(curl -fsSL --max-time 30 "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" "${API}/commits/${REF}" 2>/dev/null || true)"

REMOTE_SHA=""
REMOTE_SHORT=""
REMOTE_DATE=""
if [ -n "$REMOTE_JSON" ]; then
  # grep -o then head: the commit payload also contains a nested tree "sha",
  # so a greedy pattern would happily report the wrong one. The top-level
  # commit "sha" is the first match in the document.
  REMOTE_SHA="$(printf '%s' "$REMOTE_JSON" | grep -o '"sha": "[0-9a-f]\{40\}"' | head -n1 | grep -o '[0-9a-f]\{40\}')"
  REMOTE_SHORT="${REMOTE_SHA:0:7}"
  REMOTE_DATE="$(printf '%s' "$REMOTE_JSON" | grep -o '"date": "[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T' | head -n1 | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}')"
fi

if [ -z "$REMOTE_SHA" ]; then
  # Not fatal: the tarball endpoint may still work, we just cannot compare.
  warn "Could not read the remote commit (offline, rate limited, or bad ref '$REF'?)."
  warn "Set GITHUB_TOKEN to raise the API rate limit."
fi

# ---------------------------------------------------------------- already installed?

REINSTALL=0
if [ -f "$INSTALL_DIR/$APPIMAGE_NAME" ]; then
  step "Existing install found"
  info "location : $INSTALL_DIR"
  info "ref      : ${INSTALLED_REF:-unknown}"
  info "commit   : ${INSTALLED_SHA:-unknown}"

  if [ -n "$REMOTE_SHA" ] && [ "$INSTALLED_SHA" = "$REMOTE_SHA" ] && [ "$FORCE" -eq 0 ]; then
    step "Already up to date (${REMOTE_SHORT:-$INSTALLED_SHA})"
    info "Run with --force to rebuild anyway."
    exit 0
  fi

  if [ -n "$REMOTE_SHA" ]; then
    info "remote   : $REMOTE_SHORT ($REMOTE_DATE)"
  fi

  if confirm "Update to the latest version?" "y"; then
    REINSTALL=1
  else
    step "Keeping the current install."
    exit 0
  fi
fi

# AppImages are squashfs images that need FUSE to mount. The /dev/fuse device
# node exists even when the libfuse userspace library is missing, so check for
# the library itself rather than the device.
#
# Do not rely on `ldconfig -p` here: ldconfig is absent on several current
# distros (including Debian 13 minimal), which made this report a missing
# libfuse2 even when it was installed. Test for the library files instead.
FUSE_OK=0
for _lib in libfuse.so.2 libfuse.so.3 libfuse2.so libfuse3.so; do
  for _dir in /lib/"$(uname -m)"-linux-gnu /usr/lib/"$(uname -m)"-linux-gnu \
              /lib64 /usr/lib64 /lib /usr/lib; do
    if [ -e "$_dir/$_lib" ]; then FUSE_OK=1; break 2; fi
  done
done

if [ "$FUSE_OK" -eq 1 ]; then
  info "FUSE present."
else
  warn "libfuse not detected — the AppImage may refuse to start."
  warn "Debian/Ubuntu: sudo apt install libfuse2t64   (or: libfuse2)"
  warn "Fedora: sudo dnf install fuse   |   Arch: sudo pacman -S fuse2"
  warn "No root? The AppImage still runs with --appimage-extract-and-run"
fi

# ---------------------------------------------------------------- fetch source

WORKDIR="$(mktemp -d)"
step "Downloading source ($REF)"

# The tarball endpoint resolves branches, tags and commit SHAs alike, which
# avoids having to guess refs/heads vs refs/tags.
TARBALL_URL="${API}/tarball/${REF}"
info "$TARBALL_URL"

if ! curl -fL --retry 3 --retry-delay 2 --max-time 600 \
        "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" -o "$WORKDIR/source.tar.gz" "$TARBALL_URL"; then
  die "Download failed. Check the ref '$REF' and your connection."
fi

tar -xzf "$WORKDIR/source.tar.gz" -C "$WORKDIR" --strip-components=1
info "extracted to $WORKDIR"

if [ ! -f "$WORKDIR/package.json" ]; then
  die "Downloaded archive does not look like the game (no package.json)."
fi

# ---------------------------------------------------------------- build

step "Installing build dependencies"
cd "$WORKDIR"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  warn "No package-lock.json found; falling back to npm install."
  npm install --no-audit --no-fund
fi

step "Building the game (this takes a few minutes)"
npm run build

if [ ! -f dist/index.html ]; then
  die "Build finished but dist/index.html is missing; the vite build likely failed."
fi

step "Packaging the AppImage"
npx --no-install electron-builder --linux AppImage --publish never

APPIMAGE_BUILT=""
for candidate in release/*.AppImage; do
  [ -e "$candidate" ] && APPIMAGE_BUILT="$candidate" && break
done
[ -n "$APPIMAGE_BUILT" ] || die "electron-builder produced no AppImage (look above for the error)."

# ---------------------------------------------------------------- install

step "Installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
if [ "$REINSTALL" -eq 1 ]; then
  info "replacing previous build"
fi

# Write to a temporary name first so an interrupted copy cannot leave a
# half-written AppImage that fails to launch next time.
cp "$APPIMAGE_BUILT" "$INSTALL_DIR/$APPIMAGE_NAME.new"
chmod +x "$INSTALL_DIR/$APPIMAGE_NAME.new"
mv -f "$INSTALL_DIR/$APPIMAGE_NAME.new" "$INSTALL_DIR/$APPIMAGE_NAME"

cat > "$VERSION_FILE" <<EOF
sha=$REMOTE_SHA
ref=$REF
installed=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

# ---------------------------------------------------------------- desktop entry

step "Registering the launcher"
mkdir -p "$DESKTOP_DIR" "$ICON_DIR"

# Absolute Exec path — the launcher is started from an unknown working
# directory, and mods live next to the binary.
cat > "$DESKTOP_DIR/breakmine.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$APPNAME
Comment=Minecraft in JavaScript
Exec=$INSTALL_DIR/$APPIMAGE_NAME %U
Icon=breakmine
Terminal=false
Categories=Game;
StartupWMClass=$APPNAME
MimeType=x-scheme-handler/breakmine-game;
EOF

chmod +x "$DESKTOP_DIR/breakmine.desktop"

# electron-builder copies buildResources/<icon> into the AppImage as
# linux/icon.png; reuse the same source for the menu icon.
if [ -f "$WORKDIR/src/resources/favicon.png" ]; then
  cp "$WORKDIR/src/resources/favicon.png" "$ICON_DIR/breakmine.png"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

# Best effort: point the desktop environment at our launcher for the deep
# link scheme. Not all desktops honour this, and the user can also just run
# the AppImage directly.
if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default breakmine.desktop x-scheme-handler/breakmine-game >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------- done

printf '\n%s%s installed.%s\n\n' "$BOLD" "$GREEN" "$RESET"
info "binary : $INSTALL_DIR/$APPIMAGE_NAME"
info "launcher: $DESKTOP_DIR/breakmine.desktop"
info "mods   : $INSTALL_DIR/mods"
printf '\n'
info "Launch it from your application menu, or:"
printf '\n        %s%s%s\n\n' "$BOLD" "$INSTALL_DIR/$APPIMAGE_NAME" "$RESET"
info "Re-run this script any time to check for and install an update."
info "Uninstall by removing $INSTALL_DIR and $DESKTOP_DIR/breakmine.desktop"