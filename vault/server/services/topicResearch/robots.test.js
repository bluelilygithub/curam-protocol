#!/usr/bin/env node
/**
 * Topic Research (milestone 3): reading and obeying robots.txt. Parsing and matching follow RFC 9309; the checker is tested with a stand-in
 * for the fetcher, so it needs no network.
 *
 * Run: node server/services/topicResearch/robots.test.js
 */
'use strict';

const assert = require('assert');
const { parseRobots, rulesFor, isAllowed, createRobotsChecker, AGENT_TOKEN } = require('./robots');

const allowed = (text, path, token) => isAllowed(rulesFor(parseRobots(text), token).rules, path);

async function main() {
  // ------------------------------------------------------------ parsing
  {
    const groups = parseRobots(`
      # a comment
      User-agent: GoogleBot
      User-agent: *            # two names, one group
      Disallow: /private       # trailing comment
      Allow: /private/ok
      Crawl-delay: 3

      USER-AGENT: CuramVault
      DISALLOW: /nothing-here
      Disallow:
      Sitemap: https://example.com/sitemap.xml
      Unknown-field: whatever
    `);
    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(groups[0].agents, ['googlebot', '*']);
    assert.deepStrictEqual(groups[0].rules, [{ allow: false, pattern: '/private' }, { allow: true, pattern: '/private/ok' }]);
    assert.strictEqual(groups[0].crawlDelayMs, 3000);
    assert.deepStrictEqual(groups[1].agents, ['curamvault']);
    assert.deepStrictEqual(groups[1].rules, [{ allow: false, pattern: '/nothing-here' }], 'field names are case-insensitive, and an empty Disallow adds no rule');
    assert.strictEqual(groups[1].crawlDelayMs, null);
    assert.deepStrictEqual(parseRobots('Disallow: /orphan\nUser-agent: *\nDisallow: /x').map((g) => g.rules.length), [1], 'a rule before any User-agent belongs to no one');
    assert.deepStrictEqual(parseRobots(''), []);
    assert.deepStrictEqual(parseRobots(null), []);
    assert.deepStrictEqual(parseRobots('User-agent: *\nCrawl-delay: abc\nCrawl-delay: -1').map((g) => g.crawlDelayMs), [null], 'a nonsense delay is ignored');
    assert.strictEqual(parseRobots('User-agent: *\nCrawl-delay: 1.5')[0].crawlDelayMs, 1500);
  }

  // ------------------------------------------------------------ which group applies to us
  {
    const text = 'User-agent: *\nDisallow: /everything\n\nUser-agent: CuramVault\nDisallow: /only-us\n\nUser-agent: curamvault\nDisallow: /also-us\nCrawl-delay: 4';
    const mine = rulesFor(parseRobots(text));
    assert.deepStrictEqual(mine.rules.map((r) => r.pattern).sort(), ['/also-us', '/only-us'], 'our own groups are used, and several of them add up');
    assert.strictEqual(mine.crawlDelayMs, 4000);
    assert.ok(isAllowed(mine.rules, '/everything'), 'the "*" group is ignored once a group names us');
    assert.ok(!isAllowed(mine.rules, '/only-us/x'));
    const star = rulesFor(parseRobots('User-agent: SomeoneElse\nDisallow: /\n\nUser-agent: *\nDisallow: /secret'));
    assert.deepStrictEqual(star.rules, [{ allow: false, pattern: '/secret' }], 'with no group for us, the "*" group applies');
    assert.deepStrictEqual(rulesFor(parseRobots('User-agent: SomeoneElse\nDisallow: /')), { rules: [], crawlDelayMs: null }, 'rules for other crawlers only: nothing applies to us');
    assert.strictEqual(AGENT_TOKEN, 'curamvault');
  }

  // ------------------------------------------------------------ matching a path
  {
    assert.ok(allowed('User-agent: *\nDisallow: /', '/') === false);
    assert.ok(allowed('User-agent: *\nDisallow: /', '/anything/at/all') === false, 'Disallow: / shuts the whole site');
    assert.ok(allowed('User-agent: *\nDisallow:', '/anything'), 'an empty Disallow shuts nothing');
    assert.ok(allowed('', '/anything'), 'no robots.txt rules: allowed');
    assert.ok(allowed('User-agent: *\nDisallow: /private', '/public'));
    assert.ok(!allowed('User-agent: *\nDisallow: /private', '/private'));
    assert.ok(!allowed('User-agent: *\nDisallow: /private', '/private/deep/page'), 'a rule is a prefix');
    assert.ok(!allowed('User-agent: *\nDisallow: /private', '/privately'), 'a prefix is a prefix, even mid-word');
    // the longest matching rule wins
    const mixed = 'User-agent: *\nDisallow: /news\nAllow: /news/public';
    assert.ok(!allowed(mixed, '/news/secret'));
    assert.ok(allowed(mixed, '/news/public/story'), 'a longer Allow beats a shorter Disallow');
    assert.ok(allowed('User-agent: *\nDisallow: /\nAllow: /open', '/open/page'));
    assert.ok(!allowed('User-agent: *\nDisallow: /\nAllow: /open', '/closed'));
    // equal length: Allow wins
    assert.ok(allowed('User-agent: *\nDisallow: /same\nAllow: /same', '/same'), 'a tie goes to Allow');
    assert.ok(allowed('User-agent: *\nAllow: /same\nDisallow: /same', '/same'), 'whichever is listed first');
    // wildcards and end anchors
    assert.ok(!allowed('User-agent: *\nDisallow: /*.pdf$', '/files/report.pdf'));
    assert.ok(allowed('User-agent: *\nDisallow: /*.pdf$', '/files/report.pdf?download=1'), '$ means the address ends there');
    assert.ok(allowed('User-agent: *\nDisallow: /*.pdf$', '/files/report.pdfx'));
    assert.ok(!allowed('User-agent: *\nDisallow: /a/*/c', '/a/b/c/d'));
    assert.ok(allowed('User-agent: *\nDisallow: /a/*/c', '/a/b/d'));
    assert.ok(!allowed('User-agent: *\nDisallow: /*?session=', '/page?session=abc'), 'the query string is part of what is matched');
    assert.ok(allowed('User-agent: *\nDisallow: /*?session=', '/page?other=1'));
    // other characters in a rule mean themselves
    assert.ok(allowed('User-agent: *\nDisallow: /a.b', '/axb'), 'a dot is a dot');
    assert.ok(!allowed('User-agent: *\nDisallow: /a.b', '/a.b'));
    assert.ok(!allowed('User-agent: *\nDisallow: /a+b(c)', '/a+b(c)'));
    assert.ok(allowed('User-agent: *\nDisallow: /Private', '/private'), 'paths are case-sensitive');
  }

  // ------------------------------------------------------------ the checker (fetch stubbed)
  {
    const httpError = (status) => Object.assign(new Error(`Could not fetch the file (HTTP ${status})`), { status: 400 });
    const stub = (table) => {
      const calls = [];
      const fn = async (url, opts) => {
        calls.push({ url, opts });
        const v = table[new URL(url).origin];
        if (v instanceof Error) throw v;
        if (v === undefined) throw new Error('Could not fetch the file');
        return { buffer: Buffer.from(v), contentType: 'text/plain', finalUrl: url };
      };
      fn.calls = calls;
      return fn;
    };
    const robotsAt = (o) => `${o}/robots.txt`;

    let clock = 1000;
    const fetchFile = stub({
      'https://open.example': 'User-agent: *\nDisallow: /private\nCrawl-delay: 3',
      'https://closed.example': 'User-agent: *\nDisallow: /',
      'https://missing.example': httpError(404),
      'https://gone.example': httpError(410),
      'https://forbidden.example': httpError(403),
      'https://busy.example': httpError(429),
      'https://broken.example': httpError(500),
      'https://down.example': new Error('Could not fetch the file'),
      'https://slow.example': 'User-agent: *\nCrawl-delay: 60',
      'https://ours.example': 'User-agent: *\nDisallow: /\n\nUser-agent: CuramVault\nDisallow: /members',
    });
    const checker = createRobotsChecker({ fetchFile, now: () => clock, ttlMs: 60000 });

    let r = await checker.check('https://open.example/news/story');
    assert.deepStrictEqual(r, { allowed: true, reason: 'allowed', crawlDelayMs: 3000 });
    r = await checker.check('https://open.example/private/story');
    assert.deepStrictEqual([r.allowed, r.reason], [false, 'disallowed']);
    assert.strictEqual(fetchFile.calls.length, 1, 'robots.txt is fetched once per site, not once per page');
    assert.strictEqual(fetchFile.calls[0].url, robotsAt('https://open.example'));
    assert.strictEqual(fetchFile.calls[0].opts.maxBytes, 512 * 1024);

    assert.deepStrictEqual((await checker.check('https://closed.example/anything')).reason, 'disallowed');
    for (const o of ['missing', 'gone']) {
      const x = await checker.check(`https://${o}.example/page`);
      assert.deepStrictEqual([x.allowed, x.reason], [true, 'allowed'], `${o}: no robots.txt (404, 410) means everything is allowed`);
    }
    for (const o of ['forbidden', 'busy', 'broken', 'down']) {
      const x = await checker.check(`https://${o}.example/page`);
      assert.deepStrictEqual([x.allowed, x.reason], [false, 'unavailable'], `${o}: a robots.txt that cannot be read (or is refused) means nothing is read from the site`);
    }
    r = await checker.check('https://slow.example/page');
    assert.deepStrictEqual([r.allowed, r.reason, r.crawlDelayMs], [false, 'disallowed', 60000], 'a site that asks for a minute between pages is not worth waiting for');
    assert.deepStrictEqual([(await checker.check('https://ours.example/news')).allowed, (await checker.check('https://ours.example/members/x')).allowed], [true, false], 'our own group beats the "*" group');
    assert.deepStrictEqual(await checker.check('not a url'), { allowed: false, reason: 'unavailable', crawlDelayMs: null });

    // caching: another page of a known site does not fetch again; a different site does; an old answer is replaced
    const before = fetchFile.calls.length;
    await checker.check('https://closed.example/another');
    await checker.check('https://open.example/other');
    assert.strictEqual(fetchFile.calls.length, before);
    await checker.check('http://open.example/other'); // http and https are different origins
    assert.strictEqual(fetchFile.calls.length, before + 1);
    clock += 61000;
    await checker.check('https://open.example/after-an-hour');
    assert.strictEqual(fetchFile.calls.length, before + 2, 'asked again once the saved answer is old');

    // two pages of one site at the same moment share one request
    const fresh = stub({ 'https://same.example': 'User-agent: *\nDisallow: /x' });
    const c2 = createRobotsChecker({ fetchFile: fresh });
    const [a, b] = await Promise.all([c2.check('https://same.example/1'), c2.check('https://same.example/x/2')]);
    assert.deepStrictEqual([a.allowed, b.allowed], [true, false]);
    assert.strictEqual(fresh.calls.length, 1);

    // a failure is remembered too, so a down site is not hammered
    const down = stub({ 'https://flaky.example': httpError(503) });
    const c3 = createRobotsChecker({ fetchFile: down });
    await c3.check('https://flaky.example/1'); await c3.check('https://flaky.example/2');
    assert.strictEqual(down.calls.length, 1);
  }

  console.log('topicResearch robots: all passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
