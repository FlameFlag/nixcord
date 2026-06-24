{
  fetchFromGitHub,
  fetchPnpmDeps,
  lib,
  vencord,
  buildWebExtension ? false,
  unstable ? false,
  bun,
  writeShellApplication,
  cacert,
  curl,
  jq,
  nix,
  nix-prefetch-github,
  replaceVars,
}:
let
  stableVersion = "1.14.14";
  stableHash = "sha256-4rB+4gk0rGe4IQH8QyJplaXVycv6ZWdaz9SVDzTZW08=";
  stablePnpmDeps = "sha256-hk1rnNog5xvuIVI0M1ZJ5xrEuk0zcBiYsbROUycdi+A=";

  unstableVersion = "1.14.15-unstable-2026-06-24";
  unstableRev = "70d41b0584d8e8b094cbaa771b170dc6e7cf68b3";
  unstableHash = "sha256-jQeLZa1rpKDkzWSpAqOa8snGRKLpv9xf9cwJ6hUwMzA=";
  unstablePnpmDeps = "sha256-hk1rnNog5xvuIVI0M1ZJ5xrEuk0zcBiYsbROUycdi+A=";

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
      bun
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
          dependencyName = "vencord";
        }
      } "$@"
    '';
  };
})
