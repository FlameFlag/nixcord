{
  pkgs,
  revision ? "main",
  ...
}:
let
  optionsDoc = pkgs.callPackage ./options-doc.nix {
    inherit revision;
  };

  site = pkgs.callPackage ./site.nix {
    nixcord-options = optionsDoc.optionsJSON;
    inherit revision;
  };
in
{
  html = site;
  json = optionsDoc.optionsJSON;
}
