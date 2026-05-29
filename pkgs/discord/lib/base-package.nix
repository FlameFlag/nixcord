{
  stdenvNoCC,
  runCommand,
  branch,
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

  emptyOpenSSL11 = runCommand "openssl-1.1.1w-ignored" { } ''
    mkdir -p "$out/lib"
  '';
in
if stdenvNoCC.isLinux && ((basePackageRaw.override.__functionArgs or { }) ? openssl_1_1) then
  basePackageRaw.override { openssl_1_1 = emptyOpenSSL11; }
else
  basePackageRaw
