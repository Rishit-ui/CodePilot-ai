"""Restore the CVEfixes SQLite dump without materializing uncompressed SQL.

The v1.0.8 dump contains raw C0 control bytes inside quoted source strings.
On Windows, piping those bytes through sqlite3.exe's text-mode stdin can stop at
0x1a.  This loader decodes the gzip strictly and sends one complete statement at
a time through Python's length-aware SQLite API.  It never skips a statement.
"""

from __future__ import annotations

import argparse
import gzip
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import time


CHECK_INTERVAL = 512 * 1024 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--temp-dir", type=Path, required=True)
    parser.add_argument("--min-free-gib", type=float, default=85.0)
    return parser.parse_args()


def free_bytes(path: Path) -> int:
    return shutil.disk_usage(path.anchor or path).free


def main() -> int:
    args = parse_args()
    if not args.dump.is_file():
        raise FileNotFoundError(args.dump)
    if args.database.exists():
        raise FileExistsError(f"refusing to overwrite {args.database}")
    args.database.parent.mkdir(parents=True, exist_ok=True)
    args.temp_dir.mkdir(parents=True, exist_ok=True)
    os.environ["TEMP"] = str(args.temp_dir)
    os.environ["TMP"] = str(args.temp_dir)

    minimum = int(args.min_free_gib * 1024**3)
    if free_bytes(args.database) < minimum:
        raise RuntimeError("storage safety floor is not available before restore")

    started = time.time()
    decompressed = 0
    next_check = CHECK_INTERVAL
    statement_start_line = 1
    parts: list[str] = []
    statements = 0
    connection = sqlite3.connect(args.database, isolation_level=None)
    try:
        connection.execute("PRAGMA temp_store=FILE")
        with gzip.open(args.dump, "rb") as stream:
            for line_number, raw_line in enumerate(stream, start=1):
                decompressed += len(raw_line)
                try:
                    parts.append(raw_line.decode("utf-8", errors="strict"))
                except UnicodeDecodeError as exc:
                    raise RuntimeError(
                        f"invalid UTF-8 at dump line {line_number}: {exc}"
                    ) from exc

                candidate = "".join(parts)
                if sqlite3.complete_statement(candidate):
                    try:
                        connection.execute(candidate)
                    except sqlite3.Error as exc:
                        raise RuntimeError(
                            "SQLite rejected statement beginning at line "
                            f"{statement_start_line} and ending at line {line_number}: {exc}"
                        ) from exc
                    statements += 1
                    parts.clear()
                    statement_start_line = line_number + 1

                if decompressed >= next_check:
                    remaining = free_bytes(args.database)
                    db_size = args.database.stat().st_size if args.database.exists() else 0
                    print(
                        "PROGRESS "
                        f"decompressed_bytes={decompressed} "
                        f"database_bytes={db_size} "
                        f"free_bytes={remaining} statements={statements}",
                        flush=True,
                    )
                    if remaining < minimum:
                        raise RuntimeError("storage safety floor reached during restore")
                    next_check += CHECK_INTERVAL

        if "".join(parts).strip():
            raise RuntimeError(
                f"incomplete trailing SQL statement beginning at line {statement_start_line}"
            )
    finally:
        connection.close()

    print(
        "RESTORE_COMPLETE "
        f"decompressed_bytes={decompressed} statements={statements} "
        f"database_bytes={args.database.stat().st_size} "
        f"elapsed_seconds={time.time() - started:.3f}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # Preserve a concise, truthful failure for automation logs.
        print(f"RESTORE_FAILED {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        raise
