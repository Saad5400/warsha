#!/usr/bin/env python3
"""Static server with HTTP Range support, for the Warsha Java spike.

`python3 -m http.server` ignores the Range header and answers 200 with the whole
body. CheerpJ's /app/ filesystem needs ranges to read pieces of a jar and logs
"HTTP server does not support the 'Range' header. CheerpJ cannot run." — it then
falls back to refetching all 18 MB of tools.jar, which makes every compile look
several seconds slower than it really is. Real static hosts (S3, Cloudflare
Pages, Netlify, GitHub Pages) all support ranges, so this just matches prod.

Usage: python3 serve.py [port] [bind]
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        m = re.fullmatch(r"bytes=(\d*)-(\d*)", rng.strip())
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return super().send_head()

        size = os.path.getsize(path)
        start_s, end_s = m.group(1), m.group(2)
        if start_s == "":                      # suffix range: bytes=-500
            length = min(int(end_s or 0), size)
            start, end = size - length, size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        end = min(end, size - 1)

        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return _Slice(f, end - start + 1)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        # Keep the spike honest across reloads: never serve a stale index/js.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class _Slice:
    """File-like wrapper that stops after n bytes, for copyfile()."""

    def __init__(self, f, n):
        self.f, self.n = f, n

    def read(self, amt=-1):
        if self.n <= 0:
            return b""
        if amt is None or amt < 0:
            amt = self.n
        data = self.f.read(min(amt, self.n))
        self.n -= len(data)
        return data

    def close(self):
        self.f.close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    bind = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"serving {os.getcwd()} on http://{bind}:{port} (with Range support)")
    ThreadingHTTPServer((bind, port), RangeHandler).serve_forever()
