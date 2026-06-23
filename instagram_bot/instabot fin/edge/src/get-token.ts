import "dotenv/config";
import express from "express";

const APP_ID = process.env.IG_APP_ID;
const APP_SECRET = process.env.IG_APP_SECRET;
const REDIRECT_URI = process.env.IG_OAUTH_REDIRECT_URI;
const PORT = Number(process.env.PORT ?? 3000);

const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",");

if (!APP_ID || !APP_SECRET || !REDIRECT_URI) {
  console.error(
    "Missing env. Set IG_APP_ID, IG_APP_SECRET, IG_OAUTH_REDIRECT_URI in .env",
  );
  process.exit(1);
}

const authorizeUrl =
  `https://www.instagram.com/oauth/authorize` +
  `?client_id=${encodeURIComponent(APP_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}`;

const app = express();

app.get("/auth", async (req, res) => {
  const err = req.query.error_description ?? req.query.error;
  if (err) {
    console.error("[auth] returned error:", err);
    res.status(400).send(`Auth error: ${err}`);
    return;
  }

  // Instagram sometimes appends "#_" to the code — strip it.
  const code = (req.query.code as string | undefined)?.replace(/#_$/, "");
  if (!code) {
    res.status(400).send("No ?code in callback");
    return;
  }

  try {
    // 1) code -> short-lived token
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: APP_ID,
        client_secret: APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const shortText = await shortRes.text();
    if (!shortRes.ok) throw new Error(`short-lived exchange: ${shortText}`);
    const short = JSON.parse(shortText);

    // 2) short-lived -> long-lived (~60 days)
    const llRes = await fetch(
      `https://graph.instagram.com/access_token` +
        `?grant_type=ig_exchange_token` +
        `&client_secret=${encodeURIComponent(APP_SECRET)}` +
        `&access_token=${encodeURIComponent(short.access_token)}`,
    );
    const llText = await llRes.text();
    if (!llRes.ok) throw new Error(`long-lived exchange: ${llText}`);
    const ll = JSON.parse(llText);

    console.log("\n========== SUCCESS — copy into .env ==========");
    console.log(`IG_USER_ID=${short.user_id}`);
    console.log(`IG_ACCESS_TOKEN=${ll.access_token}`);
    console.log(`# expires in ~${Math.round((ll.expires_in ?? 0) / 86400)} days`);
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
