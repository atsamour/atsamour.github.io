(() => {
  "use strict";

  const form = document.getElementById("feedback-form");
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const status = document.getElementById("feedback-status");
  const submitButton = form.querySelector("button[type='submit']");
  const sourceInput = document.getElementById("feedback-source");
  const versionInput = document.getElementById("extension-version");

  const params = new URLSearchParams(window.location.search);
  if (sourceInput instanceof HTMLInputElement && params.get("source") === "extension") {
    sourceInput.value = "extension";
  }

  const version = params.get("version") || "";
  if (
    versionInput instanceof HTMLInputElement &&
    /^[0-9A-Za-z._+\-]{1,64}$/.test(version)
  ) {
    versionInput.value = version;
  }

  function showStatus(message, type) {
    if (!(status instanceof HTMLElement)) {
      return;
    }
    status.textContent = message;
    status.className = `feedback-status feedback-status-${type} feedback-field-wide`;
    status.hidden = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) {
      showStatus("Please complete the required fields.", "error");
      return;
    }

    const endpoint = form.dataset.endpoint;
    if (!endpoint) {
      showStatus("The feedback service is not configured yet.", "error");
      return;
    }

    const data = new FormData(form);
    const token = String(data.get("turnstileToken") || "");
    if (!token) {
      showStatus("Please complete the verification step.", "error");
      return;
    }

    const payload = {
      kind: String(data.get("kind") || ""),
      name: String(data.get("name") || ""),
      email: String(data.get("email") || ""),
      subject: String(data.get("subject") || ""),
      message: String(data.get("message") || ""),
      extensionVersion: String(data.get("extensionVersion") || ""),
      source: String(data.get("source") || "website"),
      company: String(data.get("company") || ""),
      turnstileToken: token,
    };

    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.classList.add("is-loading");
      submitButton.querySelector("span").textContent = "Sending…";
    }
    showStatus("Sending your message…", "progress");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let result = {};
      try {
        result = await response.json();
      } catch (_) {
        // A generic error below is safer than displaying an untrusted response body.
      }

      if (!response.ok || result.ok !== true) {
        const message = result?.error?.message || "Your message could not be sent. Please try again.";
        throw new Error(message);
      }

      form.reset();
      if (sourceInput instanceof HTMLInputElement && params.get("source") === "extension") {
        sourceInput.value = "extension";
      }
      if (versionInput instanceof HTMLInputElement && /^[0-9A-Za-z._+\-]{1,64}$/.test(version)) {
        versionInput.value = version;
      }
      window.turnstile?.reset();
      showStatus(`Message received. Your reference is ${result.reference}.`, "success");
    } catch (error) {
      window.turnstile?.reset();
      showStatus(error instanceof Error ? error.message : "Your message could not be sent. Please try again.", "error");
    } finally {
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.classList.remove("is-loading");
        submitButton.querySelector("span").textContent = "Send message";
      }
    }
  });
})();
