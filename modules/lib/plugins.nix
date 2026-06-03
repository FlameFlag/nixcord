{ lib, ... }:
let
  mkPluginKit =
    cfg:
    let
      sharedPluginNames = builtins.attrNames (lib.importJSON ../plugins/shared.json);
      vencordPluginNames = builtins.attrNames (lib.importJSON ../plugins/vencord.json);
      equicordPluginNames = builtins.attrNames (lib.importJSON ../plugins/equicord.json);

      deprecated = lib.importJSON ../plugins/deprecated.json;
      migrations = lib.importJSON ../plugins/migrations.json;

      activePluginNames = sharedPluginNames ++ vencordPluginNames ++ equicordPluginNames;
      activePluginNamesByLowercase = lib.genAttrs' activePluginNames (
        name: lib.nameValuePair (lib.toLower name) name
      );

      deprecatedPluginNameMigrations = lib.filterAttrs (oldName: newName: oldName != newName) (
        lib.mapAttrs (
          _: value: activePluginNamesByLowercase.${lib.toLower value.to} or value.to
        ) deprecated.renames
      );
      generatedPluginNameMigrations = lib.pipe migrations.renames [
        (lib.filter (
          migration:
          builtins.length migration.from == 2
          && builtins.elemAt migration.from 1 == "enable"
          && builtins.length migration.to >= 1
        ))
        (
          migrations:
          lib.genAttrs' migrations (
            migration: lib.nameValuePair (builtins.elemAt migration.from 0) (builtins.elemAt migration.to 0)
          )
        )
      ];

      pluginsOf = attrs: attrs.plugins or { };

      pluginNameMigrations = deprecatedPluginNameMigrations // generatedPluginNameMigrations;

      isPluginEnabled =
        pluginConfig: builtins.isAttrs pluginConfig && pluginConfig ? enable && pluginConfig.enable;

      collectDeprecatedPlugins =
        configAttrs:
        let
          plugins = pluginsOf configAttrs;
        in
        lib.pipe pluginNameMigrations [
          (lib.filterAttrs (
            oldName: _:
            let
              plugin = plugins.${oldName} or null;
            in
            plugin != null && isPluginEnabled plugin
          ))
          lib.attrNames
        ];

      sharedMask = lib.genAttrs sharedPluginNames (_: null);
      vencordMask = lib.genAttrs vencordPluginNames (_: null);
      equicordMask = lib.genAttrs equicordPluginNames (_: null);

      collectEnabledExclusivePlugins =
        targetSet: otherMask: configAttrs:
        lib.pipe (pluginsOf configAttrs) [
          (lib.filterAttrs (
            name: value:
            builtins.hasAttr name targetSet
            && !(builtins.hasAttr name sharedMask)
            && !(builtins.hasAttr name otherMask)
            && isPluginEnabled value
          ))
          builtins.attrNames
        ];

      collectEnabledEquicordOnlyPlugins = collectEnabledExclusivePlugins equicordMask vencordMask;
      collectEnabledVencordOnlyPlugins = collectEnabledExclusivePlugins vencordMask equicordMask;

      filterPluginsFor =
        client: configAttrs:
        let
          mask =
            sharedMask
            // (
              if client == "vencord" then
                vencordMask
              else if client == "equicord" then
                equicordMask
              else
                { }
            );
          plugins = pluginsOf configAttrs;
        in
        configAttrs // { plugins = builtins.intersectAttrs mask plugins; };

      mkFullConfig =
        {
          baseConfig,
          extraConfig ? { },
          clientConfig ? { },
          client ? null,
        }:
        let
          filteredBaseConfig =
            if client != null then
              filterPluginsFor client baseConfig
            else
              filterPluginsFor (
                if cfg.discord.vencord.enable then
                  "vencord"
                else if cfg.discord.equicord.enable then
                  "equicord"
                else
                  "none"
              ) baseConfig;
        in
        lib.pipe
          [
            filteredBaseConfig
            extraConfig
            clientConfig
          ]
          [ (lib.foldl' lib.recursiveUpdate { }) ];
    in
    {
      inherit
        pluginsOf
        pluginNameMigrations
        collectDeprecatedPlugins
        collectEnabledEquicordOnlyPlugins
        collectEnabledVencordOnlyPlugins
        filterPluginsFor
        mkFullConfig
        ;
    };

  mkAssertions =
    {
      cfg,
      pluginsOf,
      collectEnabledEquicordOnlyPlugins,
      collectEnabledVencordOnlyPlugins,
    }:
    let
      allPlugins.plugins = lib.mergeAttrsList (
        with cfg;
        [ config.plugins ]
        ++ map pluginsOf [
          extraConfig
          vencordConfig
          equicordConfig
          vesktopConfig
          equibopConfig
        ]
      );
      wrongEquicordPlugins = collectEnabledEquicordOnlyPlugins allPlugins;
      wrongVencordPlugins = collectEnabledVencordOnlyPlugins allPlugins;
      hasVencordClient = with cfg; discord.vencord.enable || vesktop.enable || legcord.vencord.enable;
      hasEquicordClient = with cfg; discord.equicord.enable || equibop.enable || legcord.equicord.enable;
    in
    [
      {
        assertion = !(cfg.discord.vencord.enable && cfg.discord.equicord.enable);
        message = "programs.nixcord.discord.vencord.enable and programs.nixcord.discord.equicord.enable cannot both be enabled at the same time. They are mutually exclusive.";
      }
      {
        assertion = !(cfg.legcord.vencord.enable && cfg.legcord.equicord.enable);
        message = "programs.nixcord.legcord.vencord.enable and programs.nixcord.legcord.equicord.enable cannot both be enabled at the same time. They are mutually exclusive.";
      }
      {
        assertion = !(hasVencordClient && !hasEquicordClient) || wrongEquicordPlugins == [ ];
        message = "The following Equicord-only plugins are enabled but only Vencord-based clients are active: ${lib.concatStringsSep ", " wrongEquicordPlugins}. These plugins are not available in Vencord.";
      }
      {
        assertion = !(hasEquicordClient && !hasVencordClient) || wrongVencordPlugins == [ ];
        message = "The following Vencord-only plugins are enabled but only Equicord-based clients are active: ${lib.concatStringsSep ", " wrongVencordPlugins}. These plugins are not available in Equicord.";
      }
    ];
in
{
  inherit mkPluginKit mkAssertions;
}
