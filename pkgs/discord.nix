{
  stdenvNoCC,
  stdenv,
  fetchurl,
  lib,
  discord,
  discord-ptb ? null,
  discord-canary ? null,
  discord-development ? null,
  writeShellApplication,
  cacert,
  curl,
  gnugrep,
  nix,
  openasar ? null,
  # Bootstrap launcher (Linux only)
  patchelf,
  # Krisp noise cancellation patching
  python3,
  runCommand,
  unzip,
  darwin ? null,

  # Options
  branch ? "stable",
  withVencord ? false,
  vencord ? null,
  withEquicord ? false,
  equicord ? null,
  withOpenASAR ? false,
  enableAutoscroll ? false,
  withKrisp ? false,
}:
let
  versions = {
    linux = {
      stable = "0.0.135";
      ptb = "1.0.188";
      canary = "1.0.1000";
      development = "1.0.979";
    };
    darwin = {
      stable = "0.0.388";
      ptb = "0.0.231";
      canary = "0.0.1092";
      development = "1.0.986";
    };
  };

  hashes = {
    x86_64-linux = {
      stable = "sha256-vMuoz1OR0cKvrfT/ilkNXEtEP3zEwyNGh6AW5iQADws=";
      ptb = "sha256-1ZtR93aKhbMCVcf9pZjJEPz8YjZLOT6Ob8fjyyBK0Ho=";
      canary = "sha256-Ck/fwWF3C+NseNbcySn72LJo6N3T+6eAhuYW9os7CGw=";
      development = "sha256-wuJoy9bo7VGt6780bkOuATWrlWgh1xz8uCxPbZrr0vw=";
    };
    x86_64-darwin = {
      stable = "sha256-3V0nE7py19j19TYHBJC9hjMnzLdUlHVQM7Buo9rcQSE=";
      ptb = "sha256-WlygpcUv+CrmQdZyZ0t3EEb58oopHetbKQbKsLUdI1w=";
      canary = "sha256-KN3fUYKVjIZ0WhSu7wt47hF7pjlNdxjk7LTKeZxAsRQ=";
      development = "sha256-KsogBfAyP32BZQR4AsNglQQoxXfbEUnEiHxTikQulA0=";
    };
  };

  # Krisp noise-cancellation module hashes (per-version, per-platform)
  # These are updated by the discord-update script alongside the main hashes.
  krispHashes = {
    x86_64-linux = {
      stable = "sha256-W4Yn0p6CfMlejJq8juqu0kaLfWD9BsJ1kVeJc17CLVY=";
      ptb = "sha256-736dFpURSAAlCO0HZk2itPYQ9ejKMFPPghN+vfkpV7c=";
      canary = "sha256-27fmwWLBHyfMn633hfLTWuBKTDgIj6OZfDDbeQGU2lw=";
      development = "sha256-dqqL5j4EilTj2A9ijTi5l0neGkXjEIwHjW8YWEN1SNU=";
    };
    x86_64-darwin = {
      stable = "sha256-+PHxoDNOpaz6bBLH129aO+2uxGI+ir8I6AX+3K+Gk6E=";
      ptb = "sha256-LAKYuVtu0jZxSgKgXBgg26vheY4BW7OuNIx1+XpC5TY=";
      canary = "sha256-50maX/vlThWPwQgYEzQZyFlK0DsQuLBT1vJ6QS1fHqM=";
      development = "sha256-hbm/bxQU/YyUYm7aXUfq0E1OTD4FKRDyyPabgzJK4z0=";
    };
  };

  srcs = {
    x86_64-linux = {
      stable = fetchurl {
        url = "https://stable.dl2.discordapp.net/apps/linux/${versions.linux.stable}/discord-${versions.linux.stable}.tar.gz";
        hash = hashes.x86_64-linux.stable;
      };
      ptb = fetchurl {
        url = "https://ptb.dl2.discordapp.net/apps/linux/${versions.linux.ptb}/discord-ptb-${versions.linux.ptb}.tar.gz";
        hash = hashes.x86_64-linux.ptb;
      };
      canary = fetchurl {
        url = "https://canary.dl2.discordapp.net/apps/linux/${versions.linux.canary}/discord-canary-${versions.linux.canary}.tar.gz";
        hash = hashes.x86_64-linux.canary;
      };
      development = fetchurl {
        url = "https://development.dl2.discordapp.net/apps/linux/${versions.linux.development}/discord-development-${versions.linux.development}.tar.gz";
        hash = hashes.x86_64-linux.development;
      };
    };
    x86_64-darwin = {
      stable = fetchurl {
        url = "https://stable.dl2.discordapp.net/apps/osx/${versions.darwin.stable}/Discord.dmg";
        hash = hashes.x86_64-darwin.stable;
      };
      ptb = fetchurl {
        url = "https://ptb.dl2.discordapp.net/apps/osx/${versions.darwin.ptb}/DiscordPTB.dmg";
        hash = hashes.x86_64-darwin.ptb;
      };
      canary = fetchurl {
        url = "https://canary.dl2.discordapp.net/apps/osx/${versions.darwin.canary}/DiscordCanary.dmg";
        hash = hashes.x86_64-darwin.canary;
      };
      development = fetchurl {
        url = "https://development.dl2.discordapp.net/apps/osx/${versions.darwin.development}/DiscordDevelopment.dmg";
        hash = hashes.x86_64-darwin.development;
      };
    };
    aarch64-darwin = srcs.x86_64-darwin;
    aarch64-linux = throw "Discord does not provide official aarch64-linux builds.";
  };

  # Krisp module zip sources (fetched from Discord's CDN alongside the main tarball)
  krispSrcs = {
    x86_64-linux = {
      stable = fetchurl {
        url = "https://stable.dl2.discordapp.net/apps/linux/${versions.linux.stable}/modules/discord_krisp-1.zip";
        hash = krispHashes.x86_64-linux.stable;
      };
      ptb = fetchurl {
        url = "https://ptb.dl2.discordapp.net/apps/linux/${versions.linux.ptb}/modules/discord_krisp-1.zip";
        hash = krispHashes.x86_64-linux.ptb;
      };
      canary = fetchurl {
        url = "https://canary.dl2.discordapp.net/apps/linux/${versions.linux.canary}/modules/discord_krisp-1.zip";
        hash = krispHashes.x86_64-linux.canary;
      };
      development = fetchurl {
        url = "https://development.dl2.discordapp.net/apps/linux/${versions.linux.development}/modules/discord_krisp-1.zip";
        hash = krispHashes.x86_64-linux.development;
      };
    };
    x86_64-darwin = {
      stable = fetchurl {
        url = "https://stable.dl2.discordapp.net/apps/osx/${versions.darwin.stable}/modules/discord_krisp-1.zip";
        hash = krispHashes.x86_64-darwin.stable;
      };
      ptb = fetchurl {
        url = "https://ptb.dl2.discordapp.net/apps/osx/${versions.darwin.ptb}/modules/discord_krisp-1.zip";
        hash = krispHashes.x86_64-darwin.ptb;
      };
      canary = fetchurl {
        url = "https://canary.dl2.discordapp.net/apps/osx/${versions.darwin.canary}/modules/discord_krisp-1.zip";
        hash = krispHashes.x86_64-darwin.canary;
      };
      development = fetchurl {
        url = "https://development.dl2.discordapp.net/apps/osx/${versions.darwin.development}/modules/discord_krisp-1.zip";
        hash = krispHashes.x86_64-darwin.development;
      };
    };
    aarch64-darwin = krispSrcs.x86_64-darwin;
    aarch64-linux = throw "Discord does not provide official aarch64-linux builds.";
  };

  currentPlatform = if stdenvNoCC.hostPlatform.isLinux then "linux" else "darwin";
  currentSystem = stdenvNoCC.hostPlatform.system;
  version = versions.${currentPlatform}.${branch};
  src = srcs.${currentSystem}.${branch};
  krispSrc = if withKrisp then krispSrcs.${currentSystem}.${branch} else null;

  variantPackages = {
    stable = discord;
    ptb = discord-ptb;
    canary = discord-canary;
    development = discord-development;
  };
  basePackage = variantPackages.${branch};

  binaryName =
    if stdenvNoCC.isLinux then
      {
        stable = "Discord";
        ptb = "DiscordPTB";
        canary = "DiscordCanary";
        development = "DiscordDevelopment";
      }
      .${branch}
    else
      {
        stable = "Discord";
        ptb = "Discord PTB";
        canary = "Discord Canary";
        development = "Discord Development";
      }
      .${branch};

  resourcesDir =
    if stdenvNoCC.isLinux then
      "$out/opt/${binaryName}/resources"
    else
      "\"$out/Applications/${binaryName}.app/Contents/Resources\"";

  # Bootstrap launcher for Discord Development >= 0.0.235 on Linux.
  # Starting with that version, the linux tarball only ships a small
  # `updater_bootstrap` ELF that downloads the real app on first run.
  # This script runs at launch time to perform the bootstrap if needed,
  # then stages bundled native modules and execs the real binary.
  bootstrapLauncher =
    if stdenvNoCC.isLinux then
      writeShellApplication {
        name = binaryName;
        runtimeInputs = [ patchelf ];
        text = ''
          host_dir=''${XDG_CONFIG_HOME:-$HOME/.config}/${lib.toLower binaryName}
          app_dir=$host_dir/app-${version}
          discord_host=$host_dir/${binaryName}

          if [ ! -e "$discord_host" ]; then
            self_dir=$(dirname "$(readlink -f "$0")")
            mkdir -p "$host_dir"
            echo "Bootstrapping ${binaryName} into $host_dir..." >&2

            # The bootstrap streams progress as standalone integer percentages,
            # repeating the same value many times. Dedupe consecutive values.
            last=
            "$self_dir/updater_bootstrap" "$host_dir" https://updates.discord.com/ ${branch} "$host_dir" 2>&1 \
              | while IFS= read -r line; do
                  case "$line" in
                    ""|*[!0-9]*)
                      printf '%s\n' "$line" >&2
                      ;;
                    *)
                      if [ "$line" != "$last" ]; then
                        printf '  bootstrap progress: %s%%\n' "$line" >&2
                        last=$line
                      fi
                      ;;
                  esac
                done

            for bin in ${binaryName} chrome_crashpad_handler chrome-sandbox; do
              [ -f "$app_dir/$bin" ] || continue
              chmod +x "$app_dir/$bin"
              patchelf --set-interpreter ${stdenv.cc.bintools.dynamicLinker} "$app_dir/$bin"
            done
            ln -sfn "$app_dir/${binaryName}" "$discord_host"
          fi

          # Stage bundled native modules where Discord expects them.
          # Independent of the bootstrap check so older installs self-heal.
          modules_dst=$host_dir/${version}/modules
          if [ -d "$app_dir/modules" ] && [ ! -f "$modules_dst/installed.json" ]; then
            mkdir -p "$modules_dst/pending"
            entries=()
            for verdir in "$app_dir"/modules/*/; do
              base=$(basename "$verdir")
              entries+=("\"''${base%-*}\": {\"installedVersion\": ''${base##*-}}")
              for inner in "$verdir"*/; do
                ln -sfn "$inner" "$modules_dst/$(basename "$inner")"
              done
            done
            printf '{%s}\n' "$(IFS=,; echo "''${entries[*]}")" > "$modules_dst/installed.json"
          fi

          exec "$discord_host" "$@"
        '';
      }
    else
      null;

  # Python scripts fetched directly from nixpkgs PR #506089
  # (NixOS/nixpkgs@53d44f06faec425be8ab9986246d299f7d91a64f)
  patchKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/53d44f06faec425be8ab9986246d299f7d91a64f/pkgs/applications/networking/instant-messengers/discord/patch-krisp.py";
    hash = "sha256-YVYrkh++kWlIbXfeoFmrS9PHz4CshQNs2lB3OGBLmS4=";
  };

  deployKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/53d44f06faec425be8ab9986246d299f7d91a64f/pkgs/applications/networking/instant-messengers/discord/deploy-krisp.py";
    hash = "sha256-yWjakVKH+wsFOXgEYsBfx4wBiXecODA481yi9PUSUuM=";
  };

  # Patched Krisp noise-cancellation module.
  # On Linux: patch the ELF to bypass signature verification.
  # On macOS: patch the Mach-O and re-sign with an ad-hoc signature.
  patchedKrisp =
    if withKrisp && krispSrc != null then
      if stdenvNoCC.isLinux then
        runCommand "discord-krisp-patched"
          {
            nativeBuildInputs = [
              unzip
              (python3.withPackages (ps: [ ps.lief ]))
            ];
          }
          ''
            mkdir -p "$out"
            unzip ${krispSrc} -d "$out"
            python3 ${patchKrispPy} "$out/discord_krisp.node"
          ''
      else
        runCommand "discord-krisp-patched"
          {
            nativeBuildInputs = [
              unzip
              (python3.withPackages (ps: [ ps.lief ]))
            ];
          }
          ''
            mkdir -p "$out"
            unzip ${krispSrc} -d "$out"
            python3 ${patchKrispPy} "$out/discord_krisp.node"
            source ${darwin.signingUtils}
            sign "$out/discord_krisp.node"
          ''
    else
      null;

  # Runtime deployer: copies the patched Krisp module into Discord's config dir
  # before Discord starts, using a SHA-256 marker to skip redundant redeploys.
  deployKrisp =
    if withKrisp && patchedKrisp != null then
      runCommand "deploy-krisp.py"
        {
          pythonInterpreter = "${python3.interpreter}";
          krispPath = "${patchedKrisp}";
          discordVersion = version;
          configDirName = lib.toLower binaryName;
          meta.mainProgram = "deploy-krisp.py";
        }
        ''
          mkdir -p "$out/bin"
          cp ${deployKrispPy} "$out/bin/deploy-krisp.py"
          substituteAllInPlace "$out/bin/deploy-krisp.py"
          chmod +x "$out/bin/deploy-krisp.py"
        ''
    else
      null;

  updateScript = writeShellApplication {
    name = "discord-update";
    runtimeInputs = [
      cacert
      nix
      curl
      gnugrep
    ];
    text = ''
      NIX_FILE="./pkgs/discord.nix"

      # Resolve nixpkgs once up front
      NIXPKGS_PATH=$(nix eval --impure --raw --expr "(builtins.getFlake (toString ./.)).inputs.nixpkgs.outPath" 2>/dev/null || echo "")
      if [[ -z "$NIXPKGS_PATH" ]]; then
        echo "Warning: could not resolve flake nixpkgs, falling back to <nixpkgs>"
      fi

      # Load all current state in one nix eval call.
      # Nix outputs flat key=value lines we can source directly into an associative array.
      load_current_state() {
        local expr
        if [[ -n "$NIXPKGS_PATH" ]]; then
          expr='let pkgs = import '"$NIXPKGS_PATH"' {}; d = pkgs.callPackage ./pkgs/discord.nix {};'
        else
          expr='let pkgs = import <nixpkgs> {}; d = pkgs.callPackage ./pkgs/discord.nix {};'
        fi
        # shellcheck disable=SC2016
        expr+=' flatten = prefix: attrs: builtins.concatLists (builtins.attrValues (builtins.mapAttrs (k: v: if builtins.isAttrs v then flatten (prefix + k + ".") v else [ "''${prefix}''${k}=''${v}" ]) attrs));'
        # shellcheck disable=SC2016
        expr+=' in builtins.concatStringsSep "\n" (flatten "" { inherit (d.passthru) versions hashes krispHashes; })'

        local output
        if ! output=$(nix eval --raw --impure --expr "$expr" 2>&1); then
          echo "Error: nix eval failed:" >&2
          echo "$output" >&2
          exit 1
        fi
        while IFS= read -r line; do
          [[ -z "$line" ]] && continue
          local key="''${line%%=*}"
          local value="''${line#*=}"
          STATE["$key"]="$value"
        done <<< "$output"
      }

      declare -A STATE
      echo "Loading current state from discord.nix..."
      load_current_state
      echo "State loaded."

      get_discord_url() {
        local branch="$1"
        local platform="$2"
        local format="$3"
        curl -sI -L -o /dev/null -w '%{url_effective}' "https://discord.com/api/download/$branch?platform=$platform&format=$format"
      }

      extract_version_from_url() {
        local url="$1"
        local platform="$2"
        echo "$url" | grep -oP "apps/$platform/\K([0-9]+\.[0-9]+\.[0-9]+)"
      }

      prefetch_and_convert_hash() {
        local url="$1"
        local raw_hash
        raw_hash=$("${nix}/bin/nix-prefetch-url" --type sha256 "$url")
        nix hash convert --to sri --hash-algo sha256 "$raw_hash"
      }

      # Replace: branch = "old"; -> branch = "new"; (first occurrence only)
      replace_value() {
        local key="$1"
        local old_val="$2"
        local new_val="$3"
        sed -i.bak "0,\\|''${key} = \"''${old_val}\";|s|''${key} = \"''${old_val}\";|''${key} = \"''${new_val}\";|" "$NIX_FILE" && rm -f "$NIX_FILE.bak"
      }

      update_platform() {
        local branch="$1"
        local platform="$2"     # linux or darwin
        local nix_system="$3"   # x86_64-linux or x86_64-darwin
        local new_version="$4"
        local download_url="$5"

        local old_version="''${STATE[versions.$platform.$branch]}"

        if [[ "$old_version" = "$new_version" ]]; then
          echo "  $platform already up to date ($new_version)"
          return 0
        fi

        echo "  $platform: $old_version -> $new_version"

        # Version changed — now we prefetch
        local new_hash
        new_hash=$(prefetch_and_convert_hash "$download_url")

        local old_hash="''${STATE[hashes.$nix_system.$branch]}"

        replace_value "$branch" "$old_version" "$new_version"
        replace_value "$branch" "$old_hash" "$new_hash"

        # Update krisp hash
        local cdn_platform
        if [[ "$platform" = "linux" ]]; then cdn_platform="linux"; else cdn_platform="osx"; fi
        local krisp_url="https://$branch.dl2.discordapp.net/apps/$cdn_platform/$new_version/modules/discord_krisp-1.zip"
        if krisp_hash=$(prefetch_and_convert_hash "$krisp_url" 2>/dev/null); then
          local old_krisp="''${STATE[krispHashes.$nix_system.$branch]}"
          if [[ "$old_krisp" != "$krisp_hash" ]]; then
            replace_value "$branch" "$old_krisp" "$krisp_hash"
          fi
        else
          echo "  Could not fetch krisp for $platform/$branch (non-fatal)"
        fi
      }

      # Respect DISCORD_BRANCHES env var if set (CI sets this per matrix job),
      # otherwise default to all branches.
      if [[ -n "''${DISCORD_BRANCHES:-}" ]]; then
        IFS=',' read -ra BRANCHES <<< "$DISCORD_BRANCHES"
      else
        BRANCHES=(stable ptb canary development)
      fi

      for BRANCH in "''${BRANCHES[@]}"; do
        echo "Checking Discord $BRANCH..."

        linux_url=$(get_discord_url "$BRANCH" "linux" "tar.gz")
        linux_version=$(extract_version_from_url "$linux_url" "linux")
        update_platform "$BRANCH" "linux" "x86_64-linux" "$linux_version" "$linux_url"

        darwin_url=$(get_discord_url "$BRANCH" "osx" "dmg")
        darwin_version=$(extract_version_from_url "$darwin_url" "osx")
        update_platform "$BRANCH" "darwin" "x86_64-darwin" "$darwin_version" "$darwin_url"

        echo "Done with Discord $BRANCH (linux=$linux_version, darwin=$darwin_version)"
      done
    '';
  };
