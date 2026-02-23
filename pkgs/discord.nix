{
  stdenvNoCC,
  fetchurl,
  discord,
  discord-ptb ? null,
  discord-canary ? null,
  discord-development ? null,
  writeShellApplication,
  cacert,
  curl,
  gnugrep,
  nix,

  # Options
  branch ? "stable",
}:
let
  versions = {
    linux = {
      stable = "0.0.126";
      ptb = "0.0.178";
      canary = "0.0.877";
      development = "0.0.94";
    };
    darwin = {
      stable = "0.0.378";
      ptb = "0.0.210";
      canary = "0.0.980";
      development = "0.0.107";
    };
  };

  hashes = {
    x86_64-linux = {
      stable = "sha256-a61yWJGDcC5l6Sz7ALmJQky+PCeCFs6wCU8ISqDfly0=";
      ptb = "sha256-X8PZkMhFYmWjeKPAvxtyBgrQAofkEpD1ow9gzm7v0LQ=";
      canary = "sha256-HL6QPiKDg8io8Uhb2u2wDi+5FvwkZzHh4cqBJ6t4qOg=";
      development = "sha256-EVkjWoqWl9Z+iHCLPOLu4PIUb2wC3HVcPVjOVz++IVw=";
    };
    x86_64-darwin = {
      stable = "sha256-E2JSxc0Ni6AgtbMvaX5lIbanS6L4Xsl0/ztRMGxtv4g=";
      ptb = "sha256-CbdKYcJE1Yn8s27f9QXHMVmF6U1URnUdmz5M8ilzZWU=";
      canary = "sha256-MPE+EQEvvodFJy0kLT2VQUpMJh3wuh15nhena1LeDuI=";
      development = "sha256-B1//zMlTv2+RWHfWZSaaU8ubVOwWob+EYjNdtFRwlgg=";
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

      get_current_version() {
        local branch="$1"
        local platform="$2"
        nix eval --json --impure --expr "let pkgs = import <nixpkgs> {}; in (pkgs.callPackage ./pkgs/discord.nix {}).passthru.versions.$platform.$branch" | jq -r .
      }

      get_current_hash() {
        local branch="$1"
        local platform="$2"
        nix eval --json --impure --expr "let pkgs = import <nixpkgs> {}; in (pkgs.callPackage ./pkgs/discord.nix {}).passthru.hashes.x86_64-$platform.$branch" | jq -r .
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
        sed -i.bak "s|hash = \"''${old_hash}\";|hash = \"''${new_hash}\";|g" ./pkgs/discord.nix && rm ./pkgs/discord.nix.bak
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
  passthru = oldAttrs.passthru // {
    inherit updateScript versions hashes;
  };
})
