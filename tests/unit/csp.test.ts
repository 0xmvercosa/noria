import test from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy } from "../../src/security/csp";

test("production CSP pins trusted wallet resources and requires a nonce for scripts", () => {
  const policy = contentSecurityPolicy("YWJjMTIz");
  const script = policy.split("; ").find((d) => d.startsWith("script-src "))!;
  assert.match(script, /'nonce-YWJjMTIz'/);
  assert.match(script, /'strict-dynamic'/);
  assert.doesNotMatch(script, /unsafe-inline|unsafe-eval|https:/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /https:\/\/auth\.privy\.io/);
  assert.match(policy, /https:\/\/api\.relay\.link/);
  assert.doesNotMatch(policy, /vercel\.app|localhost|127\.0\.0\.1/);
  assert.throws(() => contentSecurityPolicy("abc'; script-src *"));
  assert.match(contentSecurityPolicy("YWJj", true), /'unsafe-eval'/);
});
