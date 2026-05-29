{
  writeShellApplication,
  cacert,
  nix,
  curl,
  jq,
  python3,
  updateSourcesPy,
}:
writeShellApplication {
  name = "discord-update";
  runtimeInputs = [
    cacert
    nix
    curl
    jq
    python3
  ];
  text = ''
    export DISCORD_UPDATE_SOURCES_PY=${updateSourcesPy}
    # shellcheck disable=SC1091
    source ${../scripts/update-sources.sh}
  '';
}
