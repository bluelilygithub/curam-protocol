'use strict';

const FEATURE_ACCESS_DEFAULTS = {
  clients: true,
  goals: true,
  habitsSidebar: true,
  memberModelSelection: false,
  chains: true,
  graph: true,
  debate: true,
  compare: true,
  finance: true,
  usage: true,
  mood: true,
  newsDigest: true,
};

const FEATURE_ACCESS_KEYS = Object.keys(FEATURE_ACCESS_DEFAULTS);

module.exports = {
  FEATURE_ACCESS_DEFAULTS,
  FEATURE_ACCESS_KEYS,
};

