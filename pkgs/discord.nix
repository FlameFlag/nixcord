{
  stdenvNoCC,
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

  # Options
  branch ? "stable",
  withVencord ? false,
  vencord ? null,
  withEquicord ? false,
  equicord ? null,
  withOpenASAR ? false,
  enableAutoscroll ? false,
}:
let
  versions = {
    linux = {
      stable = "0.0.127";
      ptb = "0.0.181";
      canary = "0.0.888";
      development = "0.0.97";
    };
    darwin = {
      stable = "0.0.379";
      ptb = "0.0.213";
      canary = "0.0.993";
      development = "0.0.110";
    };
  };

  hashes = {
    x86_64-linux = {
      stable = "sha256-cef++sTEiqq1H+mHYyIw5Z/Tj1dAoLtKQRw7OSB/axY=";
      ptb = "sha256-47k+PQf1A79cSIBLktcB8olCoV5DnxTjPg+Dx5YSb8w=";
      canary = "sha256-KgQIEwFzeDmZhKJnUMWVjNjWeXahzIesZOlKSVYqaQU=";
      development = "sha256-wybYWGNo7FhKC7W3zPEKBc4VO5UulCaRacjjKqbleQE=";
    };
    x86_64-darwin = {
      stable = "sha256-3tNPV9Xk0yZQTV3yhHsYxEOJCFC1Kk2dzO2Wy7GNkCc=";
      ptb = "sha256-oxj36f0N9hGcMSurQdgJfFHKgEdv9xL1+SSmszcct68=";
      canary = "sha256-CzkvifCxPFwaOr15KX+vBlF6EGT8GhpY1wO8y7QVBB0=";
      development = "sha256-ymRCHYpA1OVvBg7uQ3/Q7HACSH0xBfRJXueU+9boc0Y=";
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

  currentPlatform = if stdenvNoCC.hostPlatform.isLinux then "linux" else "darwin";
  currentSystem = stdenvNoCC.hostPlatform.system;
  version = versions.${currentPlatform}.${branch};
  src = srcs.${currentSystem}.${branch};

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

  updateScript = writeShellApplication {
    name = "discord-update";
    runtimeInputs = [
      cacert
      nix
      curl
      gnugrep
    ];
    text = ''
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

      get_nixpkgs_path() {
        nix eval --impure --raw --expr "(builtins.getFlake (toString ./.)).inputs.nixpkgs.outPath" 2>/dev/null || echo ""
      }

      get_current_version() {
        local branch="$1"
        local platform="$2"
        local nixpkgs_path
        nixpkgs_path=$(get_nixpkgs_path)
        local nix_expr
        if [[ -n "$nixpkgs_path" ]]; then
          nix_expr="let pkgs = import $nixpkgs_path {}; in (pkgs.callPackage ./pkgs/discord.nix {}).passthru.versions.$platform.$branch"
        else
          nix_expr="let pkgs = import <nixpkgs> {}; in (pkgs.callPackage ./pkgs/discord.nix {}).passthru.versions.$platform.$branch"
        fi
        nix eval --json --impure --expr "$nix_expr" | jq -r .
      }

      get_current_hash() {
        local branch="$1"
        local platform="$2"
        local nixpkgs_path
        nixpkgs_path=$(get_nixpkgs_path)
        local nix_expr
        if [[ -n "$nixpkgs_path" ]]; then
          nix_expr="let pkgs = import $nixpkgs_path {}; in (pkgs.callPackage ./pkgs/discord.nix {}).passthru.hashes.x86_64-$platform.$branch"
        else
          nix_expr="let pkgs = import <nixpkgs> {}; in (pkgs.callPackage ./pkgs/discord.nix {}).passthru.hashes.x86_64-$platform.$branch"
        fi
        nix eval --json --impure --expr "$nix_expr" | jq -r .
      }

      update_discord_version() {
        local branch="$1"
        local platform="$2"
        local new_version="$3"
        local old_version
        old_version=$(get_current_version "$branch" "$platform")
        if [ "$old_version" = "$new_version" ]; then
          echo "  $platform version already up to date: $new_version"
          return 0
        fi
        sed -i.bak "s|''${branch} = \"''${old_version}\";|''${branch} = \"''${new_version}\";|g" ./pkgs/discord.nix && rm ./pkgs/discord.nix.bak
      }

      update_discord_hash() {
        local branch="$1"
        local platform="$2"
        local new_hash="$3"
        local old_hash
        old_hash=$(get_current_hash "$branch" "$platform")
        if [ "$old_hash" = "$new_hash" ]; then
          echo "  x86_64-$platform $branch hash already up to date"
          return 0
        fi
        sed -i.bak "s|''${old_hash}|''${new_hash}|g" ./pkgs/discord.nix && rm ./pkgs/discord.nix.bak
      }

      BRANCHES=(stable ptb canary development)
      for BRANCH in "''${BRANCHES[@]}"; do
        echo "Updating Discord $BRANCH..."

        linux_url=$(get_discord_url "$BRANCH" "linux" "tar.gz")
        linux_version=$(extract_version_from_url "$linux_url" "linux")
        linux_sri_hash=$(prefetch_and_convert_hash "$linux_url")
        update_discord_version "$BRANCH" "linux" "$linux_version"
        update_discord_hash "$BRANCH" "linux" "$linux_sri_hash"

        darwin_url=$(get_discord_url "$BRANCH" "osx" "dmg")
        darwin_version=$(extract_version_from_url "$darwin_url" "osx")
        darwin_sri_hash=$(prefetch_and_convert_hash "$darwin_url")
        update_discord_version "$BRANCH" "darwin" "$darwin_version"
        update_discord_hash "$BRANCH" "darwin" "$darwin_sri_hash"

        echo "Updated Discord $BRANCH to linux $linux_version, darwin $darwin_version"
      done
    '';
  };
in
basePackage.overrideAttrs (oldAttrs: {
  inherit version src;
  passthru = (oldAttrs.passthru or { }) // {
    inherit updateScript versions hashes;
  };
  postInstall =
    (oldAttrs.postInstall or "")
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
