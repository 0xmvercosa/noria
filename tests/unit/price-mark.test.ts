import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPriceMark,
  formatPriceMarkDiagnostic,
} from "../../src/domain/price-mark";

const now = 1789218000;
const mark = { price: 2539.5, confidence: 0.9, timestamp: now - 30 };

test("price marks are fresh through exactly 300 seconds with confidence at least 0.8", () => {
  assert.deepEqual(
    classifyPriceMark({ ...mark, confidence: 0.8, timestamp: now - 300 }, now),
    {
      status: "valid",
      freshness: "fresh",
      price: mark.price,
      confidence: 0.8,
      timestamp: now - 300,
      ageSeconds: 300,
    },
  );
  assert.deepEqual(
    classifyPriceMark({ ...mark, confidence: 1, timestamp: now }, now),
    {
      status: "valid",
      freshness: "fresh",
      price: mark.price,
      confidence: 1,
      timestamp: now,
      ageSeconds: 0,
    },
  );
});

test("301, 329 and 900 second references remain explicitly aged without changing their price or timestamp", () => {
  for (const [ageSeconds, confidence] of [
    [301, 0.8],
    [329, 0.99],
    [900, 1],
  ]) {
    assert.deepEqual(
      classifyPriceMark(
        { ...mark, confidence, timestamp: now - ageSeconds },
        now,
      ),
      {
        status: "valid",
        freshness: "aged",
        price: mark.price,
        confidence,
        timestamp: now - ageSeconds,
        ageSeconds,
      },
    );
  }
});

test("price marks reject 901 seconds and confidence 0.799 while preserving diagnostic context", () => {
  assert.deepEqual(classifyPriceMark({ ...mark, timestamp: now - 901 }, now), {
    status: "invalid",
    code: "stale",
    confidence: 0.9,
    timestamp: now - 901,
    ageSeconds: 901,
  });
  assert.deepEqual(
    classifyPriceMark(
      { ...mark, confidence: 0.799, timestamp: now - 329 },
      now,
    ),
    {
      status: "invalid",
      code: "low-confidence",
      confidence: 0.799,
      timestamp: now - 329,
      ageSeconds: 329,
    },
  );
  assert.equal(
    classifyPriceMark({ ...mark, confidence: 0 }, now).status,
    "invalid",
  );
});

test("missing and malformed marks or prices never produce a usable price", () => {
  for (const raw of [undefined, null]) {
    assert.deepEqual(classifyPriceMark(raw, now), {
      status: "invalid",
      code: "missing",
    });
  }
  const malformed: unknown[] = [
    false,
    12,
    "2539.5",
    [],
    {},
    ...[
      undefined,
      null,
      0,
      -1,
      NaN,
      Infinity,
      -Infinity,
      "2539.5",
      true,
      {},
      [],
    ].map((price) => ({ ...mark, price })),
  ];
  for (const raw of malformed) {
    const result = classifyPriceMark(raw, now);
    assert.equal(result.status, "invalid");
    assert.ok(result.status === "invalid" && result.code === "invalid-price");
    assert.equal("price" in result, false);
  }
});

test("confidence distinguishes missing, invalid and below-policy provider values without coercion", () => {
  for (const confidence of [undefined, null]) {
    const result = classifyPriceMark({ ...mark, confidence }, now);
    assert.ok(
      result.status === "invalid" && result.code === "missing-confidence",
    );
  }
  for (const confidence of [
    NaN,
    Infinity,
    -Infinity,
    -0.001,
    1.001,
    "0.9",
    true,
    {},
    [],
  ]) {
    const result = classifyPriceMark({ ...mark, confidence }, now);
    assert.ok(
      result.status === "invalid" && result.code === "invalid-confidence",
    );
    assert.equal("price" in result, false);
  }
  const zero = classifyPriceMark({ ...mark, confidence: 0 }, now);
  assert.ok(zero.status === "invalid" && zero.code === "low-confidence");
});

test("timestamps must be positive safe integers and future timestamps fail with their offset", () => {
  for (const timestamp of [
    undefined,
    null,
    0,
    -1,
    now + 0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    String(now),
  ]) {
    const result = classifyPriceMark({ ...mark, timestamp }, now);
    assert.ok(
      result.status === "invalid" && result.code === "invalid-timestamp",
    );
    assert.equal(result.ageSeconds, undefined);
    assert.equal(result.timestamp, undefined);
  }
  assert.deepEqual(classifyPriceMark({ ...mark, timestamp: now + 1 }, now), {
    status: "invalid",
    code: "future",
    confidence: 0.9,
    timestamp: now + 1,
    ageSeconds: -1,
  });
});

test("diagnostic copy names the token, exact age and provider confidence without probability claims", () => {
  assert.equal(
    formatPriceMarkDiagnostic(
      "WETH",
      classifyPriceMark({ ...mark, timestamp: now - 901 }, now),
    ),
    "WETH: price older than the 900s informational limit (age 901s; provider confidence 0.9).",
  );
  for (const ageSeconds of [301, 329, 900]) {
    assert.equal(
      formatPriceMarkDiagnostic(
        "USDC",
        classifyPriceMark(
          { ...mark, confidence: 0.99, timestamp: now - ageSeconds },
          now,
        ),
      ),
      `USDC: aged price reference for informational analysis (age ${ageSeconds}s; provider confidence 0.99).`,
    );
  }
  assert.equal(
    formatPriceMarkDiagnostic(
      "cbBTC",
      classifyPriceMark({ ...mark, confidence: 0.799 }, now),
    ),
    "cbBTC: provider confidence below 0.8 (age 30s; provider confidence 0.799).",
  );
  assert.equal(
    formatPriceMarkDiagnostic(
      "USDC",
      classifyPriceMark({ ...mark, timestamp: now + 1 }, now),
    ),
    "USDC: price timestamp is in the future (timestamp 1s ahead; provider confidence 0.9).",
  );
  assert.equal(
    formatPriceMarkDiagnostic("WETH", classifyPriceMark(undefined, now)),
    "WETH: price reference missing.",
  );
  assert.equal(
    formatPriceMarkDiagnostic(" ", classifyPriceMark(mark, now)),
    "Token: price reference accepted (age 30s; provider confidence 0.9).",
  );
});

test("an invalid caller clock fails instead of bypassing future or stale checks", () => {
  for (const invalidNow of [
    0,
    -1,
    NaN,
    Infinity,
    now + 0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => classifyPriceMark(mark, invalidNow), RangeError);
  }
});
