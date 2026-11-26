// Stands in for @mozilla/readability in HTML Content Check's bundle (scripts/buildHtmlContentCheckLib.js): full mode never uses
// DocCompare's main-content guess, so the package is left out and this refuses to run if anything ever calls it.
export class Readability {
  constructor() { throw new Error('Readability is not in the HTML Content Check bundle: use mode full'); }
}
