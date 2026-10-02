#!/usr/bin/env python3
"""Generates the SetLists app icons (pure Python, no dependencies)."""
import math, struct, zlib, os

def note_mask(x, y):
    """Setlist glyph: three rows, each a dot (the number) and a line (the song)."""
    for cy in (0.36, 0.5, 0.64):
        if math.hypot(x - 0.30, y - cy) <= 0.032:
            return True
        if 0.39 <= x <= 0.72 and abs(y - cy) <= 0.016:
            return True
    return False

def pixel(px, py, size, ss=3):
    r = g = b = 0.0
    for sy in range(ss):
        for sx in range(ss):
            x = (px + (sx + 0.5) / ss) / size
            y = (py + (sy + 0.5) / ss) / size
            # subway signage: black field, flat blue route bullet, white note
            cr, cg, cb = 0, 0, 0
            if math.hypot(x - 0.5, y - 0.5) <= 0.42:
                cr, cg, cb = 0, 57, 166  # MTA blue
            if note_mask(x, y):
                cr, cg, cb = 255, 255, 255
            r += cr; g += cg; b += cb
    n = ss * ss
    return int(r / n), int(g / n), int(b / n)

def png(path, size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            row += bytes(pixel(px, py, size))
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)

if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), '..', 'icons')
    for s in (180, 192, 512):
        png(os.path.join(out, f'icon-{s}.png'), s)
        print('wrote', s)
