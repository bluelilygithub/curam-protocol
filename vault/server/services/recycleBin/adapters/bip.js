'use strict';

// How the recycle bin handles a deleted Business Profiler profile. The delete route snapshots the profile and all of its source rows
// in one transaction; this puts them back with the same source history.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

register('bip-profile', {
  label: 'Business Profiler profile',
  async restore(db, userId, payload) {
    const profile = payload?.profile;
    if (!profile?.domain) throw new RestoreError('This deleted profile has nothing to restore.');
    // keep the client link only if that client still exists and is this person's (it may have been deleted meanwhile)
    const clientId = profile.clientId
      ? ((await db.query('SELECT id FROM clients WHERE id = $1 AND "userId" = $2', [profile.clientId, userId])).rows[0]?.id || null)
      : null;
    const entityId = await insertRow(db, 'bip_profiles', profile, {
      userId,
      override: {
        clientId,
        seedData: JSON.stringify(profile.seedData || {}),
        enrichmentData: JSON.stringify(profile.enrichmentData || {}),
        reconciliation: JSON.stringify(profile.reconciliation || {}),
        cards: JSON.stringify(profile.cards || {}),
        decisions: JSON.stringify(profile.decisions || {}),
        summary: profile.summary ? JSON.stringify(profile.summary) : null,
      },
    });
    for (const source of payload?.sources || []) {
      await insertRow(db, 'bip_sources', source, {
        userId,
        override: {
          profileId: entityId,
          data: JSON.stringify(source.data || {}),
          rawResponse: JSON.stringify(source.rawResponse || {}),
        },
      });
    }
    // saved questions and answers (snapshots from before 2026-11-23 have none)
    for (const qa of payload?.qa || []) {
      await insertRow(db, 'bip_qa', qa, {
        userId,
        override: { profileId: entityId, unverifiedFigures: JSON.stringify(qa.unverifiedFigures || []) },
      });
    }
    return { entityId };
  },
});
