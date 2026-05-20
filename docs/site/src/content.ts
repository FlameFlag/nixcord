import configurationExample from './examples/configuration.nix?raw';
import darwinExample from './examples/darwin.nix?raw';
import flakeExample from './examples/flake.nix?raw';
import homeManagerExample from './examples/home-manager.nix?raw';
import legcordExample from './examples/legcord.nix?raw';
import nixosExample from './examples/nixos.nix?raw';
import userPluginsExample from './examples/user-plugins.nix?raw';

declare const __NIXCORD_REVISION__: string;

export const revision = __NIXCORD_REVISION__;

export const mainToc = [
  { href: '#sec-preface', label: 'Preface' },
  { href: '#sec-introduction', label: 'Introduction' },
  { href: '#sec-options', label: 'Configuration Options' },
];

export const prefaceToc = [
  { href: '#prerequisites', label: 'Prerequisites' },
  { href: '#reporting-issues', label: 'Reporting Issues' },
  { href: '#contributing', label: 'Contributing' },
];

export const introductionToc = [
  { href: '#getting-started', label: 'Getting Started' },
  { href: '#sec-configuration', label: 'Configuration' },
  { href: '#sec-legcord', label: 'Legcord' },
  { href: '#sec-user-plugins', label: 'Third-Party User Plugins' },
  { href: '#sec-dorion', label: 'A Note on Dorion' },
];

export {
  configurationExample,
  darwinExample,
  flakeExample,
  homeManagerExample,
  legcordExample,
  nixosExample,
  userPluginsExample,
};
