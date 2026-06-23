import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkKnowledge, cosine, RagIndex, type Chunk } from "./rag.js";

const SAMPLE_MD = `# Депозиты

## Тариф Бастау

Ставка вознаграждения 2% годовых. Минимальный взнос 1000 тенге.

## Тариф Оркен

${"Длинный абзац про условия тарифа Оркен. ".repeat(60)}

# Займы

## Жилищный заём

Ставка от 5% годовых после накопления 50% суммы.
`;

test("chunkKnowledge keeps heading breadcrumbs and respects size", () => {
  const chunks = chunkKnowledge(SAMPLE_MD, 800, 100);
  assert.ok(chunks.length >= 4);
  for (const c of chunks) {
    // heading prefix + body; allow slack for the breadcrumb line
    assert.ok(c.text.length <= 800 + c.heading.length + 2, `chunk too big: ${c.text.length}`);
  }
  const bastau = chunks.find((c) => c.heading.includes("Бастау"));
  assert.ok(bastau);
  assert.match(bastau.heading, /^Депозиты > Тариф Бастау$/);
  assert.match(bastau.text, /2% годовых/);

  const loan = chunks.find((c) => c.heading.includes("Жилищный"));
  assert.ok(loan);
  assert.match(loan.heading, /^Займы > Жилищный заём$/);
});

test("oversized sections are split into multiple chunks", () => {
  const chunks = chunkKnowledge(SAMPLE_MD, 800, 100);
  const orken = chunks.filter((c) => c.heading.includes("Оркен"));
  assert.ok(orken.length >= 2, `expected multiple chunks, got ${orken.length}`);
});

test("cosine similarity basics", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(cosine([1, 1], [1, 0.9]) > 0.9);
});

test("RagIndex retrieves the most relevant chunk", async () => {
  const chunks: Chunk[] = [
    { id: 0, heading: "Депозиты", text: "ставка по депозиту 2%" },
    { id: 1, heading: "Займы", text: "жилищный заём от 5%" },
    { id: 2, heading: "Карты", text: "карта без комиссии" },
  ];
  // Fake embedder: fixed vector per known phrase, queries mapped by keyword.
  const vectors: Record<string, number[]> = {
    "ставка по депозиту 2%": [1, 0, 0],
    "жилищный заём от 5%": [0, 1, 0],
    "карта без комиссии": [0, 0, 1],
  };
  const embed = async (texts: string[]) =>
    texts.map((t) => {
      if (vectors[t]) return vectors[t];
      if (t.includes("заём") || t.includes("займ")) return [0.1, 0.9, 0];
      return [0.9, 0.1, 0];
    });

  const index = new RagIndex(chunks, embed);
  await index.build();
  const top = await index.retrieve("как получить займ?", 1);
  assert.equal(top[0].heading, "Займы");
});
