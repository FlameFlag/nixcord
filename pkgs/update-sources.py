#!/usr/bin/env python3
"""Refresh pkgs/sources.json with the latest Discord builds.

Adapted from upstream nixpkgs (NixOS/nixpkgs PR #506089). Honors the
DISCORD_BRANCHES env var (comma-separated) so CI matrix jobs can update one
branch at a time without churning unrelated entries.
"""

import json
import os
import os.path
import re
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from subprocess import PIPE, Popen
from typing import List, Optional

VERSION_REGEX = re.compile(r"\/([\d.]+)\/")

# pmovmskb %xmm0, %eax + cmp $0xffff, %eax (ELF MD5 compare idiom)
KRISP_PATCH_SIGNATURE = b"\x66\x0f\xd7\xc0\x3d\xff\xff\x00\x00"
# Apple Security framework anchor used for Mach-O call-chain tracing
ANCHOR_IMPORT = b"_SecStaticCodeCreateWithPath"

# The distributions API rejects requests that don't send a Discord-Updater
# User-Agent.
DISTRO_USER_AGENT = "Discord-Updater/1"
GENERIC_USER_AGENT = "Nixpkgs-Discord-Update-Script/0.0.0"


class Platform(StrEnum):
    LINUX = "linux"
    MACOS = "osx"

    def format_type(self) -> str:
        if self.value == Platform.LINUX.value:
            return "tar.gz"
        if self.value == Platform.MACOS.value:
            return "dmg"
        raise RuntimeError(f"Invalid platform {self.value}")


class Branch(StrEnum):
    STABLE = "stable"
    PTB = "ptb"
    CANARY = "canary"
    DEVELOPMENT = "development"


class Kind(StrEnum):
    LEGACY = "legacy"
    DISTRO = "distro"


@dataclass(frozen=True)
class Variant:
    platform: Platform
    branch: Branch
    kind: Kind


@dataclass
class LegacySource:
    version: str
    url: str
    hash: str
    kind: Kind = Kind.LEGACY


@dataclass
class DistroRef:
    url: str
    hash: str


@dataclass
class DistroModule:
    version: int
    url: str
    hash: str


@dataclass
class DistroSource:
    version: str
    distro: DistroRef
    modules: dict = field(default_factory=dict)
    kind: Kind = Kind.DISTRO


def serialize_variant(variant: Variant) -> str:
    return f"{variant.platform}-{variant.branch}"


def url_for_variant(variant: Variant) -> str:
    return (
        f"https://discord.com/api/download/{variant.branch.value}"
        f"?platform={variant.platform.value}&format={variant.platform.format_type()}"
    )


def distro_manifest_url_for_variant(variant: Variant) -> str:
    return (
        f"https://updates.discord.com/distributions/app/manifests/latest"
        f"?channel={variant.branch.value}&platform={variant.platform.value}&arch=x64"
    )


def fetch_redirect_url(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": GENERIC_USER_AGENT})
    with urllib.request.urlopen(req) as response:
        return response.url


def version_from_url(url: str) -> str:
    matches = VERSION_REGEX.search(url)
    assert matches, f"URL {url} must contain version number"
    version = matches.group(1)
    assert version
    return version


def prefetch(url: str) -> str:
    with Popen(["nix-prefetch-url", "--name", "source", url], stdout=PIPE) as p:
        assert p.stdout
        b32_hash = p.stdout.read().decode("utf-8").strip()
    with Popen(
        ["nix-hash", "--to-sri", "--type", "sha256", b32_hash], stdout=PIPE
    ) as p:
        assert p.stdout
        return p.stdout.read().decode("utf-8").strip()


def fetch_distro_manifest(variant: Variant) -> dict:
    url = distro_manifest_url_for_variant(variant)
    req = urllib.request.Request(url, headers={"User-Agent": DISTRO_USER_AGENT})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read())


def version_triple_to_str(triple: list) -> str:
    return ".".join(str(x) for x in triple)


def fetch_distro_source(variant: Variant) -> DistroSource:
    manifest = fetch_distro_manifest(variant)

    distro_url = manifest["full"]["url"]
    modules = {
        name: DistroModule(
            version=mod["full"]["module_version"],
            url=mod["full"]["url"],
            hash=prefetch(mod["full"]["url"]),
        )
        for name, mod in manifest["modules"].items()
    }

    return DistroSource(
        version=version_triple_to_str(manifest["full"]["host_version"]),
        distro=DistroRef(url=distro_url, hash=prefetch(distro_url)),
        modules=modules,
    )


def fetch_legacy_source(variant: Variant) -> LegacySource:
    url = fetch_redirect_url(url_for_variant(variant))
    return LegacySource(
        version=version_from_url(url),
        url=url,
        hash=prefetch(url),
    )


def fetch_krisp_module_url(branch: Branch, version: str, platform: Platform) -> Optional[str]:
    url = (
        f"https://discord.com/api/modules/{branch.value}/versions.json"
        f"?host_version={version}&platform={platform.value}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": GENERIC_USER_AGENT})
    with urllib.request.urlopen(req) as response:
        modules = json.loads(response.read())

    if "discord_krisp" not in modules:
        return None

    krisp_ver = modules["discord_krisp"]
    download_url = (
        f"https://discord.com/api/modules/{branch.value}/discord_krisp/{krisp_ver}"
        f"?host_version={version}&platform={platform.value}"
    )
    return fetch_redirect_url(download_url)


