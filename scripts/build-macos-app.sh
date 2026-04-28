#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
APP_DIR="$BUILD_DIR/Taskathon.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
BUNDLE_APP_DIR="$RESOURCES_DIR/app"
ICON_SOURCE="$ROOT_DIR/desktop/TaskathonIcon.svg"
ICON_RENDER_HTML="$BUILD_DIR/TaskathonIcon-render.html"
ICON_PNG="$BUILD_DIR/TaskathonIcon-1024.png"
ICON_RAW_PNG="$BUILD_DIR/TaskathonIcon-raw.png"
ICONSET_DIR="$BUILD_DIR/TaskathonIcon.iconset"
ICON_FILE="$RESOURCES_DIR/TaskathonIcon.icns"
ICON_FILE_EXPORT="$BUILD_DIR/TaskathonIcon.icns"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
APP_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$ROOT_DIR/package.json")"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$BUNDLE_APP_DIR" "$BUILD_DIR"

swiftc "$ROOT_DIR/desktop/TaskathonApp.swift" \
  -o "$MACOS_DIR/Taskathon" \
  -framework AppKit \
  -framework WebKit

cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>Taskathon</string>
  <key>CFBundleIdentifier</key>
  <string>local.taskathon.notionlite</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Taskathon</string>
  <key>CFBundleIconFile</key>
  <string>TaskathonIcon</string>
  <key>CFBundleIconName</key>
  <string>TaskathonIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>APP_VERSION_PLACEHOLDER</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
PLIST
perl -0pi -e "s/APP_VERSION_PLACEHOLDER/$APP_VERSION/g" "$CONTENTS_DIR/Info.plist"

if [[ ! -x "$CHROME" ]]; then
  echo "Error: Google Chrome is required to render the app icon at $CHROME." >&2
  exit 1
fi

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
cat > "$ICON_RENDER_HTML" <<HTML
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html,
      body {
        width: 1024px;
        height: 1024px;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }

      body {
        display: grid;
        place-items: center;
      }

      img {
        width: 884px;
        height: 884px;
        display: block;
        transform: translateY(28px);
      }
    </style>
  </head>
  <body>
    <img src="file://$ICON_SOURCE" alt="">
  </body>
</html>
HTML
"$CHROME" \
  --headless \
  --disable-gpu \
  --hide-scrollbars \
  --default-background-color=00000000 \
  --window-size=1024,1111 \
  --screenshot="$ICON_RAW_PNG" \
  "file://$ICON_RENDER_HTML" >/dev/null 2>&1

sips -c 1024 1024 --cropOffset 0 0 "$ICON_RAW_PNG" --out "$ICON_PNG" >/dev/null

sips -z 16 16 "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$ICON_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET_DIR" -o "$ICON_FILE"
cp "$ICON_FILE" "$ICON_FILE_EXPORT"

cp "$ROOT_DIR/package.json" "$BUNDLE_APP_DIR/package.json"
cp -R "$ROOT_DIR/src" "$BUNDLE_APP_DIR/src"
cp -R "$ROOT_DIR/public" "$BUNDLE_APP_DIR/public"
cp -R "$ROOT_DIR/mcp" "$BUNDLE_APP_DIR/mcp"
mkdir -p "$BUNDLE_APP_DIR/data"
cp "$ROOT_DIR/data/workspace.json" "$BUNDLE_APP_DIR/data/workspace.json"

chmod +x "$MACOS_DIR/Taskathon"
touch "$APP_DIR"
echo "Built $APP_DIR"
