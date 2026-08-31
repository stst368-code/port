#!/usr/bin/env python3
"""Serve the site locally the way GitHub Pages serves it.

Use this rather than `python -m http.server`. The built-in server does not
implement HTTP Range requests, so audio cannot be seeked: dragging the scrubber
silently snaps back to the start and it looks like a player bug. Pages supports
Range, so does this.

    python tools/serve.py           # http://localhost:8000
    python tools/serve.py 4000
"""

from __future__ import annotations

import os
import re
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

RANGE = re.compile(r"bytes=(\d*)-(\d*)")


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):  # noqa: N802 - matching the stdlib's name
        header = self.headers.get("Range")
        if not header:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        match = RANGE.match(header)
        if not match:
            return super().send_head()

        try:
            handle = open(path, "rb")
        except OSError:
            self.send_error(404)
            return None

        size = os.fstat(handle.fileno()).st_size
        first, last = match.groups()

        if first:
            start = int(first)
            end = int(last) if last else size - 1
        else:
            # A suffix range: the last N bytes.
            start = max(0, size - int(last))
            end = size - 1

        if start >= size:
            handle.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        end = min(end, size - 1)
        handle.seek(start)

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

        self.range_remaining = end - start + 1
        return handle

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "range_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        self.range_remaining = None
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def end_headers(self):
        if "Accept-Ranges" not in self._headers_buffer_names():
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def _headers_buffer_names(self) -> set[str]:
        return {
            line.decode("latin-1").split(":")[0]
            for line in getattr(self, "_headers_buffer", [])
            if b":" in line
        }


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = Path(__file__).resolve().parent.parent
    handler = partial(RangeHandler, directory=str(root))
    server = HTTPServer(("", port), handler)
    print(f"Serving {root} at http://localhost:{port}  (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
