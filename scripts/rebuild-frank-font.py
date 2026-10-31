"""Put Frank's edited 6/9 outlines back into the original Roboto Condensed variable font,
synthesising gvar deltas for them so they follow the wght axis like every other glyph.

usage: python rebuild.py orig.woff2 edited.woff2 out.woff2
"""
import sys, math
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib.models import supportScalar
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen

ORIG, EDITED, OUT = sys.argv[1:4]
# original glyph name -> edited glyph name (pnum glyphs were renamed by FontForge)
REPLACE = {'six': 'six', 'nine': 'nine', 'glyph00224': 'six.pnum', 'glyph00226': 'nine.pnum'}

O = TTFont(ORIG)
E = TTFont(EDITED)
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
egs = E.getGlyphSet()
for n in REPLACE.values():  # decompose composites (FontForge made six.pnum a reference)
    rec = DecomposingRecordingPen(egs); egs[n].draw(rec)
    pen = TTGlyphPen(None); rec.replay(pen); E['glyf'][n] = pen.glyph()
removeOverlaps(E, glyphNames=list(REPLACE.values()), removeHinting=True)


class FlattenPen(BasePen):
    def __init__(self, gs):
        super().__init__(gs); self.segs = []; self.cur = None; self.start = None
    def _moveTo(self, p): self.cur = self.start = p
    def _lineTo(self, p): self.segs.append((self.cur, p)); self.cur = p
    def _qCurveToOne(self, c, p):
        a = self.cur
        prev = a
        for i in range(1, 17):
            t = i / 16
            q = ((1-t)**2*a[0] + 2*(1-t)*t*c[0] + t*t*p[0], (1-t)**2*a[1] + 2*(1-t)*t*c[1] + t*t*p[1])
            self.segs.append((prev, q)); prev = q
        self.cur = p
    def _curveToOne(self, c1, c2, p): raise NotImplementedError
    def _closePath(self):
        if self.cur != self.start: self.segs.append((self.cur, self.start))


def crossings(segs, axis, v):
    """Coordinates along the other axis where the outline crosses the line axis=v."""
    o = 1 - axis; out = []
    for a, b in segs:
        if (a[axis] - v) * (b[axis] - v) < 0:
            t = (v - a[axis]) / (b[axis] - a[axis])
            out.append(a[o] + t * (b[o] - a[o]))
    return sorted(out)


def stems(gs):
    """Vertical-stem width and horizontal-stroke thickness of 'zero'."""
    p = FlattenPen(gs); gs['zero'].draw(p)
    b = BoundsPen(gs); gs['zero'].draw(b); x0, y0, x1, y1 = b.bounds
    xs = crossings(p.segs, 1, (y0 + y1) / 2)
    ys = crossings(p.segs, 0, (x0 + x1) / 2)
    return xs[1] - xs[0], ys[1] - ys[0]


def bounds(gs, name):
    b = BoundsPen(gs); gs[name].draw(b); return b.bounds


def embolden(pts, ends, sx, sy):
    """FreeType-style FT_Outline_EmboldenXY: moves every point along its corner bisector so each
    edge shifts outward by sx/2 (x) and sy/2 (y). Keeps point count/order, so it is gvar-compatible."""
    area = 0; start = 0
    for end in ends:
        c = pts[start:end+1]
        area += sum(c[i][0]*c[(i+1) % len(c)][1] - c[(i+1) % len(c)][0]*c[i][1] for i in range(len(c)))
        start = end + 1
    sgn = 1 if area < 0 else -1  # TrueType outer contours are clockwise (negative area)
    out = []; start = 0
    for end in ends:
        c = pts[start:end+1]; n = len(c)
        for i in range(n):
            p = c[i]
            j = (i - 1) % n
            while c[j] == p and j != i: j = (j - 1) % n
            k = (i + 1) % n
            while c[k] == p and k != i: k = (k + 1) % n
            din = (p[0]-c[j][0], p[1]-c[j][1]); dout = (c[k][0]-p[0], c[k][1]-p[1])
            li = math.hypot(*din) or 1; lo = math.hypot(*dout) or 1
            nin = (-din[1]/li*sgn, din[0]/li*sgn); nout = (-dout[1]/lo*sgn, dout[0]/lo*sgn)
            d = max(1 + nin[0]*nout[0] + nin[1]*nout[1], 0.25)
            out.append((p[0] + (nin[0]+nout[0])/d*sx/2, p[1] + (nin[1]+nout[1])/d*sy/2))
        start = end + 1
    return out


gs0 = O.getGlyphSet(location={'wght': 0}, normalized=True)
stem0 = stems(gs0)
gvar = O['gvar'].variations
eglyf = E['glyf']

for oname, ename in REPLACE.items():
    g = eglyf[ename]
    assert g.numberOfContours > 0, ename
    coords, ends, _ = g.getCoordinates(eglyf)
    D = [tuple(p) for p in coords]
    eb = (min(p[0] for p in D), min(p[1] for p in D), max(p[0] for p in D), max(p[1] for p in D))
    ob0 = bounds(gs0, oname)

    tvs = gvar[oname]
    peaks = [tv.axes['wght'][1] for tv in tvs]
    targets = []
    for L in peaks:
        gsL = O.getGlyphSet(location={'wght': L}, normalized=True)
        sL = stems(gsL)
        emb = embolden(D, ends, sL[0] - stem0[0], sL[1] - stem0[1])
        obL = bounds(gsL, oname)
        # target bbox: edited bbox moved the way the original glyph's bbox moves at this weight
        tb = [eb[i] + obL[i] - ob0[i] for i in range(4)]
        mb = (min(p[0] for p in emb), min(p[1] for p in emb), max(p[0] for p in emb), max(p[1] for p in emb))
        fit = [((p[0]-mb[0])/(mb[2]-mb[0])*(tb[2]-tb[0]) + tb[0],
                (p[1]-mb[1])/(mb[3]-mb[1])*(tb[3]-tb[1]) + tb[1]) for p in emb]
        targets.append(np.array(fit) - np.array(D))

    # solve for per-tuple deltas so the summed variation hits each target at its peak
    M = np.array([[supportScalar({'wght': L}, tv.axes) for tv in tvs] for L in peaks])
    T = np.stack(targets)  # (peaks, points, 2)
    deltas = np.linalg.solve(M, T.reshape(len(peaks), -1)).reshape(T.shape)

    new = []
    for tv, d in zip(tvs, deltas):
        phantom = [c if c is not None else (0, 0) for c in tv.coordinates[-4:]]
        new.append(TupleVariation(dict(tv.axes), [(round(x), round(y)) for x, y in d] + phantom))
    gvar[oname] = new

    O['glyf'][oname] = g
    g.recalcBounds(eglyf)
    O['hmtx'][oname] = (E['hmtx'][ename][0], g.xMin)
    print(f'{oname} <- {ename}: {len(D)} pts, peaks {peaks}')

O.flavor = 'woff2'
O.save(OUT)
print('saved', OUT)
