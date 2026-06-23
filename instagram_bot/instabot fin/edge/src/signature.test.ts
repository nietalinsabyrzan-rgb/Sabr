import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMetaSignature } from "./signature.js";

test("accepts a valid Meta X-Hub-Signature-256 header", () => {
  const rawBody = Buffer.from(JSON.stringify({ object: "instagram" }));
  const secret = "test-secret";
  const sig = createHmac("sha256", secret).update(rawBody).digest("hex");

  assert.equal(
    verifyMetaSignature({
      appSecret: secret,
      rawBody,
      signatureHeader: `sha256=${sig}`,
    }),
    true,
  );
});

test("rejects invalid or missing Meta signatures", () => {
  const rawBody = Buffer.from("{}");
  assert.equal(
    verifyMetaSignature({
      appSecret: "test-secret",
      rawBody,
      signatureHeader: "sha256=bad",
    }),
    false,
  );
  assert.equal(
    verifyMetaSignature({
      appSecret: "test-secret",
      rawBody,
    }),
    false,
  );
});
