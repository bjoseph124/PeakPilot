"""Reproduce the complete numerical benchmark without a web browser."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import platform
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from peakpilot.engine import BUILDINGS, simulate  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--building", choices=list(BUILDINGS), default="office")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = simulate(args.building)
    summary = {key: value for key, value in result.items() if key != "series"}
    summary["versions"] = {name: importlib.metadata.version(name) for name in ["numpy", "pandas", "scipy", "scikit-learn"]}
    summary["versions"]["python"] = platform.python_version()
    text = json.dumps(summary, indent=2, allow_nan=False)
    print(text)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n")


if __name__ == "__main__":
    main()
