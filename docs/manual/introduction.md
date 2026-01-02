# Introduction {#sec-introduction}

Nixcord lets you manage Vencord, Equicord, and clients like Vesktop and Dorion declaratively

Instead of configuring your plugins via the UI (and losing them when you reinstall), you define everything in Nix. It handles patching the client, injecting the config, and keeping your setup reproducible

It supports:
* **Standard Discord** (Stable, PTB, Canary, Dev)
* **Vesktop** & **Equibop**
* **Dorion**

## Getting Started {#getting-started}

Enable it in your Home Manager config:

```nix
{
  programs.nixcord = {
    enable = true;
    
    # Pick your client
    discord.enable = true; 
    # vesktop.enable = true;
  };
}