def verify_krisp_patchable(url: str) -> bool:
    """Download krisp and confirm it contains the expected patch target."""
    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = os.path.join(tmpdir, "krisp.zip")
        req = urllib.request.Request(url, headers={"User-Agent": GENERIC_USER_AGENT})
        with urllib.request.urlopen(req) as resp, open(zip_path, "wb") as f:
            f.write(resp.read())

        with zipfile.ZipFile(zip_path) as zf:
            if "discord_krisp.node" not in zf.namelist():
                print("  WARNING: discord_krisp.node not found in zip")
                return False
            zf.extract("discord_krisp.node", tmpdir)

        with open(os.path.join(tmpdir, "discord_krisp.node"), "rb") as f:
            data = f.read()

        if data[:4] == b"\x7fELF":
            count = data.count(KRISP_PATCH_SIGNATURE)
            if count != 1:
                print(f"  WARNING: found {count} ELF signature matches (expected 1)")
                return False
            print("  Verified: ELF signature pattern found (1 unique match)")
            return True

        if ANCHOR_IMPORT in data:
            print("  Verified: Mach-O contains _SecStaticCodeCreateWithPath import")
            return True

        print("  WARNING: no patchable target found")
        return False


# Branch layout: each branch has a (kind) per platform. Linux ptb/canary/dev
# moved to the distro layout in upstream PR #506089; everything else is legacy.
ALL_VARIANTS: List[Variant] = [
    Variant(Platform.LINUX, Branch.STABLE, Kind.LEGACY),
    Variant(Platform.LINUX, Branch.PTB, Kind.DISTRO),
    Variant(Platform.LINUX, Branch.CANARY, Kind.DISTRO),
    Variant(Platform.LINUX, Branch.DEVELOPMENT, Kind.DISTRO),
    Variant(Platform.MACOS, Branch.STABLE, Kind.LEGACY),
    Variant(Platform.MACOS, Branch.PTB, Kind.LEGACY),
    Variant(Platform.MACOS, Branch.CANARY, Kind.LEGACY),
    Variant(Platform.MACOS, Branch.DEVELOPMENT, Kind.LEGACY),
]


def selected_variants() -> List[Variant]:
    raw = os.environ.get("DISCORD_BRANCHES", "").strip()
    if not raw:
        return ALL_VARIANTS
    wanted = {b.strip() for b in raw.split(",") if b.strip()}
    return [v for v in ALL_VARIANTS if v.branch.value in wanted]


def find_sources_json() -> str:
    """Locate pkgs/sources.json. Prefer SOURCES_JSON, then CWD, then walk up."""
    explicit = os.environ.get("SOURCES_JSON")
    if explicit:
        return explicit
    candidates = ["pkgs/sources.json", "sources.json"]
    for c in candidates:
        if os.path.isfile(c):
            return os.path.abspath(c)
    cwd = os.path.abspath(os.getcwd())
    while cwd != "/":
        candidate = os.path.join(cwd, "pkgs", "sources.json")
        if os.path.isfile(candidate):
            return candidate
        cwd = os.path.dirname(cwd)
    raise SystemExit("Error: could not find pkgs/sources.json (set SOURCES_JSON to override)")


def main() -> None:
    sources_path = find_sources_json()

    try:
        with open(sources_path) as f:
            sources = json.load(f)
    except FileNotFoundError:
        sources = {}

    variants = selected_variants()
    if not variants:
        print("No matching branches selected; nothing to do.", file=sys.stderr)
        return

    for v in variants:
        key = serialize_variant(v)
        print(f"Fetching {key} ({v.kind.value})...")
        try:
            source = (
                fetch_distro_source(v) if v.kind == Kind.DISTRO else fetch_legacy_source(v)
            )
            sources[key] = asdict(source)
            print(f"  -> version {source.version}")
        except Exception as exc:
            print(f"  Failed to fetch {key}: {exc}", file=sys.stderr)
            continue

    for v in variants:
        key = serialize_variant(v)
        if key not in sources:
            continue
        # Distro builds embed krisp inside source.modules; only legacy builds
        # need a separate "${variant}-krisp" entry
        if v.kind == Kind.DISTRO:
            sources.pop(f"{key}-krisp", None)
            continue

        version = sources[key]["version"]
        print(f"Fetching krisp for {key} (v{version})...")
        try:
            krisp_url = fetch_krisp_module_url(v.branch, version, v.platform)
            if krisp_url is None:
                print(f"  No krisp module available for {key}")
                sources.pop(f"{key}-krisp", None)
                continue
            if not verify_krisp_patchable(krisp_url):
                print(f"  WARNING: krisp for {key} is NOT patchable, skipping")
                continue
            krisp_hash = prefetch(krisp_url)
            sources[f"{key}-krisp"] = {
                "url": krisp_url,
                "version": krisp_url
                .rsplit("/", 1)[-1]
                .split("?")[0]
                .replace("discord_krisp-", "")
                .replace(".zip", ""),
                "hash": krisp_hash,
            }
            print(f"  OK: krisp for {key}")
        except Exception as exc:
            print(f"  Failed to fetch krisp for {key}: {exc}", file=sys.stderr)

    with open(sources_path, "w") as f:
        json.dump(sources, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"Wrote {sources_path}")


if __name__ == "__main__":
    main()
