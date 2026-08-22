import { hasFilledHoneypot, validateFeedback, type FeedbackKind, type FeedbackSubmission } from "./validation";

interface EmailSendResult {
  messageId: string;
}

interface EmailSender {
  send(message: {
    to: string;
    from: string | { email: string; name?: string };
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
  }): Promise<EmailSendResult>;
}

interface Env {
  DB: D1Database;
  EMAIL: EmailSender;
  TURNSTILE_SECRET: string;
  ALLOWED_ORIGINS: string;
  SUPPORT_EMAIL: string;
  FROM_EMAIL: string;
  TURNSTILE_EXPECTED_HOSTNAME: string;
}

interface TurnstileResult {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

const MAX_BODY_BYTES = 16 * 1024;
const FEEDBACK_PATH = "/v1/feedback";

const KIND_LABELS: Record<FeedbackKind, string> = {
  support: "Support question",
  bug: "Bug report",
  feature: "Feature request",
  feedback: "General feedback",
};

function responseHeaders(origin?: string): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function json(data: unknown, status = 200, origin?: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(origin),
  });
}

function errorResponse(status: number, code: string, message: string, origin?: string): Response {
  return json({ ok: false, error: { code, message } }, status, origin);
}

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim().replace(/\/$/u, ""))
      .filter(Boolean),
  );
}

function requestOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin")?.replace(/\/$/u, "") || "";
  return allowedOrigins(env).has(origin) ? origin : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function emailContent(reference: string, submission: FeedbackSubmission): { subject: string; text: string; html: string } {
  const kind = KIND_LABELS[submission.kind];
  const replyAddress = submission.email || "Not provided";
  const name = submission.name || "Not provided";
  const extensionVersion = submission.extensionVersion || "Not provided";
  const subject = `[Arkadios support] ${kind}: ${submission.subject}`;

  const text = [
    "New message received",
    "",
    `Reference: ${reference}`,
    `Type: ${kind}`,
    `Subject: ${submission.subject}`,
    `Name: ${name}`,
    `Reply address: ${replyAddress}`,
    `Source: ${submission.source}`,
    `Extension version: ${extensionVersion}`,
    "",
    submission.message,
  ].join("\n");

  const html = `
    <h1>New message received</h1>
    <table cellpadding="6" cellspacing="0" role="presentation">
      <tr><th align="left">Reference</th><td>${escapeHtml(reference)}</td></tr>
      <tr><th align="left">Type</th><td>${escapeHtml(kind)}</td></tr>
      <tr><th align="left">Subject</th><td>${escapeHtml(submission.subject)}</td></tr>
      <tr><th align="left">Name</th><td>${escapeHtml(name)}</td></tr>
      <tr><th align="left">Reply address</th><td>${escapeHtml(replyAddress)}</td></tr>
      <tr><th align="left">Source</th><td>${escapeHtml(submission.source)}</td></tr>
      <tr><th align="left">Extension version</th><td>${escapeHtml(extensionVersion)}</td></tr>
    </table>
    <h2>Message</h2>
    <p>${escapeHtml(submission.message).replace(/\n/gu, "<br>")}</p>
  `;

  return { subject, text, html };
}

async function verifyTurnstile(request: Request, env: Env, token: string): Promise<boolean> {
  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
  });

  if (!verification.ok) {
    return false;
  }

  const result = (await verification.json()) as TurnstileResult;
  return (
    result.success === true &&
    result.hostname === env.TURNSTILE_EXPECTED_HOSTNAME &&
    result.action === "feedback"
  );
}

async function saveFeedback(env: Env, reference: string, createdAt: string, submission: FeedbackSubmission): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO feedback (
      id, created_at, kind, source, name, email, subject, message,
      extension_version, email_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(
      reference,
      createdAt,
      submission.kind,
      submission.source,
      submission.name,
      submission.email,
      submission.subject,
      submission.message,
      submission.extensionVersion,
    )
    .run();
}

async function updateEmailStatus(
  env: Env,
  reference: string,
  status: "sent" | "failed",
  messageId: string | null,
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE feedback SET email_status = ?, email_message_id = ?, email_error = ? WHERE id = ?",
  )
    .bind(status, messageId, error?.slice(0, 500) || null, reference)
    .run();
}

async function handleFeedback(request: Request, env: Env, origin: string): Promise<Response> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "unsupported_media_type", "Send the request as JSON.", origin);
  }

  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "payload_too_large", "The message is too large.", origin);
  }

  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return errorResponse(413, "payload_too_large", "The message is too large.", origin);
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return errorResponse(400, "invalid_json", "The request body is not valid JSON.", origin);
  }

  // Quietly accept obvious bot submissions so the honeypot does not reveal itself.
  if (hasFilledHoneypot(body)) {
    return json({ ok: true, reference: crypto.randomUUID() }, 202, origin);
  }

  const validation = validateFeedback(body);
  if (!validation.ok) {
    return errorResponse(400, validation.error.code, validation.error.message, origin);
  }

  let turnstileValid = false;
  try {
    turnstileValid = await verifyTurnstile(request, env, validation.value.turnstileToken);
  } catch {
    return errorResponse(503, "verification_unavailable", "Verification is temporarily unavailable. Please try again.", origin);
  }
  if (!turnstileValid) {
    return errorResponse(403, "verification_failed", "Verification failed. Please try again.", origin);
  }

  const reference = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await saveFeedback(env, reference, createdAt, validation.value);
  } catch {
    return errorResponse(503, "storage_unavailable", "Your message could not be saved. Please try again.", origin);
  }

  let notificationSent = false;
  try {
    const content = emailContent(reference, validation.value);
    const result = await env.EMAIL.send({
      to: env.SUPPORT_EMAIL,
      from: { email: env.FROM_EMAIL, name: "Arkadios feedback" },
      replyTo: validation.value.email || undefined,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    notificationSent = true;
    await updateEmailStatus(env, reference, "sent", result.messageId, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    console.error("Feedback email notification failed", { reference, message });
    try {
      await updateEmailStatus(env, reference, "failed", null, message);
    } catch (updateError) {
      console.error("Feedback email status update failed", { reference, updateError });
    }
  }

  return json({ ok: true, reference, notificationSent }, 202, origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ ok: true });
    }

    if (url.pathname !== FEEDBACK_PATH) {
      return errorResponse(404, "not_found", "Not found.");
    }

    const origin = requestOrigin(request, env);
    if (!origin) {
      return errorResponse(403, "origin_not_allowed", "This origin is not allowed.");
    }

    if (request.method === "OPTIONS") {
      const headers = responseHeaders(origin);
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Max-Age", "86400");
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      const headers = responseHeaders(origin);
      headers.set("Allow", "POST, OPTIONS");
      return new Response(JSON.stringify({ ok: false, error: { code: "method_not_allowed", message: "Method not allowed." } }), {
        status: 405,
        headers,
      });
    }

    return handleFeedback(request, env, origin);
  },
} satisfies ExportedHandler<Env>;
