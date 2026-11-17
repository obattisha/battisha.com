"""Builds site/main from templates/main.html, inserting the travel tracker partial.

Run from the repo root:  python3 scripts/build-main.py
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
tpl = (root / "templates/main.html").read_text(encoding="utf-8")
tracker = (root / "templates/tracker.html").read_text(encoding="utf-8")
assert "{{TRACKER}}" in tpl
(root / "site/main").write_text(tpl.replace("{{TRACKER}}", tracker.rstrip("\n")), encoding="utf-8")
print("built site/main")
