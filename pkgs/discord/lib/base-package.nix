{
  stdenvNoCC,
  runCommand,
  branch,
  source,
  discord,
  discord-ptb,
  discord-canary,
  discord-development,
}:
let
  variantPackages = {
    stable = discord;
    ptb = discord-ptb;
    canary = discord-canary;
    development = discord-development;
  };

  basePackageRaw = variantPackages.${branch};
  basePackageOverride = basePackageRaw.override or null;

  basePackageWithSource =
    if
      basePackageOverride != null
      && builtins.isFunction basePackageOverride
      && builtins.functionArgs basePackageOverride ? source
    then
      basePackageOverride { inherit source; }
    else
      basePackageRaw;

  basePackageWithSourceOverride = basePackageWithSource.override or null;

  emptyOpenSSL11 = runCommand "openssl-1.1.1w-ignored" { } ''
    mkdir -p "$out/lib"
  '';
  basePackageCanOverrideOpenSSL11 =
    basePackageWithSourceOverride != null
    && builtins.isFunction basePackageWithSourceOverride
    && builtins.functionArgs basePackageWithSourceOverride ? openssl_1_1;
in
if stdenvNoCC.isLinux && basePackageCanOverrideOpenSSL11 then
  basePackageWithSourceOverride { openssl_1_1 = emptyOpenSSL11; }
else
  basePackageWithSource
