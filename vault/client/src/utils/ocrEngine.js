/**
 * Shared on-device OCR (Tesseract.js). The implementation lives in planner-core (also used by Garden Planner's plant-tag scan);
 * this file keeps the old import path working for the measurement scanner.
 */
export { createOcrEngine, normalizeOcrPage } from '@planner-core/ocr/ocrEngine';
