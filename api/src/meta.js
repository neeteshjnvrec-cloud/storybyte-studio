/**
 * Facebook Login for a Page owner: the code becomes a long-lived user
 * token, and /me/accounts gives every Page the user manages with its own
 * Page token (which, obtained from a long-lived user token, doesn't expire)
 * and the Instagram professional account linked to it, if any. Instagram
 * publishing goes through that Page token too.
 */
export const VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export const SCOPES = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'business_management',
];

export function authUrl({ appId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, scope: SCOPES.join(','), response_type: 'code' });
  return `https://www.facebook.com/${VERSION}/dialog/oauth?${q}`;
}

async function graph(pathname, params) {
  const res = await fetch(`${GRAPH}${pathname}?${new URLSearchParams(params)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Meta ${pathname}: ${json.error?.message || res.status}`);
  return json;
}

/** The Pages (and linked Instagram accounts) the user granted, with tokens. */
export async function pagesFor({ appId, appSecret, redirectUri, code }) {
  const short = await graph('/oauth/access_token', { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
  const long = await graph('/oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token,
  });
  const pages = [];
  let next = { access_token: long.access_token, fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100' };
  for (let i = 0; next && i < 10; i++) {
    const page = await graph('/me/accounts', next);
    pages.push(...(page.data || []));
    next = page.paging?.cursors?.after && page.paging?.next ? { ...next, after: page.paging.cursors.after } : null;
  }
  return pages.map((p) => ({
    id: p.id, name: p.name, pageToken: p.access_token,
    instagram: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username } : null,
  }));
}


