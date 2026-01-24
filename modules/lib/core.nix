{ lib, parseRules, ... }:
let
  inherit (lib)
    attrsets
    lists
    strings
    ;

  inherit (attrsets)
    mapAttrs'
    nameValuePair
    ;

  defaultParseRules = import ../plugins/parse-rules.nix;

  mergeLists = base: extra: lists.unique (base ++ extra);

  upperNames = mergeLists defaultParseRules.upperNames parseRules.upperNames;
  lowerPluginTitles = mergeLists defaultParseRules.lowerPluginTitles parseRules.lowerPluginTitles;

  isLowerCase = s: strings.toLower s == s;

  unNixify =
    nixName:
    strings.toUpper (
      strings.concatStrings (
        builtins.map (char: if isLowerCase char then char else "_" + char) (
          strings.stringToCharacters nixName
        )
      )
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

  normalizeName =
    name: value:
    if specialRenames ? ${name} then
      specialRenames.${name}
    else if builtins.elem name upperNames then
      unNixify name
    else if builtins.elem name lowerPluginTitles then
      name
    else if builtins.isAttrs value && value ? enable && isLowerCamel name then
      toUpper name
    else
      name;

  mkVencordCfg =
    cfg:
    mapAttrs' (
      name: value:
      let
        normalizedValue = if builtins.isAttrs value then mkVencordCfg value else value;
      in
      nameValuePair (normalizeName name value) normalizedValue
    ) cfg;

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
          cfg.equibop.package.override {
            withMiddleClickScroll = cfg.equibop.autoscroll.enable;
          }
        else
          null;

      dorion = cfg.dorion.package;
    };
in
{
  inherit mkVencordCfg mkFinalPackages;
}
