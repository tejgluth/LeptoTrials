"""Read public archive members by HTTP range, without downloading unrelated results.

Pass an archive URL obtained from the authenticated AACT download page, never a
cookie or account password. This helper does not authenticate or bypass access.
"""

import argparse
import hashlib
import io
import json
import os
import re
import uuid
import zipfile
from collections import OrderedDict
from pathlib import Path
from urllib.parse import urlsplit

import httpx


class RemoteArchive(io.RawIOBase):
    """Seekable, bounded, HTTPS-only byte reader suitable for stdlib ZipFile."""

    def __init__(self, url: str, block_size=4 * 1024 * 1024):
        super().__init__()
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.query:
            raise ValueError("An explicit HTTPS public archive URL is required")
        self.url = url
        self.client = httpx.Client(timeout=60, follow_redirects=False)
        self.position = 0
        self.block_size = block_size
        self.cache = OrderedDict()
        self.transferred = 0
        self.requests = 0
        with self.client.stream("GET", url, headers={"Range": "bytes=0-0"}) as response:
            if response.status_code != 206:
                raise ValueError(
                    "Public file does not support range requests; use the downloaded ZIP"
                )
            match = re.fullmatch(r"bytes 0-0/(\d+)", response.headers.get("content-range", ""))
            if not match:
                raise ValueError("Missing archive size in Content-Range")
            self.size = int(match[1])
            if self.size < 22 or len(response.read()) != 1:
                raise ValueError("Invalid archive range response")
        self.transferred, self.requests = 1, 1

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        base = (
            0
            if whence == 0
            else self.position
            if whence == 1
            else self.size
            if whence == 2
            else None
        )
        if base is None or base + offset < 0:
            raise ValueError("Invalid archive seek")
        self.position = base + offset
        return self.position

    def read(self, size=-1):
        remaining = max(0, self.size - self.position)
        size = remaining if size < 0 else min(size, remaining)
        chunks = []
        while size:
            index = self.position // self.block_size
            if index not in self.cache:
                start = index * self.block_size
                end = min(start + self.block_size, self.size) - 1
                with self.client.stream(
                    "GET", self.url, headers={"Range": f"bytes={start}-{end}"}
                ) as response:
                    if (
                        response.status_code != 206
                        or response.headers.get("content-range")
                        != f"bytes {start}-{end}/{self.size}"
                    ):
                        raise ValueError("Archive range changed or was incomplete")
                    data = response.read()
                if len(data) != end - start + 1:
                    raise ValueError("Short archive range read")
                self.requests += 1
                self.transferred += len(data)
                self.cache[index] = data
                if len(self.cache) > 4:
                    self.cache.popitem(last=False)
            self.cache.move_to_end(index)
            offset = self.position % self.block_size
            part = self.cache[index][offset : offset + size]
            chunks.append(part)
            self.position += len(part)
            size -= len(part)
        return b"".join(chunks)

    def close(self):
        if getattr(self, "client", None):
            self.client.close()
        super().close()


def verify_local_origin(path: Path, archive: zipfile.ZipFile, url: str) -> dict:
    """Check public object size/ZIP directory, then fingerprint the local archive.

    This is corruption/provenance checking, not a remote cryptographic SHA claim.
    Selected members still undergo CRC verification while being read below.
    """

    def directory(file):
        return [
            (e.filename, e.CRC, e.file_size, e.compress_size, e.compress_type, e.header_offset)
            for e in file.infolist()
        ]

    with RemoteArchive(url) as source:
        with zipfile.ZipFile(source) as public:
            if path.stat().st_size != source.size or directory(archive) != directory(public):
                raise ValueError("Local ZIP does not match the public archive size/directory")
        transferred = source.transferred
    with path.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    return {
        "path": str(path.resolve()),
        "sha256": checksum,
        "bytes": path.stat().st_size,
        "public_origin": url,
        "origin_check": "Matching object size and complete ZIP central directory; not remote SHA",
        "network_bytes": transferred,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", help="Downloaded ZIP path or authorized public HTTPS object URL")
    parser.add_argument("--table", action="append", default=[])
    parser.add_argument(
        "--verify-public-origin",
        help="For a local ZIP: verify size/ZIP directory against this authorized public URL",
    )
    parser.add_argument(
        "--download-protocol-tables",
        type=Path,
        help="Save only the 12 required protocol tables, excluding results/contacts",
    )
    args = parser.parse_args()
    if args.verify_public_origin and args.archive.startswith("https://"):
        raise ValueError("Public-origin verification requires a local archive")
    remote = RemoteArchive(args.archive) if args.archive.startswith("https://") else None
    try:
        with zipfile.ZipFile(remote or args.archive) as archive:
            local_origin = (
                verify_local_origin(Path(args.archive), archive, args.verify_public_origin)
                if args.verify_public_origin
                else None
            )
            if args.download_protocol_tables:
                from leptotrials_harness.aact import TABLES
                from leptotrials_harness.logging_utils import write_json

                target = args.download_protocol_tables
                names = {f"{table}.txt" for table in TABLES}
                selected = [
                    entry for entry in archive.infolist() if Path(entry.filename).name in names
                ]
                if {Path(entry.filename).name for entry in selected} != names or len(
                    selected
                ) != len(names):
                    raise ValueError("Archive lacks a unique full set of required protocol tables")
                target.mkdir(parents=True, exist_ok=True)
                if any((target / name).exists() for name in names):
                    raise FileExistsError(
                        "Choose a fresh table directory; existing tables are immutable"
                    )
                hashes = {}
                for entry in selected:
                    name = Path(entry.filename).name
                    temporary = target / f"{name}.{uuid.uuid4().hex}.part"
                    checksum = hashlib.sha256()
                    with archive.open(entry) as source, temporary.open("xb") as destination:
                        while chunk := source.read(1024 * 1024):
                            checksum.update(chunk)
                            destination.write(chunk)
                        destination.flush()
                        os.fsync(destination.fileno())
                    # Link is create-only. A partial/failed read can never masquerade
                    # as a completed source table; ZipFile verifies the member CRC.
                    os.link(temporary, target / name)
                    temporary.unlink()
                    hashes[name] = checksum.hexdigest()
                    print(
                        json.dumps({"completed_table": name, "bytes": entry.file_size}), flush=True
                    )
                write_json(
                    target / "aact-transfer.json",
                    {
                        "complete": True,
                        "source": args.verify_public_origin or args.archive,
                        "local_archive": local_origin,
                        "table_sha256": hashes,
                        "selected_tables": sorted(names),
                        "network_bytes": remote.transferred
                        if remote
                        else local_origin["network_bytes"]
                        if local_origin
                        else 0,
                        "note": "Protocol tables only; selected ZIP-member CRCs verified. "
                        "No remote archive SHA claim; local ZIP SHA recorded when origin checked. "
                        "No account cookies or credentials stored.",
                    },
                )
                return
            rows = []
            for entry in archive.infolist():
                if args.table and entry.filename.rsplit("/", 1)[-1] not in args.table:
                    continue
                row = {
                    "name": entry.filename,
                    "bytes": entry.file_size,
                    "compressed_bytes": entry.compress_size,
                    "crc": entry.CRC,
                }
                if args.table:
                    with archive.open(entry) as stream:
                        row["header"] = stream.readline().decode("utf-8-sig").rstrip()
                rows.append(row)
        print(
            json.dumps(
                {"members": rows, "network_bytes": remote.transferred if remote else 0}, indent=2
            )
        )
    finally:
        if remote:
            remote.close()


if __name__ == "__main__":
    main()