in
basePackage.overrideAttrs (oldAttrs: {
  inherit version src;
  passthru = (oldAttrs.passthru or { }) // {
    inherit
      updateScript
      versions
      hashes
      krispHashes
      ;
  };

  # Bootstrap tarball support for Discord on Linux.
  # Newer tarballs (development >= 0.0.235, canary >= 1.x) switched from shipping
  # the full app directly to shipping only a small `updater_bootstrap` ELF. We
  # copy it as a placeholder so the base installPhase's chmod+patchelf succeed,
  # then swap it out in postInstall.
  preInstall =
    (oldAttrs.preInstall or "")
    + lib.optionalString stdenvNoCC.isLinux ''
      if [ ! -f ${binaryName} ] && [ -f updater_bootstrap ]; then
        echo "[nixcord] bootstrap tarball detected; creating placeholder for installPhase"
        cp updater_bootstrap ${binaryName}
      fi
    '';

  postInstall =
    (oldAttrs.postInstall or "")
    # Replace the patchelfd placeholder with the real bootstrap launcher.
    # wrapProgramShell renames the original to .${binaryName}-wrapped; we
    # replace that file while leaving the wrapper script intact.
    + lib.optionalString stdenvNoCC.isLinux ''
      if [ -f "$out/opt/${binaryName}/updater_bootstrap" ] && \
         [ -f "$out/opt/${binaryName}/.${binaryName}-wrapped" ]; then
        echo "[nixcord] installing bootstrap launcher"
        install -Dm755 ${bootstrapLauncher}/bin/${binaryName} \
            "$out/opt/${binaryName}/.${binaryName}-wrapped"
      fi
    ''
    + lib.optionalString (withOpenASAR && openasar != null) ''
      cp -f ${openasar} ${resourcesDir}/app.asar
    ''
    + lib.optionalString (withVencord && vencord != null) ''
      mv ${resourcesDir}/app.asar ${resourcesDir}/_app.asar
      mkdir ${resourcesDir}/app.asar
      echo '{"name":"discord","main":"index.js"}' > ${resourcesDir}/app.asar/package.json
      echo 'require("${vencord}/patcher.js")' > ${resourcesDir}/app.asar/index.js
    ''
    + lib.optionalString (withEquicord && equicord != null) ''
      mv ${resourcesDir}/app.asar ${resourcesDir}/_app.asar
      mkdir ${resourcesDir}/app.asar
      echo '{"name":"discord","main":"index.js"}' > ${resourcesDir}/app.asar/package.json
      echo 'require("${equicord}/desktop/patcher.js")' > ${resourcesDir}/app.asar/index.js
    '';

  postFixup =
    (oldAttrs.postFixup or "")
    # Deploy the patched Krisp module at launch time via an extra --run hook.
    + (
      if withKrisp && deployKrisp != null then
        if stdenvNoCC.isLinux then
          ''
            wrapProgramShell $out/opt/${binaryName}/${binaryName} \
              --run ${lib.getExe deployKrisp}
          ''
        else
          ''
            wrapProgram "$out/bin/${binaryName}" \
              --run ${lib.getExe deployKrisp}
          ''
      else
        ""
    )
    + lib.optionalString enableAutoscroll (
      if stdenvNoCC.isLinux then
        ''
          wrapProgramShell $out/opt/${binaryName}/${binaryName} \
            --add-flags "--enable-blink-features=MiddleClickAutoscroll"
        ''
      else
        ''
          wrapProgram "$out/bin/${binaryName}" \
            --add-flags "--enable-blink-features=MiddleClickAutoscroll"
        ''
    );
})
