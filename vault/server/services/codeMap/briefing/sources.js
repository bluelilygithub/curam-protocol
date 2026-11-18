'use strict';

// The curated parts of the Code Map briefing (docs/code-map.md "Context"): about.md, rules.md and building-blocks.md in this folder, and
// the check that rules.md is still in step with the files it was written from. Reads only these files and the two sources; no values
// from the environment.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const VAULT_ROOT = path.join(__dirname, '../../../..');
const RULE_SOURCES = ['CLAUDE.md', 'docs/core-conventions.md'];
const HEADER_RX = /^<!--\s*sources:(.*?)-->\s*\r?\n?/;

/** SHA-256 of a text file with its line endings made \n first: git turns them into \r\n on Windows checkouts and \n on Railway. */
const textHash = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n?/g, '\n')).digest('hex');

const read = (rel, root = VAULT_ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');
const readCurated = (name) => fs.readFileSync(path.join(HERE, name), 'utf8').replace(/\r\n?/g, '\n');

/** rules.md without its header, and the hashes the header records: { body, recorded: { 'CLAUDE.md': '<hex>', ... } }. */
function rulesWithHeader() {
  const text = readCurated('rules.md');
  const m = HEADER_RX.exec(text);
  const recorded = {};
  if (m) for (const part of m[1].split(';')) { const x = /([\w./-]+)\s+sha256=([0-9a-fA-F]+|PENDING)/.exec(part.trim()); if (x) recorded[x[1]] = x[2].toLowerCase(); }
  return { body: m ? text.slice(m[0].length) : text, recorded };
}

/** Which source files changed since rules.md was written: [] when it is current. */
function staleRuleSources(root = VAULT_ROOT) {
  const { recorded } = rulesWithHeader();
  return RULE_SOURCES.filter((rel) => {
    let current;
    try { current = textHash(read(rel, root)); } catch { return true; }
    return recorded[rel] !== current;
  });
}

/** The header line rules.md should start with for the current sources (used to refresh it; see docs/code-map.md). */
const currentRulesHeader = (root = VAULT_ROOT) => `<!-- sources: ${RULE_SOURCES.map((rel) => `${rel} sha256=${textHash(read(rel, root))}`).join('; ')} -->`;

/** Paths named in building-blocks.md (each line starts "- `path`"; a trailing / is a folder). */
function buildingBlockPaths() {
  return readCurated('building-blocks.md').split('\n').flatMap((line) => [...line.matchAll(/`((?:server|client)\/[\w./-]+)`/g)].map((m) => m[1]));
}

function curated() {
  return { about: readCurated('about.md').trim(), rules: rulesWithHeader().body.trim(), buildingBlocks: readCurated('building-blocks.md').trim() };
}

module.exports = { VAULT_ROOT, RULE_SOURCES, textHash, curated, rulesWithHeader, staleRuleSources, currentRulesHeader, buildingBlockPaths };
