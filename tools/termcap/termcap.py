#!/usr/bin/env python3
"""Drive a program in a pseudo-terminal and photograph its screen.

    termcap.py [--cols 80 --rows 24] [--out DIR] [--cwd DIR] SCRIPT -- COMMAND...

SCRIPT is a text file of steps, one per line (# comments):

    wait 1.5                    sleep
    wait-for <regex> [timeout]  until the screen text matches (default 20 s)
    type <text>                 send text as typed (no newline)
    key <name> [count]          enter esc tab up down left right backspace
                                space ctrl-c ctrl-d ctrl-x ...
    mouse-move <col> <row>      SGR 1006 motion, 1-based cells
    mouse-click <col> <row> [left|right|middle]
    shot <name>                 render the screen to OUT/<name>.png (+ .txt)
    if <regex> :: <step> [;; <step>...]   run the steps only if the screen matches
    dump                        print the screen text to stdout

The DEC private modes the program turned on (mouse tracking, alt screen...)
are printed at the end.
"""

import argparse
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import fcntl
import time

import pyte
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- rendering

THEME_BG = (0x1E, 0x1E, 0x1E)
THEME_FG = (0xD4, 0xD4, 0xD4)
NAMED = {
    'black': (0x00, 0x00, 0x00), 'red': (0xC9, 0x1B, 0x00), 'green': (0x00, 0xC2, 0x00),
    'brown': (0xC7, 0xC4, 0x00), 'yellow': (0xC7, 0xC4, 0x00), 'blue': (0x02, 0x25, 0xC7),
    'magenta': (0xC9, 0x30, 0xC7), 'cyan': (0x00, 0xC5, 0xC7), 'white': (0xC7, 0xC7, 0xC7),
    'brightblack': (0x67, 0x67, 0x67), 'brightred': (0xFF, 0x6D, 0x67),
    'brightgreen': (0x5F, 0xF9, 0x67), 'brightbrown': (0xFE, 0xFB, 0x67),
    'brightyellow': (0xFE, 0xFB, 0x67), 'brightblue': (0x68, 0x71, 0xFF),
    'brightmagenta': (0xFF, 0x76, 0xFF), 'brightcyan': (0x5F, 0xFD, 0xFF),
    'brightwhite': (0xFF, 0xFE, 0xFE),
}

CELL_W, CELL_H, FONT_PX = 8, 17, 13
FONT_PATH = '/System/Library/Fonts/Menlo.ttc'
_fonts = {}


def font(bold):
    if bold not in _fonts:
        try:
            _fonts[bold] = ImageFont.truetype(FONT_PATH, FONT_PX, index=1 if bold else 0)
        except OSError:
            _fonts[bold] = ImageFont.load_default()
    return _fonts[bold]


def color(value, default, bold=False):
    if value in (None, 'default'):
        return default
    if re.fullmatch(r'[0-9a-fA-F]{6}', value):
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    name = value.lower()
    if bold and not name.startswith('bright') and 'bright' + name in NAMED:
        name = 'bright' + name
    return NAMED.get(name, default)


_cmaps = {}


def _cmap(path, index=0):
    key = (path, index)
    if key not in _cmaps:
        try:
            from fontTools.ttLib import TTFont, TTCollection
            if path.endswith('.ttc'):
                tt = TTCollection(path).fonts[index]
            else:
                tt = TTFont(path)
            _cmaps[key] = set(tt.getBestCmap() or {})
        except Exception:
            _cmaps[key] = set()
    return _cmaps[key]


FALLBACKS = [
    '/System/Library/Fonts/Apple Symbols.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/STIXTwoMath.otf',
]
_fb_fonts = {}


def glyph_font(ch, bold):
    cp = ord(ch[0])
    if cp in _cmap(FONT_PATH, 1 if bold else 0):
        return font(bold)
    for path in FALLBACKS:
        if os.path.exists(path) and cp in _cmap(path):
            if path not in _fb_fonts:
                _fb_fonts[path] = ImageFont.truetype(path, FONT_PX)
            return _fb_fonts[path]
    return font(bold)


