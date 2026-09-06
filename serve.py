"""Static server for fieldplay3d that forbids caching, so edits show on plain reload.
    python fieldplay3d/serve.py 5225
"""
import sys, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, fmt, *args):
        if '404' in (args[1] if len(args) > 1 else ''): super().log_message(fmt, *args)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5225
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
