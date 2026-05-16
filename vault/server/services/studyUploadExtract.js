'use strict';

const fs = require('fs');
const path = require('path');
const { sanitiseCodeFile } = require('../utils/sanitiseCodeFile');

const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.php', '.py', '.css', '.html', '.sql', '.sh'];
const CODE_SIZE_LIMIT = 500 * 1024;

function isCodeFile(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  return CODE_EXTENSIONS.includes(ext) || String(originalname).toLowerCase().endsWith('.env.example');
}

function extractXlsxText(filePath) {
  try {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    const parts = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { skipHidden: true });
      if (csv.trim()) parts.push(`## Sheet: ${sheetName}\n${csv}`);
    }
    return parts.join('\n\n');
  } catch (err) {
    console.error('[studyUpload] XLSX extraction error:', err.message);
    return '';
  }
}

async function extractWordText(filePath) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  } catch (err) {
    console.error('[studyUpload] Word extraction error:', err.message);
    return '';
  }
}

async function extractPdfText(filePath) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += `${content.items.map((item) => item.str).join(' ')}\n`;
    }
    return text.trim();
  } catch (err) {
    console.error('[studyUpload] PDF extraction error:', err.message);
    return '';
  }
}

const MAX_EXTRACT_CHARS = 200000;

/**
 * Extract plain text from an uploaded study file (temp path). Caller deletes file after.
 */
async function extractStudyUploadFromPath(filePath, originalname, mimetype) {
  const ext = path.extname(originalname).toLowerCase();
  const isPdf = mimetype === 'application/pdf' || ext === '.pdf';
  const isText = [
    'text/plain', 'text/csv', 'application/json', 'text/markdown', 'text/x-markdown',
  ].includes(mimetype) || ['.txt', '.md', '.csv', '.json'].includes(ext);
  const isSpreadsheet = ['.xlsx', '.xls', '.ods'].includes(ext);
  const isWord = ['.docx', '.doc'].includes(ext);

  let extractedText = '';

  if (isCodeFile(originalname)) {
    if (fs.statSync(filePath).size > CODE_SIZE_LIMIT) {
      throw new Error('Code files must be under 500KB.');
    }
    let rawContent;
    try {
      rawContent = fs.readFileSync(filePath, 'utf8');
    } catch {
      throw new Error('File must be valid UTF-8 text.');
    }
    const { sanitised } = sanitiseCodeFile(rawContent, originalname);
    extractedText = sanitised;
  } else if (isPdf) {
    extractedText = await extractPdfText(filePath);
  } else if (isSpreadsheet) {
    extractedText = extractXlsxText(filePath);
  } else if (isWord) {
    extractedText = await extractWordText(filePath);
  } else if (isText) {
    try {
      extractedText = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('[studyUpload] text read error:', err.message);
    }
  } else {
    throw new Error('Unsupported file type for study upload.');
  }

  let text = (extractedText || '').trim();
  if (text.length > MAX_EXTRACT_CHARS) {
    text = `${text.slice(0, MAX_EXTRACT_CHARS)}\n\n[Content truncated to ${MAX_EXTRACT_CHARS} characters]`;
  }

  return { extractedText: text, name: originalname };
}

module.exports = { extractStudyUploadFromPath, isCodeFile };
