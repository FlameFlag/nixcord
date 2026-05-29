#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def set_local_modules_root(build_info_path: Path, modules_root: str) -> None:
    with build_info_path.open() as f:
        build_info = json.load(f)

    build_info["localModulesRoot"] = modules_root

    with build_info_path.open("w") as f:
        json.dump(build_info, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    set_local_modules_root(Path(sys.argv[1]), sys.argv[2])
