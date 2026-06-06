{ pkgs }:

let
  bundle = pkgs.writeTextDir "bundle.js" ''
    exports.USE_NEW_UPDATER=settings?.get("USE_NEW_UPDATER",!1)||"win32"===process.platform||"linux"===process.platform
  '';
in
pkgs.runCommand "discord-app-asar-patch-test"
  {
    nativeBuildInputs = [ pkgs.asar ];
  }
  ''
    old_expression='exports.USE_NEW_UPDATER=settings?.get("USE_NEW_UPDATER",!1)||"win32"===process.platform||"linux"===process.platform'
    new_expression='exports.USE_NEW_UPDATER=settings?.get("USE_NEW_UPDATER")??("win32"===process.platform||"linux"===process.platform)'

    assert_patched() {
      local name=$1
      local asar_path=$2

      mkdir "extracted-$name"
      asar extract "$asar_path" "extracted-$name"
      grep -F "$new_expression" "extracted-$name/bundle.js"
      if grep -F "$old_expression" "extracted-$name/bundle.js"; then
        echo "old updater expression still present in $name" >&2
        exit 1
      fi
    }

    pack_fixture() {
      local resources_dir=$1

      mkdir "$resources_dir"
      asar pack ${bundle} "$resources_dir/app.asar"
    }

    pack_fixture vanilla
    source ${../../pkgs/discord/scripts/patch-discord-app-asar.sh} \
      "$PWD/vanilla" \
      ${pkgs.lib.getExe pkgs.asar}
    assert_patched vanilla vanilla/app.asar

    pack_fixture vencord
    source ${../../pkgs/discord/scripts/patch-discord-app-asar.sh} \
      "$PWD/vencord" \
      ${pkgs.lib.getExe pkgs.asar}
    source ${../../pkgs/discord/scripts/install-patcher-asar.sh} \
      "$PWD/vencord" \
      'require("/nix/store/example-vencord/patcher.js")'
    grep -F 'require("/nix/store/example-vencord/patcher.js")' vencord/app.asar/index.js
    assert_patched vencord vencord/_app.asar

    pack_fixture equicord
    source ${../../pkgs/discord/scripts/patch-discord-app-asar.sh} \
      "$PWD/equicord" \
      ${pkgs.lib.getExe pkgs.asar}
    source ${../../pkgs/discord/scripts/install-patcher-asar.sh} \
      "$PWD/equicord" \
      'require("/nix/store/example-equicord/desktop/patcher.js")'
    grep -F 'require("/nix/store/example-equicord/desktop/patcher.js")' equicord/app.asar/index.js
    assert_patched equicord equicord/_app.asar

    touch "$out"
  ''
