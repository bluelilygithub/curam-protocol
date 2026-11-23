'use strict';

// BIP: small WHOIS (port 43) fallback, used only when RDAP has no registrant details. Written with Node's net module rather than
// adding node-whois: a package.json change would force a 10-15 minute base-image rebuild on the next deploy (docs/deploy-speed.md).

const net = require('net');

const SERVERS = {
  com: 'whois.verisign-grs.com', net: 'whois.verisign-grs.com', org: 'whois.pir.org',
  io: 'whois.nic.io', co: 'whois.nic.co', ai: 'whois.nic.ai',
  au: 'whois.auda.org.au', 'com.au': 'whois.auda.org.au', 'net.au': 'whois.auda.org.au', 'org.au': 'whois.auda.org.au',
  nz: 'whois.srs.net.nz', 'co.nz': 'whois.srs.net.nz', uk: 'whois.nic.uk', 'co.uk': 'whois.nic.uk',
  info: 'whois.afilias.net', biz: 'whois.nic.biz', dev: 'whois.nic.google', app: 'whois.nic.google',
};

function serverFor(domain) {
  const parts = String(domain || '').split('.');
  if (parts.length >= 3 && SERVERS[parts.slice(-2).join('.')]) return SERVERS[parts.slice(-2).join('.')];
  return SERVERS[parts[parts.length - 1]] || null;
}

function query(server, domain, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: server, port: 43 });
    let raw = '';
    let settled = false;
    const finish = (err, text) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err); else resolve(text);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => finish(new Error('WHOIS timed out.')));
    socket.on('error', (err) => finish(err));
    socket.on('data', (chunk) => { raw += chunk; if (raw.length > 500000) finish(null, raw); });
    socket.on('end', () => finish(null, raw));
    socket.on('connect', () => socket.write(`${domain}\r\n`));
  });
}

function pick(lines, patterns) {
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m) return String(m[1] || '').trim();
    }
  }
  return null;
}

function parseWhois(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim());
  const addressLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(?:Registrant\s+)?(?:Street|Address(?:\s*\d)?|City|Suburb|State|Province|Postal\s+Code|Postcode|Country)\s*:\s*(.+)$/i);
    if (m && m[1] && !/^http/i.test(m[1])) addressLines.push(m[1].trim());
  }
  return {
    registrantName: pick(lines, [/^Registrant\s+Name:\s*(.+)$/i, /^Registrant:\s*(.+)$/i]),
    organisation: pick(lines, [/^Registrant\s+Organi[sz]ation:\s*(.+)$/i, /^Org(?:anisation)?[a-z]?Name:\s*(.+)$/i]),
    address: addressLines.slice(0, 6).join(', ') || null,
    registrationDate: pick(lines, [/^(?:Creation Date|Created On|Registered on|Registration Time|Domain Registration Date):\s*(.+)$/i]),
    expiryDate: pick(lines, [/^(?:Registry Expiry Date|Expiry Date|Expires On|Renewal Date|Domain Expiration Date):\s*(.+)$/i]),
    registrar: pick(lines, [/^Registrar:\s*(.+)$/i, /^Sponsoring Registrar:\s*(.+)$/i]),
  };
}

async function lookup(domain, deps = {}) {
  const server = deps.serverFor ? deps.serverFor(domain) : serverFor(domain);
  if (!server) throw new Error(`No public WHOIS server is known for ${domain}.`);
  const raw = deps.query ? await deps.query(server, domain) : await query(server, domain);
  return { ...parseWhois(raw), lookupSource: `WHOIS (${server})`, raw };
}

module.exports = { SERVERS, serverFor, parseWhois, lookup };
