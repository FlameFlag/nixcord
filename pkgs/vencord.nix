{
  fetchFromGitHub,
  fetchPnpmDeps,
  lib,
  vencord,
  buildWebExtension ? false,
  unstable ? false,
  writeShellApplication,
  cacert,
  curl,
  jq,
  nix,
  nix-prefetch-github,
  replaceVars,
}:
let
  stableVersion = "1.14.13";
  stableHash = "sha256-Xqk/akTa/NcHjSm6h77y6Fkvq7ayBcR0w0HG0Hwfkf8=";
  stablePnpmDeps = "sha256-GiUV2x8i7ewzn66v5wBUq67oNvrxZzOsh5TuQUtpJNQ=";

  unstableVersion = "1.14.13-unstable-2026-05-29";
  unstableRev = "9f2e6e7baf0aa68d2e612e6669319056b3def66e";
  unstableHash = "sha256-U1xgdTSoVCiYxL3q8SmsQFs+RznnIBjbmSC1zqiSgmY=";
  unstablePnpmDeps = "sha256-GiUV2x8i7ewzn66v5wBUq67oNvrxZzOsh5TuQUtpJNQ=";

  version = if unstable then unstableVersion else stableVersion;
  hash = if unstable then unstableHash else stableHash;
  pnpmDepsHash = if unstable then unstablePnpmDeps else stablePnpmDeps;
  rev = if unstable then unstableRev else "v${version}";
  updateBool = if unstable then "true" else "false";
  src = fetchFromGitHub {
    inherit (vencord.src) owner repo;
    inherit rev hash;
  };
in
(vencord.override { inherit buildWebExtension; }).overrideAttrs (oldAttrs: {
  inherit version src;
  pnpmDeps = fetchPnpmDeps {
    inherit (oldAttrs) pname patches postPatch;
    inherit (oldAttrs.pnpmDeps) pnpm fetcherVersion;
    inherit src;
    hash = pnpmDepsHash;
  };
  meta = oldAttrs.meta // {
    description = "Vencord web extension" + lib.optionalString unstable " (Unstable)";
  };
  passthru.updateScript = writeShellApplication {
    name = "vencord-update";
    runtimeInputs = [
      cacert
      curl
      jq
      nix
      nix-prefetch-github
    ];
    text = ''
      # shellcheck disable=SC1091
      source ${
        replaceVars ./scripts/update-vencord-family.sh {
          clientName = "Vencord";
          nixFile = "./pkgs/vencord.nix";
          owner = vencord.src.owner;
          repo = vencord.src.repo;
          updateKind = if unstable then "unstable-branch" else "stable-tag";
          versionVar = if unstable then "unstableVersion" else "stableVersion";
          hashVar = if unstable then "unstableHash" else "stableHash";
          revVar = if unstable then "unstableRev" else "";
          pnpmHashVar = if unstable then "unstablePnpmDeps" else "stablePnpmDeps";
          callPackageArgs = "{ unstable = ${updateBool}; }";
          stableTagRegex = "^v[0-9]+\\.[0-9]+\\.[0-9]+$";
          branch = "main";
          versionPrefixMode = "strip-v";
          skipIfCurrent = "false";
        }
      } "$@"
    '';
  };
})