# Block elements drawn as exact rectangles: (x0, y0, x1, y1) as cell fractions.
BLOCKS = {
    '█': [(0, 0, 1, 1)], '▀': [(0, 0, 1, .5)], '▄': [(0, .5, 1, 1)],
    '▌': [(0, 0, .5, 1)], '▐': [(.5, 0, 1, 1)],
    '▖': [(0, .5, .5, 1)], '▗': [(.5, .5, 1, 1)], '▘': [(0, 0, .5, .5)], '▝': [(.5, 0, 1, .5)],
    '▙': [(0, 0, .5, 1), (.5, .5, 1, 1)], '▟': [(.5, 0, 1, 1), (0, .5, .5, 1)],
    '▛': [(0, 0, 1, .5), (0, .5, .5, 1)], '▜': [(0, 0, 1, .5), (.5, .5, 1, 1)],
    '▚': [(0, 0, .5, .5), (.5, .5, 1, 1)], '▞': [(.5, 0, 1, .5), (0, .5, .5, 1)],
    '▁': [(0, 7 / 8, 1, 1)], '▂': [(0, 6 / 8, 1, 1)], '▃': [(0, 5 / 8, 1, 1)],
    '▅': [(0, 3 / 8, 1, 1)], '▆': [(0, 2 / 8, 1, 1)], '▇': [(0, 1 / 8, 1, 1)],
}


