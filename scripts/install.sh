#!/usr/bin/env bash
#
# Breakmine Desktop installer for Linux.
#
# The AppImage is built by appbuild.js (npm run dist:linux) and published as a
# release asset, so this script normally just downloads it — no Node, no npm,
# no compiler. Pass --source to build from a git checkout instead, which needs
# Node 22+, npm and a few minutes.
#
# Re-running the script finds an existing install, compares it against the
# published release and offers to update.
#
# Usage:
#   ./scripts/install.sh                 install or update the latest release
#   ./scripts/install.sh --ref v4.7.9a   install a specific tag
#   ./scripts/install.sh --force         reinstall even when already up to date
#   ./scripts/install.sh --source        build from source instead of downloading
#   ./scripts/install.sh --dir ~/games/breakmine
#
set -euo pipefail

REPO="Breakmine-Team/breakmine-revived"
API="https://api.github.com/repos/${REPO}"

REF="main"
FORCE=0
FROM_SOURCE=0
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
warn()  { printf '    %s !!%s %s%s%s\n' "$YELLOW" "$RESET" "$YELLOW" "$*" "$RESET" >&2; }
die()   { printf '%s xx%s %s%s%s\n' "$RED" "$RESET" "$RED" "$*" "$RESET" >&2; exit 1; }

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

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    return 1
  fi
}

# ---------------------------------------------------------------- args

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)   REF="${2:?--ref needs a value}"; shift 2 ;;
    --dir)   INSTALL_DIR="${2:?--dir needs a value}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --source) FROM_SOURCE=1; shift ;;
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

# GITHUB_TOKEN is optional and only lifts the 60 requests/hour anonymous limit.
CURL_AUTH=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  CURL_AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

# ---------------------------------------------------------------- installed state

VERSION_FILE="$INSTALL_DIR/.breakmine-version"
INSTALLED_SHA=""
INSTALLED_REF=""
INSTALLED_RELEASE=""
INSTALLED_SOURCE=""
if [ -f "$VERSION_FILE" ]; then
  INSTALLED_SHA="$(sed -n 's/^sha=//p' "$VERSION_FILE" | head -n1)"
  INSTALLED_REF="$(sed -n 's/^ref=//p' "$VERSION_FILE" | head -n1)"
  INSTALLED_RELEASE="$(sed -n 's/^release=//p' "$VERSION_FILE" | head -n1)"
  INSTALLED_SOURCE="$(sed -n 's/^source=//p' "$VERSION_FILE" | head -n1)"
fi

if [ -f "$INSTALL_DIR/$APPIMAGE_NAME" ] && [ -z "$INSTALLED_SHA" ] && [ -z "$INSTALLED_RELEASE" ]; then
  warn "Found an install at $INSTALL_DIR but no version marker; treating it as unknown."
fi

# ---------------------------------------------------------------- release lookup

release_json() {
  # Echoes the release payload, or nothing when there is no such release.
  curl -fsSL --max-time 30 "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" "$1" 2>/dev/null || true
}

# Sets RELEASE_TAG / ASSET_URL / CHECKSUM_URL from a release payload.
# browser_download_url only ever appears on assets, and URLs contain no
# spaces, so they can be pulled out with grep instead of needing jq.
read_release() {
  local json="$1" url name urls
  # grep exits 1 when there is no match, which would kill the script under
  # set -e, hence the || true on every extraction.
  RELEASE_TAG="$(printf '%s' "$json" | grep -o '"tag_name": *"[^"]*"' | head -n1 | sed 's/^[^:]*: *"//; s/"$//' || true)"
  urls="$(printf '%s' "$json" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/^[^:]*: *"//; s/"$//' || true)"
  ASSET_URL=""
  CHECKSUM_URL=""
  while IFS= read -r url; do
    [ -n "$url" ] || continue
    name="${url##*/}"
    case "$name" in
      *.AppImage)             [ -n "$ASSET_URL" ] || ASSET_URL="$url" ;;
      *.AppImage.sha256|checksums.txt) CHECKSUM_URL="$url" ;;
    esac
  done <<EOF
$urls
EOF
}

RELEASE_TAG=""
ASSET_URL=""
CHECKSUM_URL=""

step "Looking for a published AppImage ($REF)"
if [ "$FROM_SOURCE" -eq 1 ]; then
  info "--source given, skipping the download."
