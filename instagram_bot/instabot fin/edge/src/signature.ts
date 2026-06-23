import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaSignature(opts: {
  appSecret: string;
  rawBody: Buffer;
  signatureHeader?: string | string[];
}): boolean {
  const header = Array.isArray(opts.signatureHeader)
    ? opts.signatureHeader[0]
    : opts.signatureHeader;
  const prefix = "sha256=";
  if (!opts.appSecret || !header?.startsWith(prefix)) return false;

  const expected = createHmac("sha256", opts.appSecret)
    .update(opts.rawBody)
    .digest("hex");
  const actual = header.slice(prefix.length);

  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;

  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
