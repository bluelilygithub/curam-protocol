// What Save to Note and Create client write for a Business Profiler profile. Pure, so it is tested without a browser:
//   node client/src/pages/bip/bipNote.test.mjs
// The note links back with "[name](/bip/:id)"; GET /api/bip/profiles/:id/notes finds notes by that exact link text.

export const profilePath = (id) => `/bip/${Number(id)}`;

const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const present = (v) => { const s = clean(v); return s && s !== 'Not found' ? s : ''; };
const linkLabel = (s) => clean(s).replace(/[[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The facts worth carrying out of a profile, each '' when BIP did not find it. */
export function profileFacts(profile) {
  const c = profile?.cards || {};
  const f = profile?.reconciliation?.fields || {};
  const firstValue = (key) => present(f[key]?.decision) || present(f[key]?.values?.[0]?.value);
  const people = (c.people || []).map((p) => [present(p.name), present(p.role)].filter(Boolean).join(' — ')).filter(Boolean);
  const places = c.reputation?.googlePlaces;
  return {
    name: present(c.entity?.businessName) || present(profile?.businessName) || present(profile?.domain) || 'Business profile',
    domain: present(c.entity?.domain) || present(profile?.domain),
    abn: present(c.entity?.abn) || firstValue('abn'),
    entityType: present(c.entity?.entityType),
    address: firstValue('address') || present(c.locations?.[0]?.value),
    phone: firstValue('phone'),
    description: present(c.products?.description),
    people: people.slice(0, 5),
    rating: places && present(places.rating) ? `${present(places.rating)}/5 from ${present(places.reviewCount) || '?'} Google reviews` : '',
  };
}

const dateOf = (v) => (v ? new Date(v).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/** Markdown body for the new note: the link back first, then the facts that were found. */
export function profileNoteBody(profile) {
  const x = profileFacts(profile);
  const lines = [`From Business Profiler: [${linkLabel(x.name)}](${profilePath(profile.id)})`, ''];
  const add = (label, value) => { if (value) lines.push(`- **${label}:** ${value}`); };
  add('Website', x.domain && `https://${x.domain}`);
  add('ABN', x.abn);
  add('Entity type', x.entityType);
  add('Address', x.address);
  add('Phone', x.phone);
  add('Reputation', x.rating);
  if (x.people.length) add('People', x.people.join('; '));
  if (x.description) lines.push('', x.description);
  const when = dateOf(profile.scannedAt || profile.createdAt);
  lines.push('', `_Public-source profile${when ? ` checked ${when}` : ''}. Open the profile for every source and any conflicts._`);
  return `${lines.join('\n')}\n`;
}

/** The fields for POST /api/clients when a client is made from the profile. */
export function clientFromProfile(profile) {
  const x = profileFacts(profile);
  const facts = [
    `Business Profiler profile: ${profilePath(profile.id)}`,
    x.domain && `Website: https://${x.domain}`,
    x.abn && `ABN: ${x.abn}`,
    x.address && `Address: ${x.address}`,
    x.phone && `Phone: ${x.phone}`,
  ].filter(Boolean);
  return { name: x.name, company: x.name, clientType: 'company', status: 'prospect', notes: facts.join('\n') };
}
