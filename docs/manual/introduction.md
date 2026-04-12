# Introduction {#sec-introduction}

Nixcord lets you manage [Vencord](https://github.com/Vendicated/Vencord), [Equicord](https://github.com/Equicord/Equicord), and clients like [Vesktop](https://github.com/Vencord/Vesktop), [Dorion](https://github.com/SpikeHD/Dorion), and [Legcord](https://github.com/Legcord/Legcord) declaratively

Instead of configuring your plugins via the UI (and losing them when you reinstall), you define everything in Nix. It handles patching the client, injecting the config, and keeping your setup reproducible

> **Heads up:** Since this is declarative, the in-app "Plugins" menu won't save changes permanently. You have to update your `.nix` file to make settings stick

It supports:
* **Standard Discord** (Stable, PTB, Canary, Dev), with Vencord or Equicord
* **Vesktop** & **Equibop**
* **Dorion**
* **Legcord**

## Getting Started {#getting-started}

Add Nixcord to your `flake.nix` inputs:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    nixcord.url = "github:FlameFlag/nixcord";
    # ...
  };
}
```

Then import the module:

**Home Manager (Recommended)**

```nix
# home.nix
{ inputs, ... }: {
  imports = [ inputs.nixcord.homeModules.nixcord ];
}
```

**NixOS (System-wide)**

```nix
# configuration.nix
{ inputs, ... }: {
  imports = [ inputs.nixcord.nixosModules.nixcord ];

  programs.nixcord = {
    enable = true;
    user = "your-username"; # Needed for system-level config
  };
}
```

**nix-darwin (macOS)**

```nix
# darwin-configuration.nix
{ inputs, ... }: {
  imports = [ inputs.nixcord.darwinModules.nixcord ];

  programs.nixcord = {
    enable = true;
    user = "your-username"; # Needed for system-level config
  };
}
```

## Configuration {#sec-configuration}

Enable your client and configure plugins:

**Tip:** Launch your client once manually to look through the plugins list so you know what you actually want to enable

```nix
{
  programs.nixcord = {
    enable = true;

    # Choose your client (enable only one of these two)
    discord.vencord.enable = true;      # Standard Vencord
    # discord.equicord.enable = true;   # Equicord (has more plugins)

    # Or these
    vesktop.enable = true;
    # dorion.enable = true;
    # legcord.enable = true;

    # Theming
    quickCss = "/* css goes here */";
    config = {
      useQuickCss = true;
      themeLinks = [
        "https://raw.githubusercontent.com/link/to/some/theme.css"
      ];
      frameless = true;

      plugins = {
        hideAttachments.enable = true;
        ignoreActivities = {
          enable = true;
          ignorePlaying = true;
          ignoredActivities = [
            { id = "game-id"; name = "League of Legends"; type = 0; }
          ];
        };
      };
    };
  };
}
```

## Legcord {#sec-legcord}

[Legcord](https://github.com/Legcord/Legcord) is a lightweight Discord client. Enable it with:

```nix
{
  programs.nixcord.legcord = {
    enable = true;

    # Optionally bundle Vencord or Equicord (also installs userPlugins)
    vencord.enable = true;
    # equicord.enable = true;

    settings = {
      channel = "stable";
      tray = "dynamic";
      minimizeToTray = true;
      mods = [ "vencord" ];
      doneSetup = true;
    };
  };
}
```

## Third-Party User Plugins {#sec-user-plugins}

You can load custom Vencord/Equicord plugins that aren't in the upstream plugin list using `userPlugins`. Any plugin you add also needs to be enabled in `extraConfig.plugins`:

```nix
{
  programs.nixcord = {
    # GitHub repo at a specific commit
    userPlugins = {
      someCoolPlugin = "github:someUser/someCoolPlugin/abc123def456...";

      # Local path (requires --impure with flakes)
      myLocalPlugin = "/home/user/projects/myPlugin";

      # Nix path literal
      anotherPlugin = ./plugins/anotherPlugin;
    };

    extraConfig.plugins = {
      someCoolPlugin.enable = true;
      myLocalPlugin.enable = true;
      anotherPlugin.enable = true;
    };
  };
}
```

## A Note on Dorion {#sec-dorion}

Dorion needs `LocalStorage` databases that only exist after a successful launch. If you just enable it in Nix immediately, it won't work

1.  Run it once temporarily: `nix run github:FlameFlag/nixcord#dorion`
2.  Log in and close it
3.  Enable `dorion.enable = true` in your config and rebuild

*Dorion uses WebKitGTK, so voice/video might fail with "Unsupported Browser" errors. Can't fix that on our end*
