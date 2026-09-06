#!/usr/bin/env python3
"""shot.py URL OUT.png [--width W] [--height H] [--wait MS] [--browser chrome|edge|PATH] [--text]
Renders a WebGPU page in headless Chromium with a real GPU adapter and saves a PNG.
Drives the browser over the DevTools protocol (stdlib websocket) so rAF frames run in real time
before the capture. Exit code 0 only when the PNG was written. --text also prints body innerText."""
import argparse, base64, json, os, secrets, shutil, socket, struct, subprocess, sys, tempfile, time, urllib.request
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception: pass

CANDIDATES = {
    'chrome': [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
               os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
               r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'],
    'edge':   [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
               r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'],
}

def find_browser(which):
    if which not in CANDIDATES:
        return which if os.path.isfile(which) else None
    order = ['chrome', 'edge'] if which == 'chrome' else ['edge', 'chrome']
    for k in order:
        for p in CANDIDATES[k]:
            if os.path.isfile(p): return p
    return None

class WS:  # minimal RFC 6455 client, text frames only
    def __init__(self, url, timeout=30):
        host, _, rest = url[5:].partition('/')
        h, _, port = host.partition(':')
        self.s = socket.create_connection((h, int(port or 80)), timeout=timeout)
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        self.s.sendall((f'GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        buf = b''
        while b'\r\n\r\n' not in buf: buf += self.s.recv(4096)
        if b' 101 ' not in buf.split(b'\r\n', 1)[0]: raise RuntimeError('websocket handshake failed: ' + buf[:120].decode('latin1'))
        self.rest = buf.split(b'\r\n\r\n', 1)[1]
        self.id = 0
    def _read(self, n):
        while len(self.rest) < n:
            chunk = self.s.recv(max(65536, n - len(self.rest)))
            if not chunk: raise ConnectionError('websocket closed')
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out
    def send(self, text):
        data = text.encode(); n = len(data); mask = secrets.token_bytes(4)
        if n < 126: head = bytes([0x81, 0x80 | n])
        elif n < 65536: head = bytes([0x81, 0x80 | 126]) + struct.pack('>H', n)
        else: head = bytes([0x81, 0x80 | 127]) + struct.pack('>Q', n)
        self.s.sendall(head + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(data)))
    def recv(self):
        msg = b''
        while True:
            b0, b1 = self._read(2); fin, op, n = b0 & 0x80, b0 & 0x0F, b1 & 0x7F
            if n == 126: n = struct.unpack('>H', self._read(2))[0]
            elif n == 127: n = struct.unpack('>Q', self._read(8))[0]
            key = self._read(4) if b1 & 0x80 else None
            payload = self._read(n)
            if key: payload = bytes(b ^ key[i & 3] for i, b in enumerate(payload))
            if op == 8: raise ConnectionError('websocket closed by peer')
            if op == 9: self.s.sendall(bytes([0x8A, 0x80]) + b'\0\0\0\0'); continue
            if op == 10: continue
            msg += payload
            if fin: return json.loads(msg.decode())
    def call(self, method, deadline, **params):
        self.id += 1; mid = self.id
        self.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            m = self.recv()
            if m.get('id') == mid:
                if 'error' in m: raise RuntimeError(f'{method}: {m["error"]}')
                return m.get('result', {})
            if time.time() > deadline: raise TimeoutError(method)
    def wait_event(self, name, deadline):
        base = self.s.gettimeout()
        try:
            while time.time() < deadline:
                self.s.settimeout(max(0.05, deadline - time.time()))
                try: m = self.recv()
                except socket.timeout: return None
                if m.get('method') == name: return m.get('params')
            return None
        finally: self.s.settimeout(base)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('url'); ap.add_argument('out')
    ap.add_argument('--width', type=int, default=1280); ap.add_argument('--height', type=int, default=720)
    ap.add_argument('--wait', type=int, default=3000, help='ms of real time to let the page run after load')
    ap.add_argument('--browser', default='chrome', help='chrome | edge | path to a Chromium exe')
    ap.add_argument('--timeout', type=int, default=60, help='overall seconds before giving up')
    ap.add_argument('--text', action='store_true', help='also print document.body.innerText to stdout')
    ap.add_argument('--pre', help='JS statements to run right after load, before the wait (use return for a value; await allowed)')
    ap.add_argument('--eval', help='JS statements to run after the wait, before the capture (use return for a value; await allowed)')
    a = ap.parse_args()
    exe = find_browser(a.browser)
    if not exe: sys.exit('no browser found for ' + a.browser)
    out = os.path.abspath(a.out); os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    profile = tempfile.mkdtemp(prefix='fp3d_prof_')
    args = [exe, '--headless=new', '--remote-debugging-port=0', f'--user-data-dir={profile}',
            f'--window-size={a.width},{a.height}', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
            '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding', '--mute-audio', 'about:blank']
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + a.timeout; ok = False; ws = None
    try:
        portfile = os.path.join(profile, 'DevToolsActivePort')
        while not os.path.exists(portfile) or os.path.getsize(portfile) == 0:
            if proc.poll() is not None: raise RuntimeError(f'browser exited early (code {proc.returncode})')
            if time.time() > deadline: raise TimeoutError('DevToolsActivePort never appeared')
            time.sleep(0.05)
        port = int(open(portfile).read().split()[0])
        for _ in range(100):  # the HTTP endpoint comes up a beat after the file
            try:
                targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=2)); break
            except Exception: time.sleep(0.1)
        page = next(t for t in targets if t.get('type') == 'page')
        ws = WS(page['webSocketDebuggerUrl'], timeout=a.timeout)
        ws.call('Page.enable', deadline)
        ws.call('Emulation.setDeviceMetricsOverride', deadline, width=a.width, height=a.height, deviceScaleFactor=1, mobile=False)
        nav = ws.call('Page.navigate', deadline, url=a.url)
        if nav.get('errorText'): raise RuntimeError(f'navigation failed: {nav["errorText"]}')
        ws.wait_event('Page.loadEventFired', deadline)
        def run(js):
            r = ws.call('Runtime.evaluate', deadline, expression='(async () => { ' + js + ' })()', returnByValue=True, awaitPromise=True)
            if 'exceptionDetails' in r: print('JS ERROR:', r['exceptionDetails'].get('exception', {}).get('description', r['exceptionDetails'].get('text')))
            else: print('=>', json.dumps(r.get('result', {}).get('value')))
        if a.pre:
            time.sleep(0.6); run(a.pre)
        time.sleep(a.wait / 1000)
        if a.eval: run(a.eval)
        if a.text:
            r = ws.call('Runtime.evaluate', deadline, expression='document.body ? document.body.innerText : ""', returnByValue=True)
            print(r.get('result', {}).get('value', ''))
        shot = ws.call('Page.captureScreenshot', deadline, format='png', captureBeyondViewport=False)
        png = base64.b64decode(shot['data'])
        if not png.startswith(b'\x89PNG'): raise RuntimeError('capture did not return a PNG')
        with open(out, 'wb') as f: f.write(png)
        ok = True
        print(f'wrote {out} ({len(png)} bytes, {a.width}x{a.height}, {os.path.basename(exe)})')
    except Exception as e:
        print('ERROR:', e, file=sys.stderr)
    finally:
        try:
            if ws: ws.call('Browser.close', time.time() + 2)
        except Exception: pass
        try: proc.terminate(); proc.wait(3)
        except Exception:
            try: proc.kill(); proc.wait(3)
            except Exception: pass
        shutil.rmtree(profile, ignore_errors=True)
    sys.exit(0 if ok and os.path.isfile(out) else 1)

if __name__ == '__main__': main()
