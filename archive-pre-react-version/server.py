#!/usr/bin/env python3
# server.py
# Simple static file server that also accepts POST /logs and
# prints them to the terminal
import json
from http.server import SimpleHTTPRequestHandler, HTTPServer
from datetime import datetime
import os


class LogRequestHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/logs':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length > 0 else b''
            try:
                entry = json.loads(body.decode('utf-8'))
            except Exception:
                entry = {'raw': body.decode('utf-8', errors='replace')}

            ts = entry.get('ts') if isinstance(entry, dict) else None
            level = entry.get('level') if isinstance(entry, dict) else 'info'
            message = entry.get('message') if isinstance(entry, dict) else ''
            meta = entry.get('meta') if isinstance(entry, dict) else None

            line = f"[{ts or datetime.utcnow().isoformat()}] [{level}] {message} {json.dumps(meta) if meta else ''}\n"
            # Print to the terminal (this is where you'll see logs)
            print(line, end='')

            # Append to file
            try:
                with open('client-logs.txt', 'a', encoding='utf-8') as f:
                    f.write(line)
            except Exception as e:
                print(f"[server] Failed to append log file: {e}")

            self.send_response(200)
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    # Keep default GET behavior (serve files)


if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', 8000))
    server_address = ('', PORT)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    httpd = HTTPServer(server_address, LogRequestHandler)
    print
    (f"Serving HTTP on 0.0.0.0 port {PORT} (http://localhost:{PORT}/) ...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        httpd.server_close()
