'use strict';

// One error class for everything in Plans, so a route can tell "say this to the person" (status and message are safe to show) from a bug.
class PlanError extends Error {
  constructor(message, status = 400, code = null) { super(message); this.status = status; this.code = code; }
}

module.exports = { PlanError };
