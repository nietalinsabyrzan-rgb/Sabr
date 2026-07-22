import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizeUrl,
  exchangeAuthCodeForLongLivedToken,
  normalizeAuthCode,
} from "./oauth.js";

const config = {
  appId: "app-id",
  appSecret: "app-secret",
  redirectUri: "https://example.com/auth",
};

test("builds the Instagram business login authorize URL", () => {
  const url = new URL(buildAuthorizeUrl(config));

  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "app-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.com/auth");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(
    url.searchParams.get("scope"),
    "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
  );
});

test("normalizes callback codes and rejects non-string values", () => {
  assert.equal(normalizeAuthCode("abc#_"), "abc");
  assert.equal(normalizeAuthCode("  abc  "), "abc");
  assert.equal(normalizeAuthCode("   "), null);
  assert.equal(normalizeAuthCode(["abc"]), null);
});

test("exchanges a callback code for a long-lived token", async () => {
  const calls: string[] = [];
  const fetchStub = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).includes("api.instagram.com/oauth/access_token")) {
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /code=callback-code/);
      return new Response(JSON.stringify({ access_token: "short-token", user_id: "ig-user" }));
    }

    assert.match(String(url), /graph\.instagram\.com\/access_token/);
    assert.match(String(url), /access_token=short-token/);
    return new Response(JSON.stringify({ access_token: "long-token", expires_in: 5_184_000 }));
  };

  const token = await exchangeAuthCodeForLongLivedToken(
    config,
    "callback-code",
    fetchStub as typeof fetch,
  );

  assert.deepEqual(token, {
    userId: "ig-user",
    accessToken: "long-token",
    expiresIn: 5_184_000,
  });
  assert.equal(calls.length, 2);
});

test("fails early when the short-lived exchange omits token data", async () => {
  const fetchStub = async () => new Response(JSON.stringify({ user_id: "ig-user" }));

  await assert.rejects(
    exchangeAuthCodeForLongLivedToken(config, "callback-code", fetchStub as typeof fetch),
    /missing token data/,
  );
});

test("fails when the long-lived exchange omits an access token", async () => {
  let callCount = 0;
  const fetchStub = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({ access_token: "short-token", user_id: "ig-user" }));
    }

    return new Response(JSON.stringify({ expires_in: 5_184_000 }));
  };

  await assert.rejects(
    exchangeAuthCodeForLongLivedToken(config, "callback-code", fetchStub as typeof fetch),
    /no access token/,
  );
});
