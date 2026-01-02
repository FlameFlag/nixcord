{
  lib,
  pkgs,
  cfg,
  config,
  mkVencordCfg,
  wrapScript,
}:
let
  userName = cfg.user;
  userHome = if pkgs.stdenvNoCC.isDarwin then "/Users/${userName}" else "/home/${userName}";
  xdgHome = "${userHome}/.config";
in
{
  disableDiscordUpdates = wrapScript ''
    set -euo pipefail
    mkdir -p "${cfg.discord.configDir}"
    config_dir="${cfg.discord.configDir}"
    if [ -f "$config_dir/settings.json" ]; then
      jq '. + {"SKIP_HOST_UPDATE": true}' "$config_dir/settings.json" > "$config_dir/settings.json.tmp" && mv "$config_dir/settings.json.tmp" "$config_dir/settings.json"
    else
      echo '{"SKIP_HOST_UPDATE": true}' > "$config_dir/settings.json"
    fi
  '';

  fixDiscordModules = wrapScript ''
    set -euo pipefail

    config_base="${
      if pkgs.stdenvNoCC.isDarwin then "${userHome}/Library/Application Support" else "${xdgHome}"
    }"

    for branch in discord discord-ptb discord-canary discord-development; do
      config_dir="$config_base/$branch"
      [ ! -d "$config_dir" ] && continue
      cd "$config_dir" || continue
      versions=($(ls -1d [0-9]*.[0-9]*.[0-9]* 2>/dev/null | sort -V || true))
      n=''${#versions[@]}
      if [ "$n" -ge 2 ]; then
        prev="''${versions[$((n-2))]}"
        curr="''${versions[$((n-1))]}"
        prev_modules="$config_dir/$prev/modules"
        curr_modules="$config_dir/$curr/modules"
        if [ ! -d "$curr_modules" ] || [ "$(ls -A "$curr_modules" 2>/dev/null | grep -v '^pending$' | wc -l)" -eq 0 ]; then
          if [ -d "$prev_modules" ]; then
            echo "Copying Discord modules for $branch from $prev to $curr"
            rm -rf "$curr_modules"
            cp -a "$prev_modules" "$curr_modules"
          fi
        fi
      fi
    done
  '';

  setupDorionVencordSettings = wrapScript ''
    set -euo pipefail

    webkit_base_dir="${
      if pkgs.stdenvNoCC.isDarwin then
        "${userHome}/Library/WebKit/com.spikehd.dorion/WebsiteData/Default"
      else
        "${userHome}/.local/share/dorion/profiles/default/webdata/localstorage"
    }"

    encode_utf16le() {
      local input="$1"
      echo -n "$input" | ${lib.getExe' pkgs.iconv "iconv"} -f UTF-8 -t UTF-16LE | ${lib.getExe pkgs.xxd} -p | tr -d '\n' | tr '[:lower:]' '[:upper:]'
    }

    vencord_settings='${builtins.toJSON (mkVencordCfg (lib.attrsets.recursiveUpdate cfg.config cfg.extraConfig))}'

    sqlite_paths=()
    for sqlite_file in $(find "$webkit_base_dir" \( -name "*.sqlite3" -o -name "*.localstorage" \) -type f 2>/dev/null); do
      if ${lib.getExe pkgs.sqlite} "$sqlite_file" "SELECT COUNT(*) FROM ItemTable WHERE key = 'VencordSettings';" 2>/dev/null | grep -q "1"; then
        sqlite_paths+=("$sqlite_file")
      fi
    done

    encoded_settings=$(encode_utf16le "$vencord_settings")

    for sqlite_path in "''${sqlite_paths[@]}"; do
      ${lib.getExe pkgs.sqlite} "$sqlite_path" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('VencordSettings', X'$encoded_settings');"
    done
  '';
}
