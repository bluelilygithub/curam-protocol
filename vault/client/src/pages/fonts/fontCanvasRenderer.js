import { applyProportionalWidth, applyExtendAscDesc, applyCounterWidth, stemStrokeWidthPx } from './fontGlyphTransforms';
import { classKerningAdjustment } from './fontKerningClasses';

/** Best-effort cap-height in font units; not every font ships OS/2.sCapHeight. */
function getCapHeightUnits(font) {
  const sCapHeight = font?.tables?.os2?.sCapHeight;
  if (sCapHeight && sCapHeight > 0) return sCapHeight;
  return Math.round((font.ascender || font.unitsPerEm * 0.8) * 0.7);
}

/**
 * Draw `text` on `ctx` starting at (x, y-baseline), applying the live
 * transform + kerning overlay. Returns { affectedPairIndices, totalWidth }
 * so the caller can render a traceability list/highlight alongside canvas.
 *
 * All transforms here are visual-preview only (see fontGlyphTransforms.js)
 * — nothing here writes to or mutates the loaded font object.
 */
export function drawProof(ctx, font, text, x, y, fontSize, opts) {
  const {
    transforms = { stemThickness: 0, proportionalWidth: 100, extendAscDesc: 0, counterWidth: 0 },
    kerning = { enabledGroupIds: [], balance: 0, advancedPairs: {} },
    color = '#1A1A1A',
    highlightColor = 'rgba(204,120,92,0.22)',
  } = opts || {};

  const scale = (1 / font.unitsPerEm) * fontSize;
  const baselineY = y;
  const capHeightLineY = y - getCapHeightUnits(font) * scale;

  ctx.fillStyle = color;
  const strokeWidth = stemStrokeWidthPx(transforms.stemThickness, fontSize);
  if (strokeWidth > 0) {
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
  }

  let penX = x;
  const affectedPairs = []; // { index, leftChar, rightChar, x, width, source: 'class'|'advanced' }
  const glyphs = Array.from(text).map((ch) => font.charToGlyph(ch));

  glyphs.forEach((glyph, i) => {
    // Kerning vs. the previous glyph, applied as extra space before this one.
    if (i > 0) {
      const prevGlyph = glyphs[i - 1];
      const leftChar = text[i - 1];
      const rightChar = text[i];
      const pair = leftChar + rightChar;

      const fontKernUnits = font.getKerningValue(prevGlyph, glyph) || 0;
      const classAdjUnits = classKerningAdjustment(
        leftChar, rightChar, kerning.enabledGroupIds, kerning.balance, font.unitsPerEm
      );
      const advancedPxOverride = kerning.advancedPairs?.[pair];
      const advancedUnits = typeof advancedPxOverride === 'number' ? advancedPxOverride / scale : 0;

      const totalKernUnits = fontKernUnits + classAdjUnits + advancedUnits;
      const kernPx = totalKernUnits * scale * (transforms.proportionalWidth / 100);
      penX += kernPx;

      if (classAdjUnits !== 0 || advancedUnits !== 0) {
        affectedPairs.push({
          index: i - 1,
          leftChar,
          rightChar,
          x: penX - glyph.advanceWidth * scale, // approximate box start
          source: advancedUnits !== 0 ? 'advanced' : 'class',
        });
      }
    }

    const glyphOriginX = penX;
    let path = glyph.getPath(penX, baselineY, fontSize).commands;
    path = applyProportionalWidth(path, glyphOriginX, transforms.proportionalWidth);
    path = applyExtendAscDesc(path, baselineY, capHeightLineY, transforms.extendAscDesc);
    path = applyCounterWidth(path, transforms.counterWidth);

    ctx.beginPath();
    for (const cmd of path) {
      if (cmd.type === 'M') ctx.moveTo(cmd.x, cmd.y);
      else if (cmd.type === 'L') ctx.lineTo(cmd.x, cmd.y);
      else if (cmd.type === 'C') ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
      else if (cmd.type === 'Q') ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
      else if (cmd.type === 'Z') ctx.closePath();
    }
    ctx.fill();
    if (strokeWidth > 0) ctx.stroke();

    const advanceUnits = glyph.advanceWidth || 0;
    penX += advanceUnits * scale * (transforms.proportionalWidth / 100);
  });

  return {
    affectedPairs,
    totalWidth: penX - x,
    baselineY,
    capHeightLineY,
  };
}

/** Draw the affected-pair highlight boxes beneath the baseline, called after drawProof. */
export function drawAffectedPairHighlights(ctx, affectedPairs, baselineY, fontSize, highlightColor = 'rgba(204,120,92,0.5)') {
  ctx.save();
  ctx.fillStyle = highlightColor;
  for (const p of affectedPairs) {
    ctx.fillRect(p.x, baselineY + fontSize * 0.12, fontSize * 0.5, Math.max(2, fontSize * 0.03));
  }
  ctx.restore();
}
