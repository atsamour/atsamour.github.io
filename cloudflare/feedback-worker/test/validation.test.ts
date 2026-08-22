import assert from "node:assert/strict";
import test from "node:test";
import { hasFilledHoneypot, validateFeedback } from "../src/validation.ts";

const validSubmission = {
  kind: "feature",
  source: "extension",
  name: " Ada Lovelace ",
  email: " ADA@EXAMPLE.COM ",
  subject: " Keyboard shortcuts ",
  message: "Please add configurable keyboard shortcuts.",
  extensionVersion: "1.4.2",
  turnstileToken: "verified-token",
};

test("accepts and normalizes a complete submission", () => {
  const result = validateFeedback(validSubmission);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, "Ada Lovelace");
    assert.equal(result.value.email, "ada@example.com");
    assert.equal(result.value.subject, "Keyboard shortcuts");
  }
});

test("accepts anonymous feedback", () => {
  const result = validateFeedback({
    ...validSubmission,
    name: "",
    email: "",
    extensionVersion: "",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, null);
    assert.equal(result.value.email, null);
    assert.equal(result.value.extensionVersion, null);
  }
});

test("rejects an unsupported message type", () => {
  const result = validateFeedback({ ...validSubmission, kind: "sales" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "invalid_kind");
  }
});

test("rejects malformed email addresses", () => {
  const result = validateFeedback({ ...validSubmission, email: "not-an-email" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "invalid_email");
  }
});

test("rejects an oversized message", () => {
  const result = validateFeedback({ ...validSubmission, message: "x".repeat(5001) });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "invalid_message");
  }
});

test("detects a filled honeypot", () => {
  assert.equal(hasFilledHoneypot({ company: "spam corp" }), true);
  assert.equal(hasFilledHoneypot({ company: "" }), false);
});
