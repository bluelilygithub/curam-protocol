// node client/src/pages/dnsLookup/report.test.mjs
import assert from 'assert';
import { aboutLines, reportCsv, reportHtml, reportFilename } from './report.mjs';

const about = {
  hosting: { ip: '104.16.1.1', organisation: 'Cloudflare, Inc.', network: 'CLOUDFLARENET', proxy: true, reverseName: null },
  registrar: { domain: 'example.com', name: 'Example Registrar', registered: '2001-01-01', expires: '2030-01-01' },
};
const lines = Object.fromEntries(aboutLines(about));
assert.match(lines['Hosted by'], /Cloudflare.*real server behind it is hidden/s);
assert.strictEqual(lines.Registrar, 'Example Registrar');
assert.match(aboutLines({ hosting: null, registrar: { error: 'The registry did not answer.' } })[0][1], /No address/);

const item = {
  kind: 'records', name: 'example.com', resolver: 'cloudflare', createdAt: '2026-11-25T01:00:00Z',
  result: { about, answer: { name: 'example.com', results: [
    { type: 'A', records: [{ value: '104.16.1.1', ttl: 300 }] },
    { type: 'TXT', records: [{ value: 'v=spf1 include:"a,b" -all' }] },
    { type: 'CAA', records: [] },
  ] } },
};
const csv = reportCsv(item);
assert.match(csv, /^Section,Item,Value,TTL,Priority\r\n/);
assert.match(csv, /Records,A,104\.16\.1\.1,300,/);
assert.match(csv, /"v=spf1 include:""a,b"" -all"/, 'commas and quotes are escaped');
assert.match(csv, /Records,CAA,None found/);

const html = reportHtml({ ...item, name: '<b>x</b>' });
assert.ok(!html.includes('<b>x</b>'), 'the name is escaped');
assert.match(html, /Example Registrar/);

const email = { kind: 'email', name: 'example.com', createdAt: '2026-11-25T01:00:00Z', result: { findings: [{ id: 'spf', level: 'bad', title: 'No SPF', detail: 'Add one.' }] } };
assert.match(reportCsv(email), /Email setup,Problem: No SPF,Add one\./);
assert.strictEqual(reportFilename(email, 'csv'), 'dns-email-example.com-2026-11-25.csv');

console.log('report tests passed');
