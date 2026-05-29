{
  lib,
  stdenvNoCC,
  fetchurl,
  brotli,
  python3,
  runCommand,
  darwin ? null,
  withKrisp,
  version,
  binaryName,
  krispSrc,
  installDeployKrispScript,
  patchKrispModuleScript,
}:
let
  hasKrispSrc = withKrisp && krispSrc != null;
  supportsKrisp = stdenvNoCC.isLinux || stdenvNoCC.isDarwin;
  krispPlatform = if stdenvNoCC.isDarwin then "darwin" else "linux";
  krispPython = python3.withPackages (ps: [
    ps.lief
    ps.capstone
  ]);

  # Krisp helper scripts from upstream nixpkgs PR #506089
  # (NixOS/nixpkgs@90cdc6283e794e7e276fa60f6d27b98a27454f15)
  krispScriptsRev = "90cdc6283e794e7e276fa60f6d27b98a27454f15";

  patchKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/patch-krisp.py";
    hash = "sha256-pj0+CCUZqApYE02zfXnLvOoiIHbtLTT1JMzrJN86WDo=";
  };

  patchKrispModulePy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/patch-krisp-module.py";
    hash = "sha256-WyiDHH0l8rtcG0Dn8acZoeO8Wd2u9ZqaqNZqQlsAGM8=";
  };

  patchVoiceKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/patch-voice-krisp.py";
    hash = "sha256-HEfIv9br3oimd+wtvlBUqOmgv4HS0XRaO2O92ZOupos=";
  };

  deployKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/deploy-krisp.py";
    hash = "sha256-3b1ymG+w3FIZtAIyw1wiRe3JC2vNDAC8d2YMHP9icxM=";
  };

  # Patch the native module to bypass Discord's signature check. Darwin uses
  # nixpkgs' signingUtils so the patched module is ad-hoc signed with the
  # Nix-provided Darwin signing tool.
  krispModule =
    if hasKrispSrc then
      runCommand "discord-krisp-module"
        (
          {
            nativeBuildInputs = [ brotli ] ++ lib.optional supportsKrisp krispPython;
          }
          // lib.optionalAttrs stdenvNoCC.isDarwin { DARWIN_SIGNING_UTILS = darwin.signingUtils; }
        )
        ''
          bash ${patchKrispModuleScript} \
            ${krispSrc} \
            ${patchKrispPy} \
            ${patchKrispModulePy} \
            ${krispPlatform}
        ''
    else
      null;

  # Runtime deployer: copies the patched Krisp module into Discord's config dir
  # before Discord starts and watches for the module updater overwriting it.
  # The watcher matters on Linux too: Discord/OpenASAR can touch native modules
  # during startup, and Krisp must remain a real writable copy, not a store link.
  deployKrisp =
    if hasKrispSrc && supportsKrisp then
      runCommand "deploy-krisp.py"
        {
          pythonInterpreter = "${python3.withPackages (ps: [ ps.watchdog ])}/bin/python3";
          krispPath = "${krispModule}";
          discordVersion = version;
          configDirName = lib.toLower binaryName;
          meta.mainProgram = "deploy-krisp.py";
        }
        ''
          source ${installDeployKrispScript} ${deployKrispPy}
        ''
    else
      null;
in
{
  inherit patchVoiceKrispPy krispModule deployKrisp;
}