else
  # A tag gets its own release; the default branch (and a commit sha, which
  # simply has no release) fall back to whatever was published last.
  if [ "$REF" != "main" ]; then
    read_release "$(release_json "${API}/releases/tags/${REF}")"
  fi
  if [ -z "$ASSET_URL" ]; then
    read_release "$(release_json "${API}/releases/latest")"
    if [ -n "$ASSET_URL" ] && [ "$REF" != "main" ] && [ "$RELEASE_TAG" != "$REF" ]; then
      warn "No release for '$REF'; using the latest one ($RELEASE_TAG) instead."
      warn "Pass --source to build '$REF' from a checkout instead."
    fi
  fi

  if [ -n "$ASSET_URL" ]; then
    info "release : $RELEASE_TAG"
    info "asset   : ${ASSET_URL##*/}"
    [ -n "$CHECKSUM_URL" ] && info "sha256  : published"
  else
    warn "No AppImage published yet; falling back to a source build."
  fi
fi

# The branch head is only needed to describe the source build, so a failure
# here is not fatal.
REMOTE_JSON="$(release_json "${API}/commits/${REF}")"
REMOTE_SHA=""
REMOTE_SHORT=""
REMOTE_DATE=""
if [ -n "$REMOTE_JSON" ]; then
  # grep -o then head: the commit payload also contains a nested tree "sha",
  # so a greedy pattern would happily report the wrong one. The top-level
  # commit "sha" is the first match in the document.
  REMOTE_SHA="$(printf '%s' "$REMOTE_JSON" | grep -o '"sha": "[0-9a-f]\{40\}"' | head -n1 | grep -o '[0-9a-f]\{40\}' || true)"
  REMOTE_SHORT="${REMOTE_SHA:0:7}"
  REMOTE_DATE="$(printf '%s' "$REMOTE_JSON" | grep -o '"date": "[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T' | head -n1 | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' || true)"
else
  warn "Could not read the remote commit (offline, rate limited, or bad ref '$REF'?)."
  warn "Set GITHUB_TOKEN to raise the API rate limit."
fi

# ---------------------------------------------------------------- already installed?

REINSTALL=0
if [ -f "$INSTALL_DIR/$APPIMAGE_NAME" ]; then
  step "Existing install found"
  info "location : $INSTALL_DIR"
  info "version  : ${INSTALLED_RELEASE:-${INSTALLED_SHA:-unknown}}"
  info "kind     : ${INSTALLED_SOURCE:-source build}"
  info "ref      : ${INSTALLED_REF:-unknown}"

  if [ "$FORCE" -eq 0 ]; then
    if [ -n "$RELEASE_TAG" ] && [ "$RELEASE_TAG" = "$INSTALLED_RELEASE" ]; then
      step "Already up to date ($RELEASE_TAG)"
      info "Run with --force to reinstall anyway."
      exit 0
    fi
    # An older install from before releases existed only recorded a commit.
    if [ -z "$RELEASE_TAG" ] && [ -n "$REMOTE_SHA" ] && [ "$INSTALLED_SHA" = "$REMOTE_SHA" ]; then
      step "Already up to date (${REMOTE_SHORT:-$INSTALLED_SHA})"
      info "Run with --force to rebuild anyway."
      exit 0
    fi
  fi

  if [ -n "$ASSET_URL" ]; then
    info "release  : $RELEASE_TAG"
  elif [ -n "$REMOTE_SHA" ]; then
    info "remote   : $REMOTE_SHORT ($REMOTE_DATE)"
  fi

  if confirm "Update to ${RELEASE_TAG:-the latest commit}?" "y"; then
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

# ---------------------------------------------------------------- fetch the AppImage

WORKDIR="$(mktemp -d)"
APPIMAGE_FETCHED=""

