{
  equicord,
  fetchFromGitHub,
  fetchPnpmDeps,
  stdenvNoCC,
  buildWebExtension ? false,
  writeShellApplication,
  cacert,
  curl,
  jq,
  nix,
  nix-prefetch-github,
  replaceVars,
}:
let
  version = "v1.14.13.1";
  hash = "sha256-Q00qZWzAkKbbTbe82VS5JA8PB18zRwD0jfF278reWlM=";
  pnpmDepsHashDarwin = "sha256-8za+KfTNZXROt9zasumUppzCo6/bz3Rrp976mAyaBa4=";
  pnpmDepsHashLinux = "sha256-uEQRrFyHPm90S0TH2T6PEffruaG5YGY33MSgcnFma1U=";
  pnpmDepsHash = if stdenvNoCC.isDarwin then pnpmDepsHashDarwin else pnpmDepsHashLinux;
  owner = equicord.src.owner;
  repo = equicord.src.repo;
  src = fetchFromGitHub {
    inherit owner repo;
    tag = version;
    inherit hash;
  };
  updateScript = writeShellApplication {
    name = "equicord-update";
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
          clientName = "Equicord";
          nixFile = "./pkgs/equicord.nix";
          owner = equicord.src.owner;
          repo = equicord.src.repo;
          updateKind = "stable-tag";
          versionVar = "version";
          hashVar = "hash";
          revVar = "";
          pnpmHashVar = "";
          callPackageArgs = "{ }";
          stableTagRegex = "^v[0-9]+\\.[0-9]+\\.[0-9]+(\\.[0-9]+)?$";
          branch = "main";
          versionPrefixMode = "keep-v";
          skipIfCurrent = "true";
        }
      } "$@"
    '';
  };
in
(equicord.override { inherit buildWebExtension; }).overrideAttrs (oldAttrs: {
  inherit version src;
  patches = (oldAttrs.patches or [ ]) ++ [
    ./patches/equicord-content-warning-settings.patch
  ];
  pnpmDeps = fetchPnpmDeps {
    inherit src;
    inherit version;
    inherit (oldAttrs) pname;
    inherit (oldAttrs.pnpmDeps) pnpm fetcherVersion;
    hash = pnpmDepsHash;
  };
  passthru.updateScript = updateScript;
  env = {
    EQUICORD_REMOTE = "${owner}/${repo}";
    EQUICORD_HASH = "${src.tag}";
  };
})
