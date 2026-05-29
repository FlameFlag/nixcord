#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

store_modules=$1

if [[ "${DISCORD_STAGE_PLATFORM:?}" = darwin ]]; then
  config_dir="$HOME/Library/Application Support/${DISCORD_CONFIG_DIR_NAME:?}"
  module_data_dir="$config_dir/module_data"
else
  config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/${DISCORD_CONFIG_DIR_NAME:?}"
fi

modules_dir="$config_dir/${DISCORD_VERSION:?}/modules"
staged_modules=" ${DISCORD_STAGED_MODULES:-} "

replace_link() {
  local src=$1
  local dest=$2

  if [[ -L "$dest" ]]; then
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    chmod -R u+w "$dest" 2>/dev/null || true
    rm -rf "$dest"
  fi
  ln -s "$src" "$dest"
}

copy_module() {
  local src=$1
  local dest=$2

  if [[ -L "$dest" ]]; then
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    chmod -R u+w "$dest" 2>/dev/null || true
    rm -rf "$dest"
  fi
  cp -R "$src" "$dest"
  chmod -R u+w "$dest"
}

prune_unstaged_modules() {
  local dir=$1
  local path
  local module

  [[ -d "$dir" ]] || return 0
  for path in "$dir"/discord_*; do
    [[ -e "$path" ]] || continue
    module=$(basename "$path")
    case "$staged_modules" in
      *" $module "*) ;;
      *)
        if [[ -L "$path" ]]; then
          rm "$path"
        else
          chmod -R u+w "$path" 2>/dev/null || true
          rm -rf "$path"
        fi
        rm -f "$dir/pending/$module"-*.zip 2>/dev/null || true
        ;;
    esac
  done
}

if [[ "${DISCORD_STAGE_PLATFORM:?}" = darwin ]]; then
  mkdir -p "$modules_dir" "$module_data_dir"
else
  mkdir -p "$modules_dir"
fi

settings_file="$config_dir/settings.json"
if [[ -f "$settings_file" ]]; then
  jq ". + ${DISCORD_DISABLED_UPDATE_SETTINGS_JSON:?}" "$settings_file" > "$settings_file.tmp"
  mv "$settings_file.tmp" "$settings_file"
else
  printf '%s\n' "${DISCORD_DISABLED_UPDATE_SETTINGS_JSON:?}" > "$settings_file"
fi

prune_unstaged_modules "$modules_dir"
if [[ "${DISCORD_STAGE_PLATFORM:?}" = darwin ]]; then
  prune_unstaged_modules "$module_data_dir"
fi

for module in ${DISCORD_STAGED_MODULES:-}; do
  if [[ "$module" = discord_krisp ]]; then
    copy_module "$store_modules/$module" "$modules_dir/$module"
  else
    replace_link "$store_modules/$module" "$modules_dir/$module"
  fi

  if [[ "${DISCORD_STAGE_PLATFORM:?}" = darwin ]]; then
    if [[ "$module" = discord_krisp ]]; then
      copy_module "$store_modules/$module" "$module_data_dir/$module"
    else
      replace_link "$store_modules/$module" "$module_data_dir/$module"
    fi
  fi
done

printf '%s\n' "${DISCORD_INSTALLED_MODULES_JSON:?}" > "$modules_dir/installed.json.tmp"
mv "$modules_dir/installed.json.tmp" "$modules_dir/installed.json"