if [ -n "$ASSET_URL" ]; then
  step "Downloading $RELEASE_TAG"
  info "$ASSET_URL"

  if ! curl -fL --retry 3 --retry-delay 2 --max-time 1800 --progress-bar \
          "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" -o "$WORKDIR/appimage" "$ASSET_URL"; then
    die "Download failed. Check your connection and try again."
  fi

  if [ -n "$CHECKSUM_URL" ]; then
    if curl -fsSL --max-time 60 "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" \
            -o "$WORKDIR/appimage.sha256" "$CHECKSUM_URL"; then
      # sha256sum output: the digest, then the file name. Accept either a
      # sibling <asset>.sha256 or a checksums.txt listing.
      EXPECTED_SHA="$(grep -o '[0-9a-fA-F]\{64\}' "$WORKDIR/appimage.sha256" | head -n1 || true)"
      ACTUAL_SHA="$(sha256_of "$WORKDIR/appimage" || true)"
      if [ -z "$ACTUAL_SHA" ]; then
        warn "No sha256sum/shasum available; skipping checksum verification."
      elif [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
        die "Checksum mismatch for the downloaded AppImage. Refusing to install it."
      else
        info "checksum ok ($ACTUAL_SHA)"
      fi
    else
      warn "Could not fetch the published checksum; continuing unverified."
    fi
  fi

  APPIMAGE_FETCHED="$WORKDIR/appimage"
else
  step "Building from source ($REF)"

  need_cmd tar  "Install it with: sudo apt install tar"
  need_cmd node "Install Node 22 or newer from https://nodejs.org"
  need_cmd npm  "It ships with Node."
  info "node $(node --version), npm $(npm --version)"

  # The tarball endpoint resolves branches, tags and commit SHAs alike, which
  # avoids having to guess refs/heads vs refs/tags.
  TARBALL_URL="${API}/tarball/${REF}"
  info "$TARBALL_URL"

  if ! curl -fL --retry 3 --retry-delay 2 --max-time 600 \
          "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" -o "$WORKDIR/source.tar.gz" "$TARBALL_URL"; then
    die "Download failed. Check the ref '$REF' and your connection."
  fi

  tar -xzf "$WORKDIR/source.tar.gz" -C "$WORKDIR" --strip-components=1

  if [ ! -f "$WORKDIR/package.json" ]; then
    die "Downloaded archive does not look like the game (no package.json)."
  fi

  step "Installing build dependencies"
  cd "$WORKDIR"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    warn "No package-lock.json found; falling back to npm install."
    npm install --no-audit --no-fund
  fi

  step "Packaging the AppImage (this takes a few minutes)"
  # appbuild.js embeds the assets, runs vite and drives electron-builder, so
  # the source build produces exactly what the release asset is.
  node appbuild.js --linux

  APPIMAGE_BUILT=""
  for candidate in release/*.AppImage; do
    [ -e "$candidate" ] && APPIMAGE_BUILT="$candidate" && break
  done
  [ -n "$APPIMAGE_BUILT" ] || die "appbuild.js produced no AppImage (look above for the error)."
  cd "$OLDPWD"

  APPIMAGE_FETCHED="$APPIMAGE_BUILT"
fi

# ---------------------------------------------------------------- install

step "Installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
if [ "$REINSTALL" -eq 1 ]; then
  info "replacing previous build"
fi

# Write to a temporary name first so an interrupted copy cannot leave a
# half-written AppImage that fails to launch next time.
cp "$APPIMAGE_FETCHED" "$INSTALL_DIR/$APPIMAGE_NAME.new"
chmod +x "$INSTALL_DIR/$APPIMAGE_NAME.new"
mv -f "$INSTALL_DIR/$APPIMAGE_NAME.new" "$INSTALL_DIR/$APPIMAGE_NAME"

if [ -n "$ASSET_URL" ]; then
  SOURCE_KIND="release"
else
  SOURCE_KIND="source"
fi

cat > "$VERSION_FILE" <<EOF
sha=$REMOTE_SHA
ref=$REF
release=$RELEASE_TAG
source=$SOURCE_KIND
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
# usr/share/icons/hicolor/512x512/apps/breakmine.png, so the checkout's copy
# and the AppImage's are the same artwork. Prefer the checkout, and fall back
# to unpacking the AppImage so a download-only run still gets a menu icon.
ICON_SRC=""
for candidate in "$PWD/src/resources/favicon.png" "$WORKDIR/src/resources/favicon.png"; do
  if [ -f "$candidate" ]; then ICON_SRC="$candidate"; break; fi
done

if [ -z "$ICON_SRC" ] && [ "$SOURCE_KIND" = "release" ]; then
  if (cd "$WORKDIR" && "$INSTALL_DIR/$APPIMAGE_NAME" --appimage-extract \
          'usr/share/icons/hicolor/*/apps/*.png' >/dev/null 2>&1); then
    ICON_SRC="$(find "$WORKDIR/squashfs-root/usr/share/icons" -name '*.png' 2>/dev/null | sort | head -n1)"
  fi
fi

if [ -n "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_DIR/breakmine.png"
else
  warn "No icon found; the menu entry will use a placeholder."
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
info "binary  : $INSTALL_DIR/$APPIMAGE_NAME"
info "version : ${RELEASE_TAG:-$REMOTE_SHA} ($SOURCE_KIND)"
info "launcher: $DESKTOP_DIR/breakmine.desktop"
info "mods    : $INSTALL_DIR/mods"
printf '\n'
info "Launch it from your application menu, or:"
printf '\n        %s%s%s\n\n' "$BOLD" "$INSTALL_DIR/$APPIMAGE_NAME" "$RESET"
info "Re-run this script any time to check for and install an update."
info "Uninstall by removing $INSTALL_DIR and $DESKTOP_DIR/breakmine.desktop"