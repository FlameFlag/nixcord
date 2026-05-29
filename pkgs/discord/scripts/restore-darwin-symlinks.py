#!/usr/bin/env python3
import pathlib
import sys
import tarfile


def restore_symlinks(tarball: pathlib.Path, dest: pathlib.Path) -> None:
    with tarfile.open(tarball) as tar:
        for member in tar:
            if not member.issym():
                continue

            parts = pathlib.PurePosixPath(member.name).parts[1:]
            if not parts:
                continue

            path = pathlib.Path(dest, *parts)
            path.unlink(missing_ok=True)
            path.symlink_to(member.linkname)


if __name__ == "__main__":
    restore_symlinks(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
