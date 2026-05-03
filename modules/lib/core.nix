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

  defaultParseRules = builtins.fromJSON (builtins.readFile ../plugins/parse-rules.json);

  # mergeLists :: [a] -> [a] -> [a]
  mergeLists = base: extra: lists.unique (base ++ extra);

  upperNames = mergeLists defaultParseRules.upperNames parseRules.upperNames;
  upperNamesMask = lib.genAttrs upperNames (_: null);
  lowerPluginTitles = mergeLists defaultParseRules.lowerPluginTitles parseRules.lowerPluginTitles;
  lowerPluginTitlesMask = lib.genAttrs lowerPluginTitles (_: null);
  mergeSettingRenames = base: extra: lib.recursiveUpdate base extra;
  settingRenames = mergeSettingRenames (defaultParseRules.settingRenames or { }) (
    parseRules.settingRenames or { }
  );

  isLowerCase = s: strings.toLower s == s;

  # Converts camelCase to UPPER_SNAKE_CASE using the same split approach as toSnakeCase.
  unNixify =
    nixName:
    strings.toUpper (
      lib.pipe nixName [
        (builtins.split "([A-Z])")
        (builtins.foldl' (
          acc: part:
          if builtins.isList part then acc + "_" + (strings.toLower (builtins.elemAt part 0)) else acc + part
        ) "")
        (builtins.replaceStrings [ "__" ] [ "_" ])
      ]
    );

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
  # specialRenames, settingRenames, upperNames, and lowerPluginTitles.
  normalizeName =
    context: name: value:
    if specialRenames ? ${name} then
      specialRenames.${name}
    else if settingRenames ? ${context} && settingRenames.${context} ? ${name} then
      settingRenames.${context}.${name}
    else if upperNamesMask ? ${name} then
      unNixify name
    else if lowerPluginTitlesMask ? ${name} then
      name
    else if builtins.isAttrs value && value ? enable && isLowerCamel name then
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
        enableAutoscroll = cfg.discord.autoscroll.enable;
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
