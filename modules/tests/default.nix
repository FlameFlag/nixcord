{ pkgs }:

let
  inherit (pkgs) lib;

  discordExecutableAliasCheck =
    let
      emptyFetch = pkgs.runCommand "discord-empty-fetch" { } ''
        mkdir -p "$out"
      '';

      fakeFetchurl = _: emptyFetch;

      moduleNames = lib.unique (
        lib.concatMap (source: builtins.attrNames source.modules) (
          builtins.attrValues (lib.importJSON ../../pkgs/discord/data/sources.json)
        )
      );
      moduleNameArgs = lib.escapeShellArgs moduleNames;

      mkBasePackage =
        {
          pname,
          binaryName,
          executableName,
        }:
        pkgs.stdenvNoCC.mkDerivation {
          inherit pname;
          version = "1.0.0";

          dontUnpack = true;
          nativeBuildInputs = [ pkgs.makeWrapper ];

          installPhase = ''
            runHook preInstall

            mkdir -p "$out/opt/${binaryName}/resources" "$out/opt/${binaryName}/modules" "$out/bin"
            printf '{}\n' > "$out/opt/${binaryName}/resources/build_info.json"
            for module in ${moduleNameArgs}; do
              mkdir -p "$out/opt/${binaryName}/modules/$module"
            done

            printf '#!${pkgs.runtimeShell}\nexit 0\n' > "$out/opt/${binaryName}/${binaryName}"
            chmod +x "$out/opt/${binaryName}/${binaryName}"

            makeWrapper "$out/opt/${binaryName}/${binaryName}" "$out/bin/${executableName}" \
              --add-flags ""

            runHook postInstall
          '';

          meta.mainProgram = executableName;
        };

      basePackages = {
        discord = mkBasePackage {
          pname = "discord";
          binaryName = "Discord";
          executableName = "discord";
        };
        discord-ptb = mkBasePackage {
          pname = "discord-ptb";
          binaryName = "DiscordPTB";
          executableName = "discordptb";
        };
        discord-canary = mkBasePackage {
          pname = "discord-canary";
          binaryName = "DiscordCanary";
          executableName = "discordcanary";
        };
        discord-development = mkBasePackage {
          pname = "discord-development";
          binaryName = "DiscordDevelopment";
          executableName = "discorddevelopment";
        };
      };

      mkDiscord =
        branch:
        pkgs.callPackage ../../pkgs/discord (
          basePackages
          // {
            inherit branch;
            fetchurl = fakeFetchurl;
            withOpenASAR = true;
          }
        );

      variants = {
        ptb = {
          package = mkDiscord "ptb";
          binaryName = "DiscordPTB";
          executableName = "discordptb";
        };
        canary = {
          package = mkDiscord "canary";
          binaryName = "DiscordCanary";
          executableName = "discordcanary";
        };
        development = {
          package = mkDiscord "development";
          binaryName = "DiscordDevelopment";
          executableName = "discorddevelopment";
        };
      };

      checkVariant =
        _name:
        {
          package,
          binaryName,
          executableName,
        }:
        ''
          package=${package}
          test -x "$package/bin/${executableName}"
          test -L "$package/bin/discord"
          test "$(readlink "$package/bin/discord")" = "${executableName}"
          test "${lib.meta.getExe package}" = "$package/bin/discord"
          if ${lib.getExe pkgs.jq} -e 'has("localModulesRoot")' "$package/opt/${binaryName}/resources/build_info.json"; then
            echo "OpenASAR package must not point localModulesRoot at the Nix store" >&2
            exit 1
          fi
        '';
    in
    pkgs.runCommand "discord-executable-alias-check" { } ''
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList checkVariant variants)}

      touch "$out"
    '';
in

{
  hm-eval = import ./eval/hm.nix { inherit pkgs; };
  nixos-eval = import ./eval/nixos.nix { inherit pkgs; };
  config-output = import ./modules/config-output { inherit pkgs; };
  assertions = import ./modules/assertions { inherit pkgs; };
  discord-app-asar-patch = import ./discord-app-asar.nix { inherit pkgs; };
  discord-launcher-c = import ./c/discord-launcher.nix { inherit pkgs; };
}
// pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
  discord-executable-alias = discordExecutableAliasCheck;
  discord-linux-scripts = import ./discord-linux-scripts.nix { inherit pkgs; };
}
// pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
  darwin-eval = import ./eval/darwin.nix { inherit pkgs; };
}
