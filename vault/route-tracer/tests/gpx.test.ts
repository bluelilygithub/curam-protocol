// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { lineKm, toGpx, totalKm, type Line } from '../src/geo';
import { fitToLimit, MAX_STROKES, parseGpx } from '../src/gpx';

const gpx = (body: string, attrs = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" ${attrs}>${body}</gpx>`;
const pts = (tag: string, list: [number, number][]) => list.map(([lat, lon]) => `<${tag} lat="${lat}" lon="${lon}"><ele>10</ele><time>2026-01-01T00:00:00Z</time></${tag}>`).join('');

describe('parseGpx', () => {
  it('reads a track: name, notes, one stroke per segment, as [lng, lat]', () => {
    const r = parseGpx(gpx(`<metadata><name>Meta</name></metadata><trk><name>Broadwater loop</name><desc>Flat and fast</desc>
      <trkseg>${pts('trkpt', [[-27.9, 153.4], [-27.91, 153.41]])}</trkseg><trkseg>${pts('trkpt', [[-27.95, 153.45], [-27.96, 153.46]])}</trkseg></trk>`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gpx.name).toBe('Broadwater loop');
    expect(r.gpx.notes).toBe('Flat and fast');
    expect(r.gpx.lines).toEqual([[[153.4, -27.9], [153.41, -27.91]], [[153.45, -27.95], [153.46, -27.96]]]);
  });
  it('reads a route (rtept) and falls back to the metadata name', () => {
    const r = parseGpx(gpx(`<metadata><name>Course</name></metadata><rte>${pts('rtept', [[1, 2], [3, 4]])}</rte>`));
    expect(r.ok && r.gpx.lines).toEqual([[[2, 1], [4, 3]]]);
    expect(r.ok && r.gpx.name).toBe('Course');
  });
  it('ignores waypoints and extensions, and works with other namespaces (Garmin heart rate)', () => {
    const r = parseGpx(gpx(`<wpt lat="9" lon="9"><name>Cafe</name></wpt><trk><trkseg>
      <trkpt lat="1" lon="2"><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="3" lon="4"/></trkseg></trk>`, 'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"'));
    expect(r.ok && r.gpx.lines).toEqual([[[2, 1], [4, 3]]]);
    expect(r.ok && r.gpx.waypoints).toBe(1);
  });
  it('works without a namespace and with the name in CDATA or with entities', () => {
    const r = parseGpx('<gpx version="1.1"><trk><name><![CDATA[Up & over]]></name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>');
    expect(r.ok && r.gpx.name).toBe('Up & over');
    const e = parseGpx('<gpx><trk><name>A &amp; B &lt;1&gt;</name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>');
    expect(e.ok && e.gpx.name).toBe('A & B <1>');
  });
  it('leaves out points with bad coordinates and says how many', () => {
    const r = parseGpx(gpx(`<trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="abc" lon="2"/><trkpt lat="95" lon="2"/><trkpt lat="3" lon="181"/><trkpt lat="5" lon="6"/></trkseg></trk>`));
    expect(r.ok && r.gpx.lines).toEqual([[[2, 1], [6, 5]]]);
    expect(r.ok && r.gpx.skipped).toBe(3);
  });
  it('drops repeated points (a stop is not distance) and rounds to 6 decimals', () => {
    const r = parseGpx(gpx(`<trk><trkseg><trkpt lat="1.1234567891" lon="2"/><trkpt lat="1.1234567891" lon="2"/><trkpt lat="1.1234567895" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>`));
    expect(r.ok && r.gpx.lines).toEqual([[[2, 1.123457], [4, 3]]]);
  });
  it('drops segments with fewer than two points', () => {
    const r = parseGpx(gpx(`<trk><trkseg><trkpt lat="1" lon="2"/></trkseg><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>`));
    expect(r.ok && r.gpx.lines).toHaveLength(1);
  });
  it('says plainly when there is nothing to import', () => {
    const onlyWpt = parseGpx(gpx('<wpt lat="1" lon="2"/>'));
    expect(!onlyWpt.ok && onlyWpt.error).toMatch(/waypoints/);
    const empty = parseGpx(gpx(''));
    expect(!empty.ok && empty.error).toMatch(/at least two points/);
  });
  it('rejects things that are not GPX', () => {
    for (const bad of ['', 'hello', '<html><body/></html>', '<gpx><trk>', '{"a":1}', '<kml><Placemark/></kml>']) {
      const r = parseGpx(bad);
      expect(r.ok, bad).toBe(false);
    }
  });
  it('rejects a file with more strokes than a track can hold', () => {
    const seg = `<trkseg>${pts('trkpt', [[1, 2], [3, 4]])}</trkseg>`;
    const r = parseGpx(gpx(`<trk>${seg.repeat(MAX_STROKES + 1)}</trk>`));
    expect(!r.ok && r.error).toMatch(/segments/);
  });
  it('does not fetch or expand external entities', () => {
    const r = parseGpx('<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx><trk><name>&x;</name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>');
    expect(!r.ok || !(r.gpx.name ?? '').includes('root:')).toBe(true);
  });
  it('round-trips what Route Tracer exports', () => {
    const lines: Line[] = [[[153.028, -27.468], [153.1, -27.6], [153.43, -28.002]], [[10.5, 20.25], [10.6, 20.3]]];
    const r = parseGpx(toGpx('A & B', 'some "notes"', lines));
    expect(r.ok && r.gpx.lines).toEqual(lines);
    expect(r.ok && r.gpx.name).toBe('A & B');
    expect(r.ok && r.gpx.notes).toBe('some "notes"');
  });
});

describe('fitToLimit', () => {
  const wiggle = (n: number): Line => Array.from({ length: n }, (_, i) => [153 + i * 0.00002, -27 + Math.sin(i / 40) * 0.01 + (i % 2) * 0.0000015] as [number, number]);

  it('leaves a normal track alone', () => {
    const l = [wiggle(500)];
    const r = fitToLimit(l);
    expect(r.lines).toBe(l);
    expect(r.before).toBe(500);
    expect(r.after).toBe(500);
  });
  it('simplifies a 60,000-point recording to fit 20,000 points, keeping the ends and the distance', () => {
    const l = [wiggle(60000)];
    const r = fitToLimit(l);
    expect(r.before).toBe(60000);
    expect(r.after).toBeLessThanOrEqual(20000);
    expect(r.lines[0][0]).toEqual(l[0][0]);
    expect(r.lines[0].at(-1)).toEqual(l[0].at(-1));
    expect(Math.abs(totalKm(r.lines) - totalKm(l)) / totalKm(l)).toBeLessThan(0.01);
    expect(lineKm(r.lines[0])).toBeGreaterThan(0);
  });
  it('handles several long strokes together', () => {
    const r = fitToLimit([wiggle(15000), wiggle(15000)]);
    expect(r.after).toBeLessThanOrEqual(20000);
    expect(r.lines).toHaveLength(2);
  });
});
