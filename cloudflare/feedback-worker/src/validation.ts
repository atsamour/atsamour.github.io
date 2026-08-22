export const FEEDBACK_KINDS = ["support", "bug", "feature", "feedback"] as const;
export const FEEDBACK_SOURCES = ["website", "extension"] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export interface FeedbackSubmission {
  kind: FeedbackKind;
  source: FeedbackSource;
  name: string | null;
  email: string | null;
  subject: string;
  message: string;
  extensionVersion: string | null;
  turnstileToken: string;
}

export interface ValidationError {
  code: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: FeedbackSubmission }
  | { ok: false; error: ValidationError };

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const EXTENSION_VERSION_PATTERN = /^[0-9A-Za-z._+\-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function fail(code: string, message: string): ValidationResult {
  return { ok: false, error: { code, message } };
}

export function hasFilledHoneypot(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }
  return typeof input.company === "string" && input.company.trim().length > 0;
}

export function validateFeedback(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return fail("invalid_body", "The request body must be a JSON object.");
  }

  const kind = stringValue(input.kind);
  if (!kind || !FEEDBACK_KINDS.includes(kind as FeedbackKind)) {
    return fail("invalid_kind", "Choose a valid message type.");
  }

  const source = stringValue(input.source) || "website";
  if (!FEEDBACK_SOURCES.includes(source as FeedbackSource)) {
    return fail("invalid_source", "The message source is not valid.");
  }

  const rawName = stringValue(input.name) || "";
  const name = singleLine(rawName);
  if (name.length > 100 || CONTROL_CHARACTERS.test(name)) {
    return fail("invalid_name", "The name must be 100 characters or fewer.");
  }

  const rawEmail = stringValue(input.email) || "";
  const email = rawEmail.trim().toLowerCase();
  if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) {
    return fail("invalid_email", "Enter a valid email address or leave the field empty.");
  }

  const rawSubject = stringValue(input.subject);
  const subject = rawSubject ? singleLine(rawSubject) : "";
  if (subject.length < 3 || subject.length > 140 || CONTROL_CHARACTERS.test(subject)) {
    return fail("invalid_subject", "The subject must be between 3 and 140 characters.");
  }

  const rawMessage = stringValue(input.message);
  const message = rawMessage ? rawMessage.replace(/\r\n?/gu, "\n").trim() : "";
  if (message.length < 10 || message.length > 5000 || CONTROL_CHARACTERS.test(message)) {
    return fail("invalid_message", "The message must be between 10 and 5,000 characters.");
  }

  const rawExtensionVersion = stringValue(input.extensionVersion) || "";
  const extensionVersion = rawExtensionVersion.trim();
  if (extensionVersion && !EXTENSION_VERSION_PATTERN.test(extensionVersion)) {
    return fail("invalid_extension_version", "The extension version is not valid.");
  }

  const turnstileToken = (stringValue(input.turnstileToken) || "").trim();
  if (!turnstileToken || turnstileToken.length > 2048) {
    return fail("invalid_verification", "Please complete the verification step.");
  }

  return {
    ok: true,
    value: {
      kind: kind as FeedbackKind,
      source: source as FeedbackSource,
      name: name || null,
      email: email || null,
      subject,
      message,
      extensionVersion: extensionVersion || null,
      turnstileToken,
    },
  };
}
