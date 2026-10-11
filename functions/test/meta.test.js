const test = require('node:test');
const assert = require('node:assert');
const meta = require('../lib/meta');

test('Pages come back with their tokens and linked Instagram accounts, across pages of results', async () => {
  const seen = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    seen.push(u.pathname + (u.searchParams.get('grant_type') ? ':exchange' : '') + (u.searchParams.get('after') ? ':after' : ''));
    if (u.pathname.endsWith('/oauth/access_token')) {
      return Response.json({ access_token: u.searchParams.get('grant_type') ? 'LONG' : 'SHORT' });
    }
    if (u.pathname.endsWith('/me/accounts')) {
      assert.strictEqual(u.searchParams.get('access_token'), 'LONG');
      if (!u.searchParams.get('after')) {
        return Response.json({ data: [{ id: 'P1', name: 'Page One', access_token: 'PT1', instagram_business_account: { id: 'IG1', username: 'one' } }],
          paging: { cursors: { after: 'X' }, next: 'https://next' } });
      }
      return Response.json({ data: [{ id: 'P2', name: 'Page Two', access_token: 'PT2' }], paging: { cursors: {} } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const pages = await meta.pagesFor({ appId: 'a', appSecret: 's', redirectUri: 'https://x/cb', code: 'c' });
  assert.deepStrictEqual(pages, [
    { id: 'P1', name: 'Page One', pageToken: 'PT1', instagram: { id: 'IG1', username: 'one' } },
    { id: 'P2', name: 'Page Two', pageToken: 'PT2', instagram: null },
  ]);
  assert.deepStrictEqual(seen.map((s) => s.replace(/^\/v[\d.]+/, '')),
    ['/oauth/access_token', '/oauth/access_token:exchange', '/me/accounts', '/me/accounts:after']);
});

test('Meta errors surface with their message', async () => {
  global.fetch = async () => Response.json({ error: { message: 'Invalid verification code format.' } }, { status: 400 });
  await assert.rejects(meta.pagesFor({ appId: 'a', appSecret: 's', redirectUri: 'r', code: 'bad' }), /Invalid verification code/);
});

test('the login dialog asks for the publishing permissions', () => {
  const url = new URL(meta.authUrl({ appId: 'APP', redirectUri: 'https://x/api/oauth/meta/callback', state: 'S' }));
  const scope = url.searchParams.get('scope').split(',');
  for (const s of ['pages_manage_posts', 'instagram_content_publish', 'pages_show_list']) assert.ok(scope.includes(s), s);
  assert.strictEqual(url.searchParams.get('state'), 'S');
});