def render(screen, path, scale=1):
    w, h = screen.columns * CELL_W, screen.lines * CELL_H
    img = Image.new('RGB', (w, h), THEME_BG)
    d = ImageDraw.Draw(img)
    for y in range(screen.lines):
        row = screen.buffer[y]
        for x in range(screen.columns):
            ch = row[x]
            fg = color(ch.fg, THEME_FG, ch.bold)
            bg = color(ch.bg, THEME_BG)
            if ch.reverse:
                fg, bg = bg, fg
            x0, y0 = x * CELL_W, y * CELL_H
            if bg != THEME_BG:
                d.rectangle([x0, y0, x0 + CELL_W - 1, y0 + CELL_H - 1], fill=bg)
            data = ch.data
            if not data or data == ' ':
                continue
            if data in BLOCKS:
                for fx0, fy0, fx1, fy1 in BLOCKS[data]:
                    d.rectangle([x0 + round(fx0 * CELL_W), y0 + round(fy0 * CELL_H),
                                 x0 + round(fx1 * CELL_W) - 1, y0 + round(fy1 * CELL_H) - 1], fill=fg)
                continue
            if data == '░':
                for py in range(0, CELL_H, 2):
                    for px in range(py % 4 // 2, CELL_W, 2):
                        d.point((x0 + px, y0 + py), fill=fg)
                continue
            f = glyph_font(data, ch.bold)
            if ch.italics:
                pass  # Menlo italic lives in another face; plain is fine for review
            d.text((x0, y0 + 1), data, font=f, fill=fg)
            if ch.underscore:
                d.line([x0, y0 + CELL_H - 2, x0 + CELL_W - 1, y0 + CELL_H - 2], fill=fg)
    if not screen.cursor.hidden:
        cx, cy = screen.cursor.x * CELL_W, screen.cursor.y * CELL_H
        d.rectangle([cx, cy, cx + CELL_W - 1, cy + CELL_H - 1], outline=(0xFF, 0xCC, 0x00))
    if scale != 1:
        img = img.resize((w * scale, h * scale), Image.NEAREST)
    img.save(path)


def screen_text(screen):
    return '\n'.join(screen.display)


# ---------------------------------------------------------------- the pty

KEYS = {
    'enter': b'\r', 'esc': b'\x1b', 'tab': b'\t', 'backspace': b'\x7f', 'space': b' ',
    'up': b'\x1b[A', 'down': b'\x1b[B', 'right': b'\x1b[C', 'left': b'\x1b[D',
    'shift-tab': b'\x1b[Z', 'home': b'\x1b[H', 'end': b'\x1b[F',
    'pageup': b'\x1b[5~', 'pagedown': b'\x1b[6~', 'delete': b'\x1b[3~',
}

MODES = {1000: 'mouse-click(1000)', 1002: 'mouse-drag(1002)', 1003: 'mouse-any-motion(1003)',
         1006: 'mouse-sgr(1006)', 1049: 'alt-screen(1049)', 1004: 'focus-events(1004)',
         2004: 'bracketed-paste(2004)', 25: 'cursor-visible(25)', 2026: 'sync-output(2026)'}


class Session:
    def __init__(self, argv, cols, rows, cwd, raw_path=None):
        self.raw = open(raw_path, 'wb') if raw_path else None
        self.screen = pyte.Screen(cols, rows)
        self.stream = pyte.ByteStream(self.screen)
        self.modes_on, self.modes_off = {}, {}
        self.raw_tail = b''
        self.nbytes = 0
        self.writes = 0
        env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor',
                   LANG='en_US.UTF-8', LC_ALL='en_US.UTF-8', COLUMNS=str(cols), LINES=str(rows))
        env.pop('TERM_PROGRAM', None)
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            if cwd:
                os.chdir(cwd)
            os.execvpe(argv[0], argv, env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        os.kill(self.pid, signal.SIGWINCH)
        self.alive = True

    def pump(self, seconds):
        end = time.time() + seconds
        while True:
            left = end - time.time()
            if left <= 0:
                return
            r, _, _ = select.select([self.fd], [], [], min(left, 0.05))
            if not r:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                self.alive = False
                return
            if not data:
                self.alive = False
                return
            self.nbytes += len(data)
            self.writes += 1
            if self.raw:
                self.raw.write(data)
            self._scan_modes(data)
            self._answer_queries(data)
            self.stream.feed(sanitize(data))

    def _scan_modes(self, data):
        buf = self.raw_tail + data
        for m in re.finditer(rb'\x1b\[\?([\d;]+)([hl])', buf):
            for n in m.group(1).split(b';'):
                if not n:
                    continue
                n = int(n)
                now = time.time()
                if m.group(2) == b'h':
                    self.modes_on[n] = now
                else:
                    self.modes_off[n] = now
        self.raw_tail = buf[-32:]

    def _answer_queries(self, data):
        # Programs probe the terminal; answer like a plain xterm so they don't stall.
        if b'\x1b[?6n' in data:
            self.write(f'\x1b[?{self.screen.cursor.y + 1};{self.screen.cursor.x + 1}R'.encode())
        if b'\x1b[6n' in data:
            self.write(f'\x1b[{self.screen.cursor.y + 1};{self.screen.cursor.x + 1}R'.encode())
        if b'\x1b[c' in data or b'\x1b[0c' in data:
            self.write(b'\x1b[?62;22c')
        if b'\x1b[>c' in data or b'\x1b[>0c' in data:
            self.write(b'\x1b[>1;10;0c')
        for m in re.finditer(rb'\x1b\]1([01]);\?(\x07|\x1b\\)', data):
            rgb = THEME_FG if m.group(1) == b'0' else THEME_BG
            hexes = '/'.join(f'{c:02x}{c:02x}' for c in rgb)
            self.write(f'\x1b]1{m.group(1).decode()};rgb:{hexes}\x1b\\'.encode())

    def write(self, data):
        os.write(self.fd, data)

    def text(self):
        return screen_text(self.screen)

    def mode_report(self):
        out = []
        for n in sorted(set(self.modes_on) | set(self.modes_off)):
            on, off = self.modes_on.get(n), self.modes_off.get(n)
            state = 'ON' if on and (not off or on >= off) else 'off'
            out.append(f'  ?{n} {MODES.get(n, "")}: {state} (set {"yes" if on else "no"}, reset {"yes" if off else "no"})')
        return '\n'.join(out)

    def close(self):
        # Exit the way a person would. Killing Claude Code mid-start makes it
        # fall back to its classic renderer on the next launch (no mouse).
        for _ in range(2):
            if not self.alive:
                break
            try:
                self.write(b'\x03')
            except OSError:
                break
            self.pump(0.6)
        end = time.time() + 5
        while time.time() < end:
            done, _ = os.waitpid(self.pid, os.WNOHANG)
            if done:
                return
            self.pump(0.2)
        try:
            os.kill(self.pid, signal.SIGTERM)
            time.sleep(1)
            os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


# Sequences pyte does not know and would misread (printing their final byte,
# crashing, or `CSI > 4 m` modifyOtherKeys read as underline): kitty keyboard
# protocol, XTVERSION, DECXCPR, XTMODKEYS, colon SGRs.
_DROP = re.compile(rb'\x1b\[[<>=?][0-9;]*[um]|\x1b\[>[0-9;]*q|\x1b\[\?[0-9;]*n|\x1b\[[0-9;]*:[0-9:;]*m')


def sanitize(data):
    return _DROP.sub(b'', data)


def key_bytes(name):
    name = name.lower()
    if name in KEYS:
        return KEYS[name]
    m = re.fullmatch(r'ctrl-([a-z])', name)
    if m:
        return bytes([ord(m.group(1)) - 96])
    raise SystemExit(f'unknown key {name!r}')


def mouse(button, col, row, release=False):
    return f'\x1b[<{button};{col};{row}{"m" if release else "M"}'.encode()


def run(script_path, argv, cols, rows, out, cwd, scale):
    os.makedirs(out, exist_ok=True)
    s = Session(argv, cols, rows, cwd, os.path.join(out, 'raw.bin'))
    lines = open(script_path).read().splitlines()
    try:
        for lineno, raw in enumerate(lines, 1):
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            op, _, arg = line.partition(' ')
            print(f'[{lineno}] {line}', file=sys.stderr)
            if op == 'if':
                s.pump(0.2)
                cond, _, step = arg.partition(' :: ')
                if not re.search(cond, s.text()):
                    continue
                for sub in step.split(' ;; '):
                    op, _, arg = sub.strip().partition(' ')
                    step_once(s, op, arg, lineno, out, scale)
                continue
            step_once(s, op, arg, lineno, out, scale)
            if not s.alive:
                print('  program exited', file=sys.stderr)
                break
    finally:
        s.close()
        print('DEC private modes seen:\n' + (s.mode_report() or '  none'))


VARS = {}
FAILURES = []
LAST_BLANKED = [0]


def coords(arg):
    # Numbers, or $name / $name+n / $name-n from a find-color step.
    vals = []
    for tok in arg.split()[:2]:
        m = re.fullmatch(r'\$(\w+)([+-]\d+)?', tok)
        vals.append(VARS[m.group(1)] + int(m.group(2) or 0) if m else int(tok))
    return vals


def step_once(s, op, arg, lineno, out, scale):
    if op == 'wait':
        s.pump(float(arg))
    elif op == 'wait-for':
        m = re.fullmatch(r'(.*?)(?:\s+(\d+(?:\.\d+)?))?', arg)
        pattern, timeout = m.group(1), float(m.group(2) or 20)
        end = time.time() + timeout
        while not re.search(pattern, s.text()):
            if time.time() > end:
                print(f'  wait-for timed out: {pattern!r}', file=sys.stderr)
                render(s.screen, os.path.join(out, f'timeout-{lineno}.png'), scale)
                break
            s.pump(0.1)
            if not s.alive:
                return
    elif op == 'type':
        s.write(arg.encode())
        s.pump(0.15)
    elif op == 'key':
        name, _, count = arg.partition(' ')
        for _ in range(int(count or 1)):
            s.write(key_bytes(name))
            s.pump(0.15)
    elif op in ('expect-color', 'expect-no-color'):
        # `expect-color #rrggbb ROWS a-b [label]`: some cell in rows a..b
        # (0-based, inclusive; negative counts from the bottom) has that
        # background (or foreground). expect-no-color: no cell does.
        parts = arg.split()
        want = parts[0].lower().lstrip('#')
        lo, hi = [int(v) for v in re.fullmatch(r'(-?\d+)-(-?\d+)', parts[2]).groups()] if len(parts) > 2 and parts[1] == 'rows' else (0, s.screen.lines - 1)
        lo, hi = (lo % s.screen.lines, hi % s.screen.lines)
        label = ' '.join(parts[3:]) if len(parts) > 3 else f'{want} in rows {lo}-{hi}'
        found = any(str(c.bg).lower() == want or str(c.fg).lower() == want
                    for y in range(lo, hi + 1) for c in (s.screen.buffer[y][x] for x in range(s.screen.columns)))
        ok = found if op == 'expect-color' else not found
        print(f'  {"PASS" if ok else "FAIL"} {op} {label}', file=sys.stderr)
        if not ok:
            FAILURES.append(f'line {lineno}: {op} {label}')
            render(s.screen, os.path.join(out, f'fail-{lineno}.png'), scale)
    elif op == 'expect-blanked':
        # `expect-blanked <=N`: the last measure blanked at most N text cells.
        limit = int(arg.strip().lstrip('<='))
        ok = LAST_BLANKED[0] <= limit
        print(f'  {"PASS" if ok else "FAIL"} expect-blanked {LAST_BLANKED[0]} <= {limit}', file=sys.stderr)
        if not ok:
            FAILURES.append(f'line {lineno}: blanked {LAST_BLANKED[0]} > {limit}')
    elif op == 'find-color':
        # `find-color #rrggbb`: the centre of the cells whose background is
        # that colour, as $cx $cy (1-based, like the mouse steps).
        want = arg.strip().lower().lstrip('#')
        hits = [(x, y) for y in range(s.screen.lines) for x in range(s.screen.columns)
                if str(s.screen.buffer[y][x].bg).lower() == want]
        if not hits:
            print(f'  find-color: no cell with background {want}', file=sys.stderr)
            VARS.update(cx=1, cy=1)
        else:
            VARS['cx'] = round(sum(h[0] for h in hits) / len(hits)) + 1
            VARS['cy'] = round(sum(h[1] for h in hits) / len(hits)) + 1
            print(f'  find-color {want}: ${{cx}}={VARS["cx"]} ${{cy}}={VARS["cy"]} ({len(hits)} cells)', file=sys.stderr)
    elif op in ('mouse-down', 'mouse-up', 'mouse-drag'):
        col, row = coords(arg)
        if op == 'mouse-down':
            s.write(mouse(0, col, row))
        elif op == 'mouse-drag':
            s.write(mouse(32, col, row))
        else:
            s.write(mouse(0, col, row, release=True))
        s.pump(0.08)
    elif op == 'wheel':
        # `wheel up|down COUNT COL ROW`: mouse-wheel notches (SGR 64 / 65).
        parts = arg.split()
        button = 64 if parts[0] == 'up' else 65
        col, row = coords(' '.join(parts[2:4]))
        for _ in range(int(parts[1])):
            s.write(mouse(button, col, row))
            s.pump(0.05)
    elif op == 'mouse-move':
        col, row = coords(arg)
        s.write(mouse(35, col, row))
        s.pump(0.1)
    elif op == 'mouse-click':
        parts = arg.split()
        col, row = coords(arg)
        btn = {'left': 0, 'middle': 1, 'right': 2}[parts[2] if len(parts) > 2 else 'left']
        s.write(mouse(btn, col, row))
        s.pump(0.05)
        s.write(mouse(btn, col, row, release=True))
        s.pump(0.1)
    elif op == 'shot':
        s.pump(0.1)
        png = os.path.join(out, f'{arg}.png')
        render(s.screen, png, scale)
        with open(os.path.join(out, f'{arg}.txt'), 'w') as fh:
            fh.write(s.text())
        print(f'  -> {png}', file=sys.stderr)
    elif op == 'measure':
        # How much the app repaints while we watch: bytes, writes and which rows.
        seconds = float(arg or 3)
        b0, w0 = s.nbytes, s.writes
        touched = {}
        end = time.time() + seconds
        blanked = 0
        def snap():
            return [[(c.data, c.bg) for c in (s.screen.buffer[y][x] for x in range(s.screen.columns))] for y in range(s.screen.lines)]
        before = snap()
        while time.time() < end:
            s.screen.dirty.clear()
            s.pump(0.02)
            for row in s.screen.dirty:
                touched[row] = touched.get(row, 0) + 1
            after = snap()
            # A flash: a cell that held text turns into a bare blank.
            for y in range(len(after)):
                for x in range(len(after[y])):
                    # Text, not the pet's own block glyphs leaving empty space.
                    if before[y][x][0].strip() and before[y][x][0] not in '▀▄█▌▐▖▗▘▝' and after[y][x] == (' ', 'default'):
                        blanked += 1
            before = after
        nb, nw = s.nbytes - b0, s.writes - w0
        rows = ' '.join(f'{r}:{n}' for r, n in sorted(touched.items()))
        line = f'measure {seconds:g}s: {nb / seconds:,.0f} B/s, {nw / seconds:.1f} writes/s, blanked cells {blanked}, rows touched {{{rows}}}'
        print('  ' + line, file=sys.stderr)
        LAST_BLANKED[0] = blanked
        with open(os.path.join(out, 'measure.log'), 'a') as fh:
            fh.write(line + '\n')
    elif op == 'film':
        # `film NAME COUNT INTERVAL`: a burst of frames side by side in NAME.png.
        name, count, interval = arg.split()[0], int(arg.split()[1]), float(arg.split()[2])
        frames = []
        for i in range(count):
            path = os.path.join(out, f'{name}-{i:02d}.png')
            render(s.screen, path, scale)
            frames.append(path)
            s.pump(interval)
        from PIL import Image
        ims = [Image.open(f) for f in frames]
        w, h = ims[0].size
        cols = min(4, len(ims))
        sheet = Image.new('RGB', (w * cols + 6 * (cols - 1), h * ((len(ims) + cols - 1) // cols) + 6 * ((len(ims) - 1) // cols)), (120, 0, 120))
        for i, im in enumerate(ims):
            sheet.paste(im, ((i % cols) * (w + 6), (i // cols) * (h + 6)))
        sheet.save(os.path.join(out, f'{name}.png'))
        for f in frames:
            os.remove(f)
        print(f'  -> {name}.png ({count} frames)', file=sys.stderr)
    elif op == 'dump':
        print(s.text())
    else:
        raise SystemExit(f'line {lineno}: unknown step {op!r}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('script')
    p.add_argument('command', nargs=argparse.REMAINDER)
    p.add_argument('--cols', type=int, default=80)
    p.add_argument('--rows', type=int, default=24)
    p.add_argument('--out', default='out/termcap')
    p.add_argument('--cwd')
    p.add_argument('--scale', type=int, default=1)
    a = p.parse_args()
    argv = a.command[1:] if a.command[:1] == ['--'] else a.command
    if not argv:
        p.error('give the command after --')
    run(a.script, argv, a.cols, a.rows, a.out, a.cwd, a.scale)
    if FAILURES:
        print(f'\n{len(FAILURES)} expectation(s) failed:', file=sys.stderr)
        for f in FAILURES:
            print(f'  {f}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
