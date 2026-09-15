"""
Shared point-list geometry for glyph contour transforms.

Everything here operates on plain (x, y, on_curve) point lists per contour
— no fontTools types leak in — so the transform functions in this package
stay unit-testable without a real font. `glyph_edit.py` is the only module
that converts to/from actual fontTools glyf coordinates.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Point:
    x: float
    y: float
    on_curve: bool


def signed_area(points: list[Point]) -> float:
    """
    Shoelace formula over the point sequence (off-curve points included as
    ordinary vertices — adequate for determining winding *sign*, which is
    all contour classification needs; it does not need true curve area).

    This is the actual winding-direction test — TrueType's nonzero fill
    rule assigns opposite signs to outer contours and the counters (holes)
    inside them. That's real hierarchy analysis, not a size heuristic.
    """
    if len(points) < 3:
        return 0.0
    total = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i].x, points[i].y
        x2, y2 = points[(i + 1) % n].x, points[(i + 1) % n].y
        total += x1 * y2 - x2 * y1
    return total / 2.0


def centroid(points: list[Point]) -> tuple[float, float]:
    if not points:
        return (0.0, 0.0)
    cx = sum(p.x for p in points) / len(points)
    cy = sum(p.y for p in points) / len(points)
    return (cx, cy)


def bounds(points: list[Point]) -> tuple[float, float, float, float]:
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def vertex_normal(points: list[Point], i: int) -> tuple[float, float]:
    """
    Outward-ish normal at vertex i, averaged from the two edges meeting
    there (prev->i and i->next), for a closed contour. Sign convention:
    for a clockwise contour (in a y-up, x-right space) this points outward;
    for a counter-clockwise contour it points inward. `offset_contour`
    below corrects for this using the contour's own winding sign, so
    positive `stem thickness` always thickens regardless of a given
    contour's orientation.
    """
    n = len(points)
    prev_p = points[(i - 1) % n]
    cur_p = points[i]
    next_p = points[(i + 1) % n]

    # Edge directions
    e1x, e1y = cur_p.x - prev_p.x, cur_p.y - prev_p.y
    e2x, e2y = next_p.x - cur_p.x, next_p.y - cur_p.y

    # Perpendiculars (rotate -90°: (x,y) -> (y,-x)) of each edge, averaged.
    n1 = (e1y, -e1x)
    n2 = (e2y, -e2x)
    nx, ny = n1[0] + n2[0], n1[1] + n2[1]
    length = math.hypot(nx, ny)
    if length < 1e-9:
        return (0.0, 0.0)
    return (nx / length, ny / length)


def offset_contour(points: list[Point], delta: float) -> list[Point]:
    """
    Move every point along its local outward normal by `delta` font units.
    Positive delta thickens (grows outward), negative thins (shrinks
    inward) — a real, reversible outline offset, unlike a rendered stroke.

    Orientation-corrected: normals are flipped so that positive `delta`
    always means "grow this contour's filled area" regardless of whether
    the contour is clockwise or counter-clockwise, so an outer contour and
    a counter both thicken their shared stem the same visual direction.
    """
    area = signed_area(points)
    if area == 0:
        return points
    orientation = 1.0 if area > 0 else -1.0

    out = []
    n = len(points)
    for i in range(n):
        nx, ny = vertex_normal(points, i)
        # `vertex_normal` points outward for a positive-area (CW-in-shoelace
        # convention) contour; flip for the opposite winding so `delta`'s
        # sign means the same thing for every contour.
        signed_nx, signed_ny = nx * orientation, ny * orientation
        p = points[i]
        out.append(Point(p.x + signed_nx * delta, p.y + signed_ny * delta, p.on_curve))
    return out


def scale_around(points: list[Point], cx: float, cy: float, factor: float) -> list[Point]:
    return [Point(cx + (p.x - cx) * factor, cy + (p.y - cy) * factor, p.on_curve) for p in points]


def scale_x(points: list[Point], factor: float, origin_x: float = 0.0) -> list[Point]:
    return [Point(origin_x + (p.x - origin_x) * factor, p.y, p.on_curve) for p in points]


def _smooth_ramp(d: float, factor: float, margin: float, max_depth: float | None = None) -> float:
    """
    Extra Y displacement for a point `d` units past a threshold (always
    d >= 0), ramping smoothly from 0 rather than jumping straight into
    `factor * d`. Matches `factor * d` slope-for-slope once d exceeds
    `margin`, but starts with zero slope at d=0 so the transform's
    derivative is continuous across the threshold, not just its value.

    Why this matters: a hard "no change below this line, factor*distance
    above it" step has a KINK in slope exactly at the threshold — for a
    single simple outline that's invisible, but a glyph built from
    multiple overlapping contours whose geometry straddles that exact
    line (e.g. Roboto's 'g': its descender tail is a separate contour
    from the bowl, and they visually join right around the baseline) can
    have that kink pull the two contours apart, since each contour's own
    points land on either side of the threshold differently. A smooth
    (C1-continuous) ramp keeps points that were close together near the
    threshold close together after the warp too.

    `max_depth`, if given, additionally caps how far past the threshold a
    point's OWN distance counts before computing the ramp (the point still
    moves, at whatever `d` it actually has, but the DISPLACEMENT amount
    saturates). Smoothing the seam alone isn't sufficient for a glyph
    whose two overlapping contours sit at very different depths past the
    threshold — e.g. 'g's descender tail can reach ~400+ units below
    baseline while its bowl barely crosses it (~20 units): even a smooth
    ramp still stretches the deep tail by an order of magnitude more than
    the shallow bowl edge, which visually separates them just as badly as
    the original kink did. Capping the effective depth bounds how far any
    single point's push can diverge from its neighbors', at the cost of
    very deep excursions (like that tail) stretching proportionally less
    than a naive linear rule would give them.
    """
    if margin <= 0:
        return factor * d
    if d <= 0:
        return 0.0
    effective_d = min(d, max_depth) if max_depth is not None else d
    if effective_d >= margin:
        return factor * (effective_d - margin / 2)
    return factor * (effective_d * effective_d) / (2 * margin)


def warp_y_ascender_descender(points: list[Point], baseline_y: float, cap_height_y: float, factor: float, blend_margin: float = 0.0, max_depth: float | None = None) -> list[Point]:
    """
    Stretch only the parts of the outline above cap-height and below the
    baseline, in font design units (baseline_y is typically 0). The
    transition into the stretched region is smoothed over `blend_margin`
    units (see `_smooth_ramp`) rather than a hard cutoff, so multi-contour
    glyphs whose geometry straddles the threshold don't visually separate.
    """
    def map_y(y: float) -> float:
        # y + smooth_ramp(...): the point's own position, PLUS a smoothed
        # extra displacement — not a replacement for its position. (An
        # earlier version of this fix mistakenly returned just
        # cap_height_y + smooth_ramp(...), dropping the identity term
        # entirely, which could move a point BACKWARD past its own
        # original position for a small overshoot — caught by
        # test_extend_still_has_a_real_visible_effect_after_smoothing.)
        if y >= cap_height_y:
            return y + _smooth_ramp(y - cap_height_y, factor, blend_margin, max_depth)
        if y <= baseline_y:
            return y - _smooth_ramp(baseline_y - y, factor, blend_margin, max_depth)
        return y

    return [Point(p.x, map_y(p.y), p.on_curve) for p in points]
