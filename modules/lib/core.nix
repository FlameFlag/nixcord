{
  lib,
  parseRules,
  libva,
  stdenv,
  ...
}:
let
  inherit (lib) attrsets lists strings;

  inherit (attrsets) mapAttrs' nameValuePair;

  defaultParseRules = lib.importJSON ../plugins/parse-rules.json;

  upperNames = lists.unique (defaultParseRules.upperNames ++ parseRules.upperNames);
  upperNamesMask = lib.genAttrs upperNames (_: null);
  lowerPluginTitles = lists.unique (
    defaultParseRules.lowerPluginTitles ++ parseRules.lowerPluginTitles
  );
  lowerPluginTitlesMask = lib.genAttrs lowerPluginTitles (_: null);
  settingRenames = lib.recursiveUpdate defaultParseRules.settingRenames parseRules.settingRenames;
  pluginRenames = lib.recursiveUpdate (defaultParseRules.pluginRenames or { }) (
    parseRules.pluginRenames or { }
  );

  isLowerCase = s: strings.toLower s == s;

  camelWords =
    str:
    lib.pipe str [
      (strings.splitStringBy (_prev: curr: builtins.match "[A-Z]" curr != null) true)
      (lib.filter (part: part != ""))
      (map strings.toLower)
    ];

  toSnakeCase = str: strings.concatStringsSep "_" (camelWords str);

  unNixify = nixName: strings.toUpper (toSnakeCase nixName);

  isLowerCamel = string: isLowerCase (builtins.substring 0 1 string);

  toUpper =
    string:
    strings.concatStrings [
      (strings.toUpper (builtins.substring 0 1 string))
      (builtins.substring 1 (builtins.stringLength string) string)
    ];

  specialRenames = {
    enable = "enabled";
    tagSettings = "tagSettings";
    useQuickCss = "useQuickCSS";
    webRichPresence = "WebRichPresence (arRPC)";
    _24hTime = "24h Time";
    showOwnTimezone = "Show Own Timezone";
  };

  # normalizeName :: string -> string -> value -> string
  # Converts a Nix option name to its JSON-side equivalent using
  # specialRenames, settingRenames, pluginRenames, upperNames, and lowerPluginTitles.
  normalizeName =
    context: name: value:
    let
      contextRenames = settingRenames.${context} or { };
      specialName = specialRenames.${name} or null;
      renamedSetting = contextRenames.${name} or null;
      pluginRename = pluginRenames.${name} or null;
    in
    if specialName != null then
      specialName
    else if renamedSetting != null then
      renamedSetting
    else if context == "plugins" && pluginRename != null then
      pluginRename
    else if builtins.hasAttr name upperNamesMask then
      unNixify name
    else if builtins.hasAttr name lowerPluginTitlesMask then
      name
    else if context == "plugins" && builtins.isAttrs value && value ? enable && isLowerCamel name then
      toUpper name
    else
      name;

  # mkVencordCfgInner :: string -> attrset -> attrset
  # Recursively transforms Nix option names to their JSON counterparts.
  mkVencordCfgInner =
    context: cfg:
    mapAttrs' (
      name: value:
      let
        normalizedValue = if builtins.isAttrs value then mkVencordCfgInner name value else value;
      in
      nameValuePair (normalizeName context name value) normalizedValue
    ) cfg;

  mkVencordCfg = mkVencordCfgInner "";

  # mkFinalPackages :: { cfg, vencord, equicord } -> { discord, vesktop, equibop, dorion }
  # Builds the final patched packages for each client.
  mkFinalPackages =
    {
      cfg,
      vencord,
      equicord,
    }:
    {
      discord = cfg.discord.package.override {
        withVencord = cfg.discord.vencord.enable;
        withEquicord = cfg.discord.equicord.enable;
        withOpenASAR = cfg.discord.openASAR.enable;
        # TODO: Remove programs.nixcord.discord.autoscroll.enable after the
        # deprecation window; until then it is a compatibility shim for
        # programs.nixcord.discord.commandLineArgs.
        commandLineArgs = lib.lists.unique (
          cfg.discord.commandLineArgs
          ++ lib.lists.optional cfg.discord.autoscroll.enable "--enable-blink-features=MiddleClickAutoscroll"
        );
        withKrisp = cfg.discord.krisp.enable;
        branch = cfg.discord.branch;
        vencord = if cfg.discord.vencord.enable then vencord else null;
        equicord = if cfg.discord.equicord.enable then equicord else null;
      };

      vesktop = cfg.vesktop.package.override {
        withSystemVencord = cfg.vesktop.useSystemVencord;
        withMiddleClickScroll = cfg.vesktop.autoscroll.enable;
        inherit vencord;
      };

      equibop =
        if cfg.equibop.package != null then
          (cfg.equibop.package.override {
            withMiddleClickScroll = cfg.equibop.autoscroll.enable;
          }).overrideAttrs
            (old: {
              postPatch =
                (old.postPatch or "")
                + lib.optionalString cfg.equibop.useSystemEquicord ''
                  equicordPatchTarget=
                  for file in src/main/vencordDir.ts src/main/constants.ts; do
                    if [ -f "$file" ] && grep -Fq 'join(SESSION_DATA_DIR, "equicord.asar")' "$file"; then
                      equicordPatchTarget="$file"
                      break
                    fi
                  done

                  if [ -z "$equicordPatchTarget" ]; then
                    echo "could not find Equibop Equicord asar path to patch" >&2
                    exit 1
                  fi

                  substituteInPlace "$equicordPatchTarget" \
                    --replace-fail \
                      'join(SESSION_DATA_DIR, "equicord.asar")' \
                      '"${equicord}/equibop.asar"'
                '';
              postFixup = (old.postFixup or "") + ''
                wrapProgram $out/bin/equibop \
                  --prefix LD_LIBRARY_PATH : "${
                    lib.makeLibraryPath [
                      libva
                      stdenv.cc.cc.lib
                    ]
                  }"
              '';
            })
        else
          null;

      dorion = cfg.dorion.package;

      legcord = cfg.legcord.package;
    };
in
{
  inherit mkVencordCfg mkFinalPackages;
}
