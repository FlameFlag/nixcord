# Nixcord

Manage [Vencord](https://github.com/Vendicated/Vencord), [Equicord](https://github.com/Equicord/Equicord), [Vesktop](https://github.com/Vencord/Vesktop), and [Dorion](https://github.com/SpikeHD/Dorion) configuration declaratively

> **Heads up:** Since this is declarative, the in-app "Plugins" menu won't save changes permanently. You have to update your `.nix` file to make settings stick

## Quickstart

Add to `flake.nix`:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    nixcord.url = "github:FlameFlag/nixcord";
    # ...
  };
  
  # ...
}
````

Then import the module

**Home Manager (Recommended)**

Most people should use this. It handles paths and permissions for you

```nix
# home.nix
{ inputs, ... }: {
  imports = [ inputs.nixcord.homeModules.nixcord ];
  # ... config
}
```

**NixOS (System-wide)**

If you don't use Home Manager

```nix
# configuration.nix
{ inputs, ... }: {
  imports = [ inputs.nixcord.nixosModules.nixcord ];

  programs.nixcord = {
    enable = true;
    user = "your-username"; # Needed for system-level config
    # ... config
  };
}
```

**nix-darwin (macOS)**

If you are managing your Mac system-wide

```nix
# darwin-configuration.nix
{ inputs, ... }: {
  imports = [ inputs.nixcord.darwinModules.nixcord ];

  programs.nixcord = {
    enable = true;
    user = "your-username"; # Needed for system-level config
    # ... config
  };
}
```

## Configuration

You can configure Vencord (default), Equicord, Vesktop, or Dorion

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
          ignoredActivities = [ "League of Legends" ];
        };
      };
    };
  };
}
```

Check the [online docs](https://flameflag.github.io/nixcord/) for the full list of options

## A Note on Dorion

Dorion is a bit annoying because it needs `LocalStorage` databases that only exist after a successful launch. If you just enable it in Nix immediately, it won't work

1.  Run it once temporarily: `nix run github:FlameFlag/nixcord#dorion` (or `nix-build https://github.com/FlameFlag/nixcord/archive/main.tar.gz -A packages.$(nix-instantiate --eval -E 'builtins.currentSystem' | tr -d '"').dorion` if you use "legacy" nix)
2.  Log in and close it.
3.  Enable `dorion.enable = true` in your config and rebuild.

*Also, Dorion uses WebKitGTK, so voice/video might fail with "Unsupported Browser" errors. Can't fix that on our end, sorry.*

## Docs

  * **Web:** [flameflag.github.io/nixcord](https://flameflag.github.io/nixcord/)
  * **CLI:** `nix run .#docs`
  * **JSON:** `nix build .#docs-json`

-----

*Disclaimer: Vencord violates Discord ToS. You probably know this already, but use at your own risk.*
