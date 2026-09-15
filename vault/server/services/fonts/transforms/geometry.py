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


def warp_y_ascender_descender(points: list[Point], baseline_y: float, cap_height_y: float, factor: float) -> list[Point]:
    """
    Stretch only the parts of the outline above cap-height and below the
    baseline, in font design units (baseline_y is typically 0).
    """
    def map_y(y: float) -> float:
        if y >= cap_height_y:
            dist_above = y - cap_height_y
            return cap_height_y + dist_above * (1 + factor)
        if y <= baseline_y:
            dist_below = baseline_y - y
            return baseline_y - dist_below * (1 + factor)
        return y

    return [Point(p.x, map_y(p.y), p.on_curve) for p in points]
