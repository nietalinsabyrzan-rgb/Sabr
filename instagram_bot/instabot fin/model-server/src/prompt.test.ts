import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserPrompt } from "./prompt.js";

test("adds strict Kazakh output instruction for Kazakh text without language hint", () => {
  const prompt = buildUserPrompt({
    surface: "dm",
    userMessage: "Салем, маган депозит жайлы айтып бересиз бе",
  });

  assert.match(prompt, /МІНДЕТТІ ТАЛАП: жауапты толық қазақша жаз/);
  assert.match(prompt, /Орысша сөйлемдер қолданба/);
});

test("language hint overrides ambiguous wording", () => {
  const prompt = buildUserPrompt({
    surface: "comment",
    userMessage: "депозит?",
    languageHint: "kk",
  });

  assert.match(prompt, /МІНДЕТТІ ТАЛАП: жауапты толық қазақша жаз/);
});
