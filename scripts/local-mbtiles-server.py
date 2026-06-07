#!/usr/bin/env python3
"""Serve NavAid docs plus Flight Maps tiles — local or live.

Tile resolution order for each request:
  1. Extracted local tile dir (--tile-dir, default ~/Downloads/flight-maps-tiles)
  2. Download from flight-maps.com → cache in --download-cache (default /tmp/navaid-tiles)
     with a SHA-256 sidecar (.sha256) so cached content can be verified.
  3. MBTiles SQLite lookup (--mbtiles-dir, optional — skipped if files are absent)
  4. 404

Usage:
  python3 scripts/local-mbtiles-server.py          # serves with live download fallback
  python3 scripts/local-mbtiles-server.py --extract
  python3 scripts/local-mbtiles-server.py --extract-only
  open http://127.0.0.1:8000/?localTiles=1

The server maps:
  /tiles/cvfr/{z}/{x}/{y}.png   -> CVFR layer
  /tiles/nav/{z}/{x}/{y}.png    -> Navigation layer
  /tiles/la/{z}/{x}/{y}.png     -> Low Altitude layer
  /tiles/il-hel/{z}/{x}/{y}.png -> Helicopters layer

MBTiles store rows in TMS order; Leaflet requests XYZ, so Y is flipped.
"""

from __future__ import annotations

import argparse
import hashlib
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional
import urllib.request
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOCS = ROOT / "docs"
DEFAULT_MBTILES_DIR = Path.home() / "Downloads" / "flight-maps-mbtiles"
DEFAULT_TILE_DIR = Path.home() / "Downloads" / "flight-maps-tiles"
DEFAULT_DOWNLOAD_CACHE = Path("/tmp") / "navaid-tiles"
UPSTREAM_BASE = "https://flight-maps.com/tiles"
TILE_RE = re.compile(r"^/tiles/(cvfr|nav|la|il-hel)/(\d+)/(\d+)/(\d+)\.png$")
MBTILES_FILES = {
    "cvfr": "CVFR.mbtiles",
    "nav": "Israel-Navigation.mbtiles",
    "la": "LSA-Low-Altitude.mbtiles",
    "il-hel": "Israel-Helicopters.mbtiles",
}
_DOWNLOAD_TIMEOUT = 10


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve NavAid with Flight Maps tiles (live download + local cache)."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--docs", default=str(DEFAULT_DOCS))
    parser.add_argument("--mbtiles-dir", default=str(DEFAULT_MBTILES_DIR),
                        help="Directory of *.mbtiles files (optional fallback).")
    parser.add_argument("--tile-dir", default=str(DEFAULT_TILE_DIR),
                        help="Pre-extracted XYZ PNG tiles (checked before download).")
    parser.add_argument("--download-cache", default=str(DEFAULT_DOWNLOAD_CACHE),
                        help="Directory for tiles downloaded from flight-maps.com "
                             "(default: /tmp/navaid-tiles). SHA-256 sidecars are "
                             "written alongside each PNG for verification.")
    parser.add_argument(
        "--extract",
        action="store_true",
        help="Extract all MBTiles into --tile-dir before serving.",
    )
    parser.add_argument(
        "--extract-only",
        action="store_true",
        help="Extract all MBTiles into --tile-dir and exit.",
    )
    parser.add_argument(
        "--force-extract",
        action="store_true",
        help="Overwrite existing extracted tile PNGs.",
    )
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Disable live tile download from flight-maps.com.",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# MBTiles helpers
# ---------------------------------------------------------------------------

def tile_from_mbtiles(db_path: Path, z: int, x: int, y: int) -> Optional[bytes]:
    if z < 0 or x < 0 or y < 0:
        return None
    max_index = (1 << z) - 1
    if x > max_index or y > max_index:
        return None
    tms_y = max_index - y
    uri = f"file:{db_path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as con:
        row = con.execute(
            "select tile_data from tiles "
            "where zoom_level = ? and tile_column = ? and tile_row = ?",
            (z, x, tms_y),
        ).fetchone()
    return row[0] if row else None


def tile_path(tile_dir: Path, layer: str, z: int, x: int, y: int) -> Path:
    return tile_dir / layer / str(z) / str(x) / f"{y}.png"


def write_tile(path: Path, tile: bytes) -> None:
    """Atomically write tile bytes; also write a SHA-256 sidecar."""
    path.parent.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256(tile).hexdigest()
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(tile)
    os.replace(tmp, path)
    path.with_suffix(".sha256").write_text(sha + "\n", encoding="ascii")


def cached_tile_valid(path: Path) -> bool:
    """Return True if the tile file exists and its SHA-256 sidecar matches."""
    if not path.is_file():
        return False
    sha_file = path.with_suffix(".sha256")
    if not sha_file.is_file():
        return True  # no sidecar → treat as valid (legacy / manual copy)
    expected = sha_file.read_text(encoding="ascii").strip()
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    return actual == expected


# ---------------------------------------------------------------------------
# Live download
# ---------------------------------------------------------------------------

def download_tile(layer: str, z: int, x: int, y: int) -> Optional[bytes]:
    """Fetch one tile from flight-maps.com; return bytes or None on failure."""
    url = f"{UPSTREAM_BASE}/{layer}/{z}/{x}/{y}.png"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "NavAid-local-server/1.0"},
        )
        with urllib.request.urlopen(req, timeout=_DOWNLOAD_TIMEOUT) as resp:
            if resp.status == 200:
                return resp.read()
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Bulk extract
# ---------------------------------------------------------------------------

