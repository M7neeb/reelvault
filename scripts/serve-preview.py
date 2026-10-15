"""Serve the exported web bundle the way expo-router expects.

`npx expo export -p web` writes one .html per route (index.html, preview.html),
and expo-router matches on the URL *path*. So requesting /preview must serve
preview.html, while requesting /index.html is routed as the literal path
"/index.html" and 404s. This maps extension-less paths onto their .html file so
the browser behaves like the real router.

This is what makes the design loop work: export, serve, screenshot at phone
dimensions, look at it, fix it.

Usage: python scripts/serve-preview.py [port]     (default 8791)
"""

import http.server
import os
import sys
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        if path != '/' and not os.path.splitext(path)[1]:
            candidate = os.path.join(ROOT, path.lstrip('/') + '.html')
            if os.path.exists(candidate):
                self.path = path + '.html'
                if parsed.query:
                    self.path += '?' + parsed.query
        super().do_GET()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    os.chdir(ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as httpd:
        print(f'serving {ROOT} on http://127.0.0.1:{PORT}')
        httpd.serve_forever()
