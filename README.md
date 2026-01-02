# Nixcord

Manage [Vencord](https://github.com/Vendicated/Vencord), [Equicord](https://github.com/Equicord/Equicord),
[Vesktop](https://github.com/Vencord/Vesktop),
[Equibop](https://github.com/Equicord/Equibop), and
[Dorion](https://github.com/SpikeHD/Dorion) settings and plugins declaratively
with Nix!

This repo can be used to make a clean looking config for Vencord or Equicord
without needing to pollute system config with needless utils to override the
discord package, and write ugly JSON code directly in .nix files.

I started this project after having to reinstall my NixOS system several times,
resulting in manually enabling and configuring the ~100 Vencord plugins more
than 4 times. With Nixcord you can configure once and save it to a git repo.

>[!WARNING]
> Using Nixcord means comitting to declaratively installing plugins. This means
> that the normal "plugins" menu in Vencord or Equicord will not apply permenant changes.
> You can still use it to test out plugins but on restarting the client, any
> changes will be gone.
>
> The primary goal of this project is to reduce the need to configure Vencord or Equicord
> again on every new system you install.

## How to use Nixcord

Currently Nixcord only supports nix flakes as a
[home-manager](https://github.com/nix-community/home-manager) module.

First, you need to import the module:

```nix
# flake.nix
{
  # ...
  inputs.nixcord = {
    url = "github:kaylorben/nixcord";
  };
  # ...
}
```

Next you'll have to import the home-manager module into flake.nix. This step
varies depending on how you have home-manager installed. Here is a simple
example of home-manager installed as a nixos module:

```nix
# flake.nix
{
  # ...
  outputs = inputs@{ nixpkgs, home-manager, ... }: {
    nixosConfigurations = {
      hostname = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          ./configuration.nix
          home-manager.nixosModules.home-manager
          {
            home-manager.useGlobalPkgs = true;
            home-manager.useUserPackages = true;
            home-manager.users.jdoe = import ./home.nix;

            home-manager.sharedModules = [
              inputs.nixcord.homeModules.nixcord
            ];
          }
        ];
      };
    };
  };
  # ...
}
```

or to install to a specific home

```nix
# home.nix
{
  # ...
  imports = [
    inputs.nixcord.homeModules.nixcord
  ];
  # ...
}
```

After installation, you can easily start editing config

## Configuration

This is an example home-manager configuration using Nixcord

```nix
# home.nix
{
  # ...
  programs.nixcord = {
    enable = true;          # Enable Nixcord (It also installs Discord)
    discord = {
      vencord.enable = true;  # Use Vencord (default)
      # equicord.enable = true;  # Or use Equicord instead (cannot enable both)
    };
    vesktop.enable = true;  # Vesktop
    equibop.enable = true;  # Equibop
    dorion.enable = true;   # Dorion
    quickCss = "some CSS";  # quickCSS file
    config = {
      useQuickCss = true;   # use out quickCSS
      themeLinks = [        # or use an online theme
        "https://raw.githubusercontent.com/link/to/some/theme.css"
      ];
      frameless = true;                   # Set some Vencord/Equicord options
      plugins = {
        hideAttachments.enable = true;    # Enable a plugin (works with both Vencord and Equicord)
        ignoreActivities = {              # Enable a plugin and set some options
          enable = true;
          ignorePlaying = true;
          ignoreWatching = true;
          ignoredActivities = [ "someActivity" ];
        };
      };
    };
    dorion = {
      theme = "dark";
      zoom = "1.1";
      blur = "acrylic";       # "none", "blur", or "acrylic"
      sysTray = true;
      openOnStartup = true;
      autoClearCache = true;
      disableHardwareAccel = false;
      rpcServer = true;
      rpcProcessScanner = true;
      pushToTalk = true;
      pushToTalkKeys = ["RControl"];
      desktopNotifications = true;
      unreadBadge = true;
    };
    extraConfig = {
      # Some extra JSON config here
      # ...
    };
  };
  # ...
}
```

### Dorion Setup Requirements

> [!IMPORTANT]
> Before enabling Dorion with nixcord, you must first launch Dorion once to
> create the necessary LocalStorage databases for Vencord settings

> [!IMPORTANT]
> When using Dorion with nixcord, you may encounter an "Unsupported Browser"
error when attempting to join voice channels or unmute. This is due to
incomplete WebRTC support within WebkitGTK, which Dorion currently relies on.
Unfortunately, there is no known workaround for this limitation from our side.

1. Run Dorion temporarily to set up the initial environment:

```bash
# Using nix run
nix run github:KaylorBen/nixcord#dorion

# Or using legacy nix-build
nix-build https://github.com/KaylorBen/nixcord/archive/main.tar.gz -A packages.$(nix-instantiate --eval -E 'builtins.currentSystem' | tr -d '"').dorion
```

2. In Dorion, log into your Discord account, then close Dorion
completely.

3. Now enable Dorion in your Home Manager configuration and rebuild

This step is required because nixcord automatically configures Vencord settings
in Dorion's LocalStorage database, but these databases only exist after the
first launch and login

It is highly recommend configuring Nixcord with an open Vencord, Equicord,
Vesktop, or Equibop client to look through available plugins and options.
A list of all available options is available in the online documentation
[here](https://flameflag.github.io/nixcord/).

### Choosing Between Vencord and Equicord

Nixcord supports both [Vencord](https://github.com/Vendicated/Vencord) and
[Equicord](https://github.com/Equicord/Equicord).

Both are Discord client modifications with similar functionality, but Equicord
includes additional plugins and features. You can only enable one at a time:

- **Vencord**: The original and more widely used client mod
- **Equicord**: A fork with additional plugins and features, including Equicord-specific plugins

When you enable Equicord, you'll have access to all shared plugins (available
in both), plus Equicord-only plugins. Similarly, with Vencord you get shared
plugins plus Vencord-only plugins.

## Documentation

You can find the rendered docs at: https://flameflag.github.io/nixcord/

Alternatively, you can build them locally with `nix build .#docs-html` and view
them with `nix run .#docs`

You can also export all options to JSON using `nix build .#docs-json`

## Special Thanks

Special Thanks to [Vencord](https://github.com/Vendicated/Vencord),
[Equicord](https://github.com/Equicord/Equicord),
[Home Manager](https://github.com/nix-community/home-manager), and
[Nix](https://nixos.org/) and all the contributers behind them. Without them,
this project would not be possible.

## Disclaimer

Using Vencord violates Discord's terms of service.
Read more about it at [their github](https://github.com/Vendicated/Vencord)