def extract_mbtiles(
    db_path: Path,
    tile_dir: Path,
    layer: str,
    force: bool = False,
) -> tuple[int, int, int]:
    total = written = skipped = 0
    uri = f"file:{db_path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as con:
        rows = con.execute(
            "select zoom_level, tile_column, tile_row, tile_data "
            "from tiles order by zoom_level, tile_column, tile_row"
        )
        for z, x, tms_y, tile in rows:
            total += 1
            max_index = (1 << z) - 1
            y = max_index - tms_y
            path = tile_path(tile_dir, layer, z, x, y)
            if path.exists() and not force:
                skipped += 1
                continue
            write_tile(path, tile)
            written += 1
    return total, written, skipped


def extract_all(mbtiles_dir: Path, tile_dir: Path, force: bool = False) -> None:
    for layer, filename in MBTILES_FILES.items():
        db_path = mbtiles_dir / filename
        if not db_path.is_file():
            raise SystemExit(f"Missing MBTiles file: {db_path}")
        total, written, skipped = extract_mbtiles(db_path, tile_dir, layer, force)
        print(
            f"Extracted {layer}: {written} written, {skipped} skipped, "
            f"{total} total",
            flush=True,
        )


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class NavAidMbtilesHandler(SimpleHTTPRequestHandler):
    mbtiles_dir: Path = DEFAULT_MBTILES_DIR
    tile_dir: Path = DEFAULT_TILE_DIR
    download_cache: Path = DEFAULT_DOWNLOAD_CACHE
    no_download: bool = False

    def do_HEAD(self) -> None:
        if self.serve_tile_request(send_body=False):
            return
        super().do_HEAD()

    def do_GET(self) -> None:
        if self.serve_tile_request(send_body=True):
            return
        super().do_GET()

    def _send_png(self, data: bytes, send_body: bool) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        if send_body:
            self.wfile.write(data)

    def _send_file_png(self, path: Path, send_body: bool) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        if send_body:
            with path.open("rb") as fh:
                self.wfile.write(fh.read())

    def serve_tile_request(self, send_body: bool) -> bool:
        path = unquote(urlparse(self.path).path)

        if path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            if send_body:
                self.wfile.write(b"ok\n")
            return True

        match = TILE_RE.match(path)
        if not match:
            return False

        layer, z_raw, x_raw, y_raw = match.groups()
        z, x, y = int(z_raw), int(x_raw), int(y_raw)

        # 1. Pre-extracted tile dir (e.g. ~/Downloads/flight-maps-tiles)
        extracted = tile_path(self.tile_dir, layer, z, x, y)
        if extracted.is_file():
            self._send_file_png(extracted, send_body)
            return True

        # 2. Download from flight-maps.com → cache in /tmp with SHA-256 sidecar
        cached = tile_path(self.download_cache, layer, z, x, y)
        if cached_tile_valid(cached):
            self._send_file_png(cached, send_body)
            return True

        if not self.no_download:
            tile = download_tile(layer, z, x, y)
            if tile is not None:
                write_tile(cached, tile)
                self._send_png(tile, send_body)
                return True

        # 3. MBTiles SQLite fallback
        db_path = self.mbtiles_dir / MBTILES_FILES[layer]
        if db_path.is_file():
            try:
                tile = tile_from_mbtiles(db_path, z, x, y)
            except sqlite3.DatabaseError as exc:
                self.send_error(500, f"Could not read {db_path.name}: {exc}")
                return True
            if tile is not None:
                self._send_png(tile, send_body)
                return True

        self.send_error(404, "Tile not found")
        return True

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        # Suppress per-tile noise; only log non-tile requests and errors.
        msg = fmt % args
        code = args[1] if len(args) > 1 else ""
        if "/tiles/" in (args[0] if args else "") and str(code) == "200":
            return
        super().log_message(fmt, *args)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()
    docs = Path(args.docs).expanduser().resolve()
    mbtiles_dir = Path(args.mbtiles_dir).expanduser().resolve()
    tile_dir = Path(args.tile_dir).expanduser().resolve()
    download_cache = Path(args.download_cache).expanduser().resolve()

    if not docs.is_dir():
        raise SystemExit(f"Docs directory not found: {docs}")

    if args.extract or args.extract_only:
        extract_all(mbtiles_dir, tile_dir, args.force_extract)
    if args.extract_only:
        print(f"Extracted tile directory: {tile_dir}", flush=True)
        return

    # Warn (not error) if MBTiles are absent — live download covers the gap.
    missing_mbtiles = [
        mbtiles_dir / filename
        for layer, filename in MBTILES_FILES.items()
        if not (mbtiles_dir / filename).is_file()
        and not (tile_dir / layer).is_dir()
    ]
    if missing_mbtiles and args.no_download:
        joined = "\n  ".join(str(p) for p in missing_mbtiles)
        raise SystemExit(
            "MBTiles missing and --no-download set:\n  " + joined
        )
    if missing_mbtiles:
        print(
            "⚠️  MBTiles not found — tiles will be downloaded from "
            f"flight-maps.com and cached in {download_cache}",
            flush=True,
        )

    mimetypes.add_type("application/manifest+json", ".webmanifest")
    NavAidMbtilesHandler.mbtiles_dir = mbtiles_dir
    NavAidMbtilesHandler.tile_dir = tile_dir
    NavAidMbtilesHandler.download_cache = download_cache
    NavAidMbtilesHandler.no_download = args.no_download
    handler = lambda *a, **kw: NavAidMbtilesHandler(*a, directory=str(docs), **kw)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}/?localTiles=1"
    print(f"Serving NavAid from      {docs}", flush=True)
    print(f"Extracted tile cache:    {tile_dir}", flush=True)
    print(f"Download cache (/tmp):   {download_cache}", flush=True)
    print(f"MBTiles fallback:        {mbtiles_dir}", flush=True)
    print(f"Open {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
