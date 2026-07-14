#!/usr/bin/env python3
"""Verify that the Python package builds and the wheel contains the expected entry point."""
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent


def main() -> None:
    dist = ROOT / "dist"
    if dist.exists():
        for f in dist.iterdir():
            f.unlink()

    print("Building package…")
    subprocess.run([sys.executable, "-m", "uv", "build"], cwd=ROOT, check=True)

    wheels = list(dist.glob("*.whl"))
    sdists = list(dist.glob("*.tar.gz"))

    assert len(wheels) == 1, f"Expected 1 wheel, found {len(wheels)}"
    assert len(sdists) == 1, f"Expected 1 sdist, found {len(sdists)}"

    wheel = wheels[0]
    with zipfile.ZipFile(wheel) as zf:
        entries = [n for n in zf.namelist() if "entry_points.txt" in n]
        assert entries, "No entry_points.txt found in wheel"
        content = zf.read(entries[0]).decode()
        assert "intervals-api" in content, "intervals-api entry point not found in wheel"

    print("✓ Package artifacts verified.")
    print(f"  wheel:  {wheel.name}")
    print(f"  sdist:  {sdists[0].name}")


if __name__ == "__main__":
    main()
