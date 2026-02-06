{
  lib,
  stdenvNoCC,
  stdenv,
  fetchurl,
  discord,
  nix,

  # Platform-specific build tools
  autoPatchelfHook, # linux
  makeDesktopItem, # linux
  makeShellWrapper, # linux
  makeWrapper,
  undmg, # darwin
  wrapGAppsHook3, # linux

  # Common
  cacert,
  coreutils, # For base64 in update script
  curl,
  gnugrep,
  sd,
  perl,

  python3,
  runCommand,
  writeShellApplication,

  # Linux runtime dependencies
  alsa-lib,
  at-spi2-atk,
  at-spi2-core,
  atk,
  cairo,
  cups,
  dbus,
  expat,
  fontconfig,
  freetype,
  gdk-pixbuf,
  glib,
  gtk3,
  libappindicator-gtk3,
  libcxx,
  libva,
  libdbusmenu,
  libdrm,
  libgbm,
  libglvnd,
  libnotify,
  libpulseaudio,
  libuuid,
  libX11,
  libxcb,
  libXcomposite,
  libXcursor,
  libXdamage,
  libXext,
  libXfixes,
  libXi,
  libXrandr,
  libXrender,
  libXScrnSaver,
  libxshmfence,
  libXtst,
  libunity,
  nspr,
  nss,
  pango,
  pipewire,
  speechd-minimal,
  systemdLibs,
  wayland,

  # Options
  branch ? "stable",
  withOpenASAR ? false,
  openasar,
  withVencord ? false,
  vencord,
  withEquicord ? false,
  equicord,
  enableAutoscroll ? false,
  commandLineArgs ? "",

  # Linux specific options
  withTTS ? true,
}:
let
  versions = {
    linux = {
      stable = "0.0.123";
      ptb = "0.0.176";
      canary = "0.0.862";
      development = "0.0.94";
    };
    darwin = {
      stable = "0.0.375";
      ptb = "0.0.208";
      canary = "0.0.966";
      development = "0.0.107";
    };
  };

  srcs = {
    x86_64-linux = {
      stable = fetchurl {
        url = "https://stable.dl2.discordapp.net/apps/linux/${versions.linux.stable}/discord-${versions.linux.stable}.tar.gz";
        hash = "sha256-2cNAfYzPbZ9O8s4b3RBLki8aM9TiFuZcGffFbY4zxJQ=";
      };
      ptb = fetchurl {
        url = "https://ptb.dl2.discordapp.net/apps/linux/${versions.linux.ptb}/discord-ptb-${versions.linux.ptb}.tar.gz";
        hash = "sha256-SOShH+EzFN1ti1RcgvRaxaD45nHosi4R6lSXSY3MGYU=";
      };
      canary = fetchurl {
        url = "https://canary.dl2.discordapp.net/apps/linux/${versions.linux.canary}/discord-canary-${versions.linux.canary}.tar.gz";
        hash = "sha256-kjIrLBHbCvDEi/lyJadyaqR/5z77u5CvOekbptJZnxY=";
      };
      development = fetchurl {
        url = "https://development.dl2.discordapp.net/apps/linux/${versions.linux.development}/discord-development-${versions.linux.development}.tar.gz";
        hash = "sha256-EVkjWoqWl9Z+iHCLPOLu4PIUb2wC3HVcPVjOVz++IVw=";
      };
    };
    x86_64-darwin = {
      stable = fetchurl {
        url = "https://stable.dl2.discordapp.net/apps/osx/${versions.darwin.stable}/Discord.dmg";
        hash = "sha256-pRL1fCBXQL3iMNM/po73KrtJRQhWNvED7H8PrOBWTaU=";
      };
      ptb = fetchurl {
        url = "https://ptb.dl2.discordapp.net/apps/osx/${versions.darwin.ptb}/DiscordPTB.dmg";
        hash = "sha256-EPhQwolrHda8gh+G84quVlbNGYSThqJsg4qjK44nZuc=";
      };
      canary = fetchurl {
        url = "https://canary.dl2.discordapp.net/apps/osx/${versions.darwin.canary}/DiscordCanary.dmg";
        hash = "sha256-KPneQR4BBC/1CHWYm1ie8m//tiagRCk92e1/Tz+Fx9Y=";
      };
      development = fetchurl {
        url = "https://development.dl2.discordapp.net/apps/osx/${versions.darwin.development}/DiscordDevelopment.dmg";
        hash = "sha256-B1//zMlTv2+RWHfWZSaaU8ubVOwWob+EYjNdtFRwlgg=";
      };
    };
    aarch64-darwin = srcs.x86_64-darwin;
    aarch64-linux = throw "Discord does not provide official aarch64-linux builds.";
  };

  currentPlatform = if stdenvNoCC.hostPlatform.isLinux then "linux" else "darwin";
  currentSystem = stdenvNoCC.hostPlatform.system;
  version =
    versions.${currentPlatform}.${branch}
      or (throw "Invalid branch ${branch} for platform ${currentPlatform}");
  src =
    srcs.${currentSystem}.${branch}
      or (throw "Platform ${currentSystem} not supported for branch ${branch}");

  genericMeta = {
    description = "All-in-one cross-platform voice and text chat for gamers";
    downloadPage = "https://discordapp.com/download";
    homepage = "https://discordapp.com/";
    license = lib.licenses.unfree;
    maintainers = with lib.maintainers; [
      artturin
      donteatoreo
      infinidoge
      jopejoe1
      Scrumplex
    ];
    platforms = [
      "x86_64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
    sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
  };

  packages =
    builtins.mapAttrs
      (
        key: value:
        let
          binaryName = value.binaryName;
          desktopName = value.desktopName;

          libPath = lib.makeLibraryPath (
            [
              libcxx
              systemdLibs
              libpulseaudio
              libdrm
              libgbm
              stdenv.cc.cc
              alsa-lib
              atk
              at-spi2-atk
              at-spi2-core
              cairo
              cups
              dbus
              expat
              fontconfig
              freetype
              gdk-pixbuf
              glib
              gtk3
              libva
              libglvnd
              libnotify
              libX11
              libXcomposite
              libuuid
              libunity
              libXcursor
              libXdamage
              libXext
              libXfixes
              libXi
              libXrandr
              libXrender
              libXtst
              nspr
              libxcb
              pango
              pipewire
              libXScrnSaver
              libappindicator-gtk3
              libdbusmenu
              wayland
            ]
            ++ lib.optional withTTS speechd-minimal
          );

          desktopItem = makeDesktopItem {
            name = value.pname;
            exec = lib.strings.toLower binaryName;
            icon = value.pname;
            inherit desktopName;
            genericName = genericMeta.description;
            categories = [
              "Network"
              "InstantMessaging"
            ];
            mimeTypes = [ "x-scheme-handler/discord" ];
            startupWMClass = "discord";
          };

          updateScriptDrv = (
            writeShellApplication {
              name = "discord-update";
              runtimeInputs = [
                cacert
                nix
                curl
                gnugrep
                perl
              ];
              text = ''
                if [[ -n "''${DISCORD_BRANCHES:-}" ]]; then
                  IFS=' ' read -r -a BRANCHES <<< "''${DISCORD_BRANCHES}"
                else
                  BRANCHES=(stable ptb canary development)
                fi

                for BRANCH in "''${BRANCHES[@]}"; do
                  # Get Linux URL and version
                  linux_url=$(curl -sI -L -o /dev/null -w '%{url_effective}' "https://discord.com/api/download/$BRANCH?platform=linux&format=tar.gz")
                  linux_version=$(echo "$linux_url" | grep -oP 'apps/linux/\K([0-9]+\.[0-9]+\.[0-9]+)')

                  # Get Linux hash
                  linux_hash=$(nix-prefetch-url --type sha256 "$linux_url")
                  linux_sri_hash=$(nix hash convert --to sri --hash-algo sha256 "$linux_hash")

                  # Get Darwin URL and version
                  darwin_url=$(curl -sI -L -o /dev/null -w '%{url_effective}' "https://discord.com/api/download/$BRANCH?platform=osx&format=dmg")
                  darwin_version=$(echo "$darwin_url" | grep -oP 'apps/osx/\K([0-9]+\.[0-9]+\.[0-9]+)')

                  # Get Darwin hash
                  darwin_hash=$(nix-prefetch-url --type sha256 "$darwin_url")
                  darwin_sri_hash=$(nix hash convert --to sri --hash-algo sha256 "$darwin_hash")

                  # Update versions
                  LINUX_VERSION="$linux_version" DARWIN_VERSION="$darwin_version" BRANCH="$BRANCH" perl -i -pe '
                    my $linux_version = $ENV{"LINUX_VERSION"};
                    my $darwin_version = $ENV{"DARWIN_VERSION"};
                    my $branch = $ENV{"BRANCH"};
                    if (/^\s*linux\s*=\s*\{/../^\s*\}/) {
                      s/^(\s*)$branch(\s*=\s*)"[^"]+";/$1$branch$2"$linux_version";/;
                    }
                    if (/^\s*darwin\s*=\s*\{/../^\s*\}/) {
                      s/^(\s*)$branch(\s*=\s*)"[^"]+";/$1$branch$2"$darwin_version";/;
                    }
                  ' ./pkgs/discord.nix

                  # Update hashes
                  PLATFORM="x86_64-linux" BRANCH="$BRANCH" NEWHASH="$linux_sri_hash" perl -0777 -i -pe '
                    my $platform = $ENV{"PLATFORM"};
                    my $branch = $ENV{"BRANCH"};
                    my $new_hash = $ENV{"NEWHASH"};
                    s{
                      ($platform\s*=\s*\{\s*.*?
                        $branch\s*=\s*fetchurl\s*\{
                        .*?
                        hash\s*=\s*")
                        sha256-[A-Za-z0-9+/=]+
                        (";)
                      }
                      {$1$new_hash$2}xms
                    ' ./pkgs/discord.nix

                  PLATFORM="x86_64-darwin" BRANCH="$BRANCH" NEWHASH="$darwin_sri_hash" perl -0777 -i -pe '
                    my $platform = $ENV{"PLATFORM"};
                    my $branch = $ENV{"BRANCH"};
                    my $new_hash = $ENV{"NEWHASH"};
                    s{
                      ($platform\s*=\s*\{\s*.*?
                        $branch\s*=\s*fetchurl\s*\{
                        .*?
                        hash\s*=\s*")
                        sha256-[A-Za-z0-9+/=]+
                        (";)
                      }
                      {$1$new_hash$2}xms
                    ' ./pkgs/discord.nix
                done
              '';
            }
          );

        in
        stdenvNoCC.mkDerivation (
          rec {
            inherit version src;
            pname = value.pname;

            nativeBuildInputs = [
              makeWrapper
            ]
            ++ lib.optionals stdenvNoCC.hostPlatform.isLinux [
              autoPatchelfHook
              cups
              libdrm
              libuuid
              libXdamage
              libX11
              libXScrnSaver
              libXtst
              libxcb
              libxshmfence
              libgbm
              nss
              wrapGAppsHook3
              makeShellWrapper
            ]
            ++ lib.optionals stdenvNoCC.hostPlatform.isDarwin [ undmg ];

            buildInputs = lib.optionals stdenvNoCC.hostPlatform.isLinux [
              alsa-lib
              gtk3
              systemdLibs
              pipewire
              wayland
            ];

            runtimeDependencies = lib.optionals stdenvNoCC.hostPlatform.isLinux (lib.splitString ":" libPath);

            dontWrapGApps = lib.optional stdenvNoCC.hostPlatform.isLinux true;

            sourceRoot = lib.optionalString stdenvNoCC.hostPlatform.isDarwin ".";

            installPhase =
              if stdenvNoCC.hostPlatform.isLinux then
                ''
                  runHook preInstall

                  mkdir -p $out/{bin,opt/${binaryName},share/pixmaps,share/icons/hicolor/256x256/apps}
                  mv * "$out/opt/${binaryName}"

                  chmod +x "$out/opt/${binaryName}/${binaryName}"
                  patchelf --set-interpreter "${stdenv.cc.bintools.dynamicLinker}" \
                      "$out/opt/${binaryName}/${binaryName}"

                  wrapProgramShell "$out/opt/${binaryName}/${binaryName}" \
                      "''${gappsWrapperArgs[@]}" \
                      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform=wayland --enable-features=WaylandWindowDecorations}}" \
                      --add-flags "\''${WAYLAND_DISPLAY:+--enable-wayland-ime=true}" \
                      ${lib.strings.optionalString withTTS ''
                        --run 'if [[ "''${NIXOS_SPEECH:-default}" != "False" ]]; then NIXOS_SPEECH=True; else unset NIXOS_SPEECH; fi' \
                        --add-flags "\''${NIXOS_SPEECH:+--enable-speech-dispatcher}" \
                      ''} \
                      ${lib.strings.optionalString enableAutoscroll "--add-flags \"--enable-blink-features=MiddleClickAutoscroll\""} \
                      --prefix XDG_DATA_DIRS : "${gtk3}/share/gsettings-schemas/${gtk3.name}/" \
                      --prefix LD_LIBRARY_PATH : ${libPath}:$out/opt/${binaryName} \
                      --add-flags ${lib.escapeShellArg commandLineArgs}

                  ln -s "$out/opt/${binaryName}/${binaryName}" "$out/bin"
                  # Without || true the install would fail on case-insensitive filesystems
                  ln -s "$out/opt/${binaryName}/${binaryName}" "$out/bin/${lib.strings.toLower binaryName}" || true

                  ln -s "$out/opt/${binaryName}/discord.png" "$out/share/pixmaps/${pname}.png"
                  ln -s "$out/opt/${binaryName}/discord.png" "$out/share/icons/hicolor/256x256/apps/${pname}.png"

                  ln -s "$desktopItem/share/applications" "$out/share/"

                  runHook postInstall
                ''
              else
                ''
                  runHook preInstall

                  mkdir -p "$out/Applications"
                  cp -r "${desktopName}.app" "$out/Applications"

                  # wrap executable to $out/bin
                  mkdir -p "$out/bin"
                  makeWrapper "$out/Applications/${desktopName}.app/Contents/MacOS/${binaryName}" "$out/bin/${binaryName}"

                  runHook postInstall
                '';

            postInstall =
              let
                resourcesPath =
                  if stdenvNoCC.hostPlatform.isLinux then
                    "$out/opt/${binaryName}/resources"
                  else
                    "$out/Applications/${desktopName}.app/Contents/Resources";
              in
              # OpenASAR
              lib.strings.optionalString withOpenASAR ''
                cp -f ${openasar} "${resourcesPath}/app.asar"
              ''
              # Vencord
              + lib.strings.optionalString withVencord ''
                mv ${resourcesPath}/app.asar ${resourcesPath}/_app.asar
                mkdir -p ${resourcesPath}/app.asar
                echo '{"name":"discord","main":"index.js"}' > ${resourcesPath}/app.asar/package.json
                echo 'require("${vencord}/patcher.js")' > ${resourcesPath}/app.asar/index.js
              ''
              # Equicord
              + lib.strings.optionalString withEquicord ''
                mv ${resourcesPath}/app.asar ${resourcesPath}/_app.asar
                mkdir ${resourcesPath}/app.asar
                echo '{"name":"discord","main":"index.js"}' > ${resourcesPath}/app.asar/package.json
                echo 'require("${equicord}/desktop/patcher.js")' > ${resourcesPath}/app.asar/index.js
              '';

            meta = genericMeta // {
              mainProgram = "discord";
              description =
                genericMeta.description
                + lib.optionalString (withOpenASAR && openasar != null) " (with OpenASAR)"
                + lib.optionalString (withVencord && vencord != null) " (with Vencord)"
                + lib.optionalString (withEquicord && equicord != null) " (with Equicord)";
            };
            passthru.updateScript = updateScriptDrv;
          }
          // lib.optionalAttrs stdenvNoCC.hostPlatform.isLinux { inherit desktopItem; }
          // lib.optionalAttrs stdenvNoCC.hostPlatform.isLinux {
            inherit withTTS enableAutoscroll;
          }
        )
      )
      {
        stable = {
          pname = "discord";
          binaryName = "Discord";
          desktopName = "Discord";
        };
        ptb = rec {
          pname = "discord-ptb";
          binaryName = if stdenvNoCC.hostPlatform.isLinux then "DiscordPTB" else desktopName;
          desktopName = "Discord PTB";
        };
        canary = rec {
          pname = "discord-canary";
          binaryName = if stdenvNoCC.hostPlatform.isLinux then "DiscordCanary" else desktopName;
          desktopName = "Discord Canary";
        };
        development = rec {
          pname = "discord-development";
          binaryName = if stdenvNoCC.hostPlatform.isLinux then "DiscordDevelopment" else desktopName;
          desktopName = "Discord Development";
        };
      };
in
packages.${branch}
  or (throw "Invalid branch selected: ${branch}. Valid branches are: ${lib.concatStringsSep ", " (builtins.attrNames packages)}")
