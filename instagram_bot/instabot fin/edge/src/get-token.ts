import "dotenv/config";
import express from "express";
import {
  buildAuthorizeUrl,
  exchangeAuthCodeForLongLivedToken,
  normalizeAuthCode,
} from "./oauth.js";

const APP_ID = process.env.IG_APP_ID;
const APP_SECRET = process.env.IG_APP_SECRET;
const REDIRECT_URI = process.env.IG_OAUTH_REDIRECT_URI;
const PORT = Number(process.env.PORT ?? 3000);

if (!APP_ID || !APP_SECRET || !REDIRECT_URI) {
  console.error(
    "Missing env. Set IG_APP_ID, IG_APP_SECRET, IG_OAUTH_REDIRECT_URI in .env",
  );
  process.exit(1);
}

const oauthConfig = {
  appId: APP_ID,
  appSecret: APP_SECRET,
  redirectUri: REDIRECT_URI,
};
const authorizeUrl = buildAuthorizeUrl(oauthConfig);

const app = express();

app.get("/auth", async (req, res) => {
  const err = req.query.error_description ?? req.query.error;
  if (err) {
    console.error("[auth] returned error:", err);
    res.status(400).send(`Auth error: ${err}`);
    return;
  }

  // Instagram sometimes appends "#_" to the code — strip it.
  const code = normalizeAuthCode(req.query.code);
  if (!code) {
    res.status(400).send("No ?code in callback");
    return;
  }

  try {
    const token = await exchangeAuthCodeForLongLivedToken(oauthConfig, code);

    console.log("\n========== SUCCESS — copy into .env ==========");
    console.log(`IG_USER_ID=${token.userId}`);
    console.log(`IG_ACCESS_TOKEN=${token.accessToken}`);
    console.log(`# expires in ~${Math.round((token.expiresIn ?? 0) / 86400)} days`);
    console.log("==============================================\n");

    res.send("✅ Token captured. Check your terminal, then close this tab.");
  } catch (e) {
    console.error("[auth] exchange failed:", e);
    res.status(500).send("Exchange failed — check the terminal output.");
  }
});

app.listen(PORT, () => {
  console.log(`\n[token-helper] listening on :${PORT}`);
  console.log(
    `\n1) Register this EXACT redirect URI in Instagram business login settings:\n   ${REDIRECT_URI}`,
  );
  console.log(`\n2) Open this URL in your browser, log in, and authorize:\n\n   ${authorizeUrl}\n`);
});
