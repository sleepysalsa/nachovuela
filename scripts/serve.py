#!/usr/bin/env python3
"""Servidor local para probar la app (uso interno de desarrollo)."""
import os
import http.server
import socketserver

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PORT = 8642


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"NachoVuela local en http://localhost:{PORT}")
    httpd.serve_forever()
