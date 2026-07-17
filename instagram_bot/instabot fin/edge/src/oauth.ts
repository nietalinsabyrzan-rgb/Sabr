export interface OAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface InstagramTokenResult {
  userId: string;
  accessToken: string;
  expiresIn?: number;
}

export const INSTAGRAM_BUSINESS_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
];

export function buildAuthorizeUrl(config: OAuthConfig): string {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: INSTAGRAM_BUSINESS_SCOPES.join(","),
  });

  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export function normalizeAuthCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/#_$/, "").trim();
  return code ? code : null;
}

export async function exchangeAuthCodeForLongLivedToken(
  config: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstagramTokenResult> {
  const shortRes = await fetchImpl("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code,
    }),
  });
  const shortText = await shortRes.text();
  if (!shortRes.ok) throw new Error(`short-lived exchange: ${shortText}`);

  const short = JSON.parse(shortText) as { access_token?: string; user_id?: string };
  if (!short.access_token || !short.user_id) {
    throw new Error(`short-lived exchange returned missing token data: ${shortText}`);
  }

  const longLivedUrl =
    `https://graph.instagram.com/access_token` +
    `?grant_type=ig_exchange_token` +
    `&client_secret=${encodeURIComponent(config.appSecret)}` +
    `&access_token=${encodeURIComponent(short.access_token)}`;
  const longRes = await fetchImpl(longLivedUrl);
  const longText = await longRes.text();
  if (!longRes.ok) throw new Error(`long-lived exchange: ${longText}`);

  const long = JSON.parse(longText) as { access_token?: string; expires_in?: number };
  if (!long.access_token) {
    throw new Error(`long-lived exchange returned no access token: ${longText}`);
  }

  return {
    userId: short.user_id,
    accessToken: long.access_token,
    expiresIn: long.expires_in,
  };
}
