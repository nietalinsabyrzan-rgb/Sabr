import test from "node:test";
import assert from "node:assert/strict";
import { latestClientMessage } from "./routing-text.js";

test("returns plain text unchanged", () => {
  assert.equal(latestClientMessage("Привет"), "Привет");
});

test("extracts latest short client message from context prompt", () => {
  const text = [
    "Контекст последних сообщений в этом Direct:",
    '1. Клиент: "что-то"',
    '   Бот: "По вопросам Отбасы банка можно обратиться в контакт-центр 1432"',
    "",
    "Новое короткое сообщение клиента:",
    '"Привет"',
    "",
    "Ответь на новое сообщение с учётом контекста.",
  ].join("\n");

  assert.equal(latestClientMessage(text), "Привет");
});
