"""Validate a local release archive against the runtime allowlist and sources."""
import hashlib
import json
import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
package = ROOT / "dist" / f"ai-mate-{version}.xpi"
pack_script = (ROOT / "pack.ps1").read_text(encoding="utf-8")
allowlist = re.findall(r'"([^"\r\n]+)"', pack_script.split("$packageFiles = @(", 1)[1].split(")", 1)[0])

with zipfile.ZipFile(package) as archive:
    names = archive.namelist()
    assert archive.testzip() is None, "ZIP integrity failed"
    assert len(names) == len(set(names)), "Duplicate paths"
    assert set(names) == set(allowlist), "Archive differs from packaging allowlist"
    for name in names:
        assert archive.read(name) == (ROOT / name).read_bytes(), f"Source mismatch: {name}"
    assert json.loads(archive.read("manifest.json")) == manifest
    assert manifest["browser_specific_settings"]["gecko"]["id"] == "ai-mate@enriqueite.com"
    for script in manifest["background"]["scripts"]:
        assert script in names, f"Missing background script: {script}"
    for page in ["popup.html", "reader-popup.html", "options.html"]:
        for script in re.findall(r'<script[^>]+src="([^"]+)"', archive.read(page).decode("utf-8")):
            assert script in names, f"Missing page script: {script}"
    assert not any(name.startswith(("tests/", "node_modules/", "dist/", ".git/")) or "qa-" in name for name in names)

report = {
    "version": version,
    "file": package.name,
    "entries": len(names),
    "bytes": package.stat().st_size,
    "sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
    "integrity": "passed",
    "sourceMatch": "all entries",
}
(ROOT / "dist" / f"verification-{version}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
