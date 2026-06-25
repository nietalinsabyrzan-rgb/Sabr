import test from "node:test";
import assert from "node:assert/strict";
import { compactReply } from "./response-shape.js";

test("keeps short replies unchanged", () => {
  const reply = "Здравствуйте! Депозит можно открыть в мобильном приложении.";
  assert.equal(compactReply(reply, "dm"), reply);
});

test("compacts long DM replies", () => {
  const long = Array.from({ length: 20 }, (_, i) => `Предложение ${i + 1} про продукт банка.`).join(" ");
  assert.ok(compactReply(long, "dm").length <= 650);
});

test("compacts comments more strictly", () => {
  const long = Array.from({ length: 12 }, (_, i) => `Фраза ${i + 1} про условия.`).join(" ");
  assert.ok(compactReply(long, "comment").length <= 320);
});
