#!/usr/bin/env python3
"""Serve NavAid docs plus local Flight Maps MBTiles.

Usage:
  python3 scripts/local-mbtiles-server.py
  python3 scripts/local-mbtiles-server.py --extract
  python3 scripts/local-mbtiles-server.py --extract-only
  open http://127.0.0.1:8000/?localTiles=1

The server maps:
  /tiles/cvfr/{z}/{x}/{y}.png   -> CVFR.mbtiles
  /tiles/nav/{z}/{x}/{y}.png    -> Israel-Navigation.mbtiles
  /tiles/la/{z}/{x}/{y}.png     -> LSA-Low-Altitude.mbtiles
  /tiles/il-hel/{z}/{x}/{y}.png -> Israel-Helicopters.mbtiles

MBTiles store rows in TMS order; Leaflet requests XYZ, so Y is flipped.
With extracted tiles present, files under ~/Downloads/flight-maps-tiles are
served first and SQLite is only used as a fallback.
"""

from __future__ import annotations

import argparse
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOCS = ROOT / "docs"
DEFAULT_MBTILES_DIR = Path.home() / "Downloads" / "flight-maps-mbtiles"
DEFAULT_TILE_DIR = Path.home() / "Downloads" / "flight-maps-tiles"
TILE_RE = re.compile(r"^/tiles/(cvfr|nav|la|il-hel)/(\d+)/(\d+)/(\d+)\.png$")
MBTILES_FILES = {
    "cvfr": "CVFR.mbtiles",
    "nav": "Israel-Navigation.mbtiles",
    "la": "LSA-Low-Altitude.mbtiles",
    "il-hel": "Israel-Helicopters.mbtiles",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve NavAid with local Flight Maps MBTiles."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--docs", default=str(DEFAULT_DOCS))
    parser.add_argument("--mbtiles-dir", default=str(DEFAULT_MBTILES_DIR))
    parser.add_argument("--tile-dir", default=str(DEFAULT_TILE_DIR))
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
    return parser.parse_args()


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
            """
            select tile_data
            from tiles
            where zoom_level = ? and tile_column = ? and tile_row = ?
            """,
            (z, x, tms_y),
        ).fetchone()
    return row[0] if row else None


def tile_path(tile_dir: Path, layer: str, z: int, x: int, y: int) -> Path:
    return tile_dir / layer / str(z) / str(x) / f"{y}.png"


def write_tile(path: Path, tile: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(tile)
    os.replace(tmp, path)


def extract_mbtiles(
    db_path: Path,
    tile_dir: Path,
    layer: str,
    force: bool = False,
) -> tuple[int, int, int]:
    total = 0
    written = 0
    skipped = 0
    uri = f"file:{db_path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as con:
        rows = con.execute(
            """
            select zoom_level, tile_column, tile_row, tile_data
            from tiles
            order by zoom_level, tile_column, tile_row
            """
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


class NavAidMbtilesHandler(SimpleHTTPRequestHandler):
    mbtiles_dir = DEFAULT_MBTILES_DIR
    tile_dir = DEFAULT_TILE_DIR

    def do_HEAD(self) -> None:
        if self.serve_mbtiles_request(send_body=False):
            return
        super().do_HEAD()

    def do_GET(self) -> None:
        if self.serve_mbtiles_request(send_body=True):
            return
        super().do_GET()

    def serve_mbtiles_request(self, send_body: bool) -> bool:
        path = unquote(urlparse(self.path).path)
        if path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            if send_body:
                self.wfile.write(b"ok\n")
            return True

        match = TILE_RE.match(path)
        if match:
            layer, z_raw, x_raw, y_raw = match.groups()
            z = int(z_raw)
            x = int(x_raw)
            y = int(y_raw)
            extracted = tile_path(self.tile_dir, layer, z, x, y)
            if extracted.is_file():
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(extracted.stat().st_size))
                self.send_header("Cache-Control", "public, max-age=3600")
                self.end_headers()
                if send_body:
                    with extracted.open("rb") as fh:
                        self.wfile.write(fh.read())
                return True

            db_path = self.mbtiles_dir / MBTILES_FILES[layer]
            if not db_path.is_file():
                self.send_error(503, f"Missing {db_path}")
                return True
            try:
                tile = tile_from_mbtiles(db_path, z, x, y)
            except sqlite3.DatabaseError as exc:
                self.send_error(500, f"Could not read {db_path.name}: {exc}")
                return True
            if tile is None:
                self.send_error(404, "Tile not found")
                return True
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(tile)))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            if send_body:
                self.wfile.write(tile)
            return True

        return False

    def end_headers(self) -> None:
        # Same-origin app requests do not need CORS, but this keeps manual
        # tile checks from another local page painless.
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


def main() -> None:
    args = parse_args()
    docs = Path(args.docs).expanduser().resolve()
    mbtiles_dir = Path(args.mbtiles_dir).expanduser().resolve()
    tile_dir = Path(args.tile_dir).expanduser().resolve()
    missing = [
        mbtiles_dir / filename
        for layer, filename in MBTILES_FILES.items()
        if not (mbtiles_dir / filename).is_file()
        and not (tile_dir / layer).is_dir()
    ]
    if missing:
        joined = "\n  ".join(str(path) for path in missing)
        raise SystemExit(
            "Missing MBTiles files:\n  "
            + joined
            + "\nDownload them into "
            + str(mbtiles_dir)
        )
    if not docs.is_dir():
        raise SystemExit(f"Docs directory not found: {docs}")
    if args.extract or args.extract_only:
        extract_all(mbtiles_dir, tile_dir, args.force_extract)
    if args.extract_only:
        print(f"Extracted tile directory: {tile_dir}", flush=True)
        return

    mimetypes.add_type("application/manifest+json", ".webmanifest")
    handler = lambda *a, **kw: NavAidMbtilesHandler(*a, directory=str(docs), **kw)
    NavAidMbtilesHandler.mbtiles_dir = mbtiles_dir
    NavAidMbtilesHandler.tile_dir = tile_dir
    server = ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}/?localTiles=1"
    print(f"Serving NavAid from {docs}", flush=True)
    print(f"Serving MBTiles from {mbtiles_dir}", flush=True)
    print(f"Serving extracted tiles from {tile_dir}", flush=True)
    print(f"Open {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
