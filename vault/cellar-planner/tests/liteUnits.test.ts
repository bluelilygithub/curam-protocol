import { describe, expect, it } from 'vitest';
import { describeLength, formatLength, parseLength, rangeText } from '../src/lite/units';

describe('typing a length', () => {
  it('metres: decimals with a point or a comma', () => {
    expect(parseLength('2.75', 'm')).toBe(2750);
    expect(parseLength('2,75', 'm')).toBe(2750);
    expect(parseLength(' 1.565 ', 'm')).toBe(1565);
    expect(parseLength('3', 'm')).toBe(3000);
    expect(parseLength('.9', 'm')).toBe(900);
  });
  it('millimetres: whole numbers, with or without grouping', () => {
    expect(parseLength('2750', 'mm')).toBe(2750);
    expect(parseLength('2,750', 'mm')).toBe(2750);
    expect(parseLength('2 750', 'mm')).toBe(2750);
  });
  it('feet and inches in the ways people write them', () => {
    for (const t of ["9'", '9 ft', '9ft', '9 feet', '9 foot']) expect(parseLength(t, 'ft'), t).toBe(2743);
    expect(parseLength("9' 6\"", 'ft')).toBe(2896);
    expect(parseLength("9'6", 'ft')).toBe(2896);
    expect(parseLength('9 ft 6 in', 'ft')).toBe(2896);
    expect(parseLength('9ft6in', 'ft')).toBe(2896);
    expect(parseLength('9 ft 6 inches', 'ft')).toBe(2896);
    expect(parseLength('6 in', 'ft')).toBe(152);
    expect(parseLength('9.5', 'ft')).toBe(2896); // a bare number in feet mode is feet
    expect(parseLength('9”', 'ft')).toBe(229); // curly quote
  });
  it('a unit written out beats the unit selected', () => {
    expect(parseLength('2.75m', 'ft')).toBe(2750);
    expect(parseLength('275cm', 'm')).toBe(2750);
    expect(parseLength('2750mm', 'm')).toBe(2750);
    expect(parseLength('2.75 metres', 'mm')).toBe(2750);
    expect(parseLength("9'", 'm')).toBe(2743);
  });
  it('rejects what is not a length', () => {
    for (const t of ['', '   ', 'abc', '2..5', '2.5.1', '-3', 'ft', "'", '9 6', '1e3', '2 x 3']) expect(parseLength(t, 'm'), JSON.stringify(t)).toBeNull();
  });
});

describe('showing a length', () => {
  it('in boxes', () => {
    expect(formatLength(2750, 'mm')).toBe('2750');
    expect(formatLength(2750, 'm')).toBe('2.75');
    expect(formatLength(1565, 'm')).toBe('1.565');
    expect(formatLength(3000, 'm')).toBe('3');
    expect(formatLength(2743, 'ft')).toBe("9'");
    expect(formatLength(2896, 'ft')).toBe('9\' 6"');
  });
  it('in sentences', () => {
    expect(describeLength(970, 'm')).toBe('0.97 m');
    expect(describeLength(970, 'mm')).toBe('970 mm');
    expect(describeLength(970, 'ft')).toBe('3 ft 2 in');
    expect(describeLength(2743, 'ft')).toBe('9 ft');
    expect(describeLength(200, 'ft')).toBe('8 in');
  });
  it('as a range', () => {
    expect(rangeText([1000, 8000], 'm')).toBe('Between 1 m and 8 m.');
    expect(rangeText([1000, 8000], 'mm')).toBe('Between 1000 mm and 8000 mm.');
    expect(rangeText([1000, 8000], 'ft')).toBe('Between 3 ft 3 in and 26 ft 3 in.');
  });
  it('what is shown can be typed back to within half an inch (feet) or a millimetre (metres, millimetres)', () => {
    for (let mm = 1000; mm <= 8000; mm += 37) {
      expect(parseLength(formatLength(mm, 'mm'), 'mm')).toBe(mm);
      expect(parseLength(formatLength(mm, 'm'), 'm')).toBe(mm);
      expect(Math.abs((parseLength(formatLength(mm, 'ft'), 'ft') as number) - mm)).toBeLessThanOrEqual(13);
    }
  });
});
