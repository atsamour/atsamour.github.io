# Arkadios feedback service

This Worker is the private backend for the feedback page at
`https://arkadios.me/feedback/`. It accepts support questions, bug reports,
feature requests, and general feedback through one flow:

1. The browser obtains a Cloudflare Turnstile token.
2. The Worker validates the origin, request, and Turnstile token.
3. The message is written to Cloudflare D1.
4. A notification is sent to `support@arkadios.me`.

D1 is the source of truth. A temporary email failure does not lose the original
message; the row remains with `email_status = 'failed'`.

The only public support address is `support@arkadios.me`. The technical sender
`feedback@arkadios.me` is not a mailbox and should not be published as a contact
address.

## What is already configured in the repository

- Worker hostname: `feedback.arkadios.me`
- API route: `POST /v1/feedback`
- Health route: `GET /healthz`
- D1 binding: `DB`
- Email binding: `EMAIL`, restricted to `support@arkadios.me`
- Allowed website origin: `https://arkadios.me`
- Turnstile hostname and action checks: `arkadios.me` and `feedback`
- Request body limit: 16 KiB
- No IP addresses or browser user agents are stored

Cloudflare-generated values are deliberately absent. Complete the setup below
before publishing the form.

## Cost profile

This design is intended to remain on Cloudflare's free tiers for a personal
extension:

- Workers Free currently includes 100,000 requests per day.
- D1 Free currently includes 100,000 rows written and 5 million rows read per
  day, with 5 GB total storage.
- Turnstile Free includes unlimited verification requests.
- Email sent only to a verified destination address is free and excluded from
  the general outbound quota.

Current limits and availability can change, so verify them before launch:

- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/turnstile/plans/>
- <https://developers.cloudflare.com/email-service/platform/limits/>

## D1 explained

### What D1 is

D1 is Cloudflare's managed, serverless SQL database. It uses SQLite's data model
and SQL syntax, but Cloudflare operates the database and connects it directly to
the Worker through the `DB` binding. There is no database server, TCP connection,
password, patching, or always-running instance to manage. The database scales to
zero when unused.

For this service, D1 is deliberately simple: there is one `feedback` table and
the public API can only insert a message or update that message's email-delivery
status. There is no public read, list, edit, or delete endpoint. Reading the
messages requires access to the Cloudflare account through the dashboard or an
authenticated Wrangler session.

The database is the durable source of truth. The order is important:

1. Validate the request and Turnstile token.
2. Insert the feedback row into D1 with `email_status = 'pending'`.
3. Send the notification to `support@arkadios.me`.
4. Update the row to `sent` or `failed`.

If email delivery fails after step 2, the user message is still available in
D1. The website returns a reference for every real submission stored in D1.

### Free-tier limits in practical terms

As of August 2026, the Workers Free plan provides:

| D1 resource | Free allowance | Meaning for this service |
| --- | ---: | --- |
| Rows read | 5,000,000/day | Dashboard and administrative `SELECT` queries are the main source of reads for this service. |
| Rows written | 100,000/day | A submission performs one insert and one email-status update. D1 may count additional writes for primary-key or index maintenance, so each submission consumes a small handful rather than exactly two. |
| Storage | 5 GB/account | Shared by all D1 databases in the Cloudflare account. |
| Size of one database | 500 MB | This service uses one database, so 500 MB is its effective database ceiling on Free. |
| Databases | 10/account | Only one is needed here. |
| Point-in-time recovery | 7 days | Cloudflare Time Travel is always enabled; no backup schedule is required. |

The form limits message text to 5,000 characters and stores only small metadata
around it. Even allowing approximately 10 KB per record for text and database
overhead, a 500 MB database represents many tens of thousands of feedback
messages. Actual capacity depends on message length and SQLite overhead.

D1 counts rows scanned, not only rows returned. For example, a query that scans
10,000 rows but returns 10 consumes 10,000 row reads. This is why administrative
queries in this guide use a small result limit. If the table eventually becomes
large and is queried frequently by date or status, add an index through a new
migration after inspecting the real query pattern; indexes reduce reads but add
storage and write work.

Free limits reset at `00:00 UTC`. If the account reaches the daily read or write
allowance, D1 queries return errors until the reset. Cloudflare does not convert
the Free account into usage-based billing automatically. If the 5 GB account
storage allowance is exhausted, new writes and schema changes stop until data is
removed or the account is upgraded.

Official references:

- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/d1/platform/limits/>

### Data location and security

Feedback can contain personal information, such as a reply email address. For
this deployment, create D1 with the European Union jurisdiction:

```bash
npx wrangler d1 create arkadios-feedback --jurisdiction=eu
```

The jurisdiction must be chosen when the database is created and cannot be
added or changed later. It constrains where the D1 database runs and persists
data. It does not restrict where the Worker itself can receive requests.

If an EU jurisdiction is not required, `--location=weur` is only a Western
Europe placement hint and is not a data-residency guarantee. Do not supply both;
the jurisdiction takes precedence.

Cloudflare documents D1 data as encrypted automatically at rest with AES-256
GCM and encrypted in transit with TLS. No application configuration is needed
to enable those protections. Application-level controls are still required,
which is why this Worker uses prepared SQL statements, validates every field,
does not expose read endpoints, and keeps the Turnstile secret outside Git.

Official references:

- <https://developers.cloudflare.com/d1/configuration/data-location/>
- <https://developers.cloudflare.com/d1/reference/data-security/>

### Local D1 versus production D1

Wrangler maintains two independent databases:

- `--local` uses a disposable development database under `.wrangler/` on this
  computer. It is safe for test data and is ignored by Git.
- `--remote` accesses the real Cloudflare-hosted database. Commands using it can
  change production data immediately.

The checked-in migration is the authoritative schema. Apply it locally while
developing, then apply the same migration remotely before deploying the Worker.
Do not edit an already-applied migration; create a new numbered migration for a
future schema change.

## 1. Put `arkadios.me` on Cloudflare DNS

Cloudflare Email Routing and a Worker custom domain require an active Cloudflare
zone. This does not require moving the Hugo site away from GitHub Pages.

1. In Cloudflare, choose **Add a domain** and enter `arkadios.me`.
2. Let Cloudflare import the current DNS records.
3. Before changing nameservers, confirm that the imported apex record still
   points to GitHub Pages. It should be either the existing GitHub Pages A/AAAA
   records or a flattened CNAME from `arkadios.me` to
   `atsamour.github.io`. Do not create both forms at once.
4. Initially keep the GitHub Pages web record **DNS only** (grey cloud). The
   Worker subdomain will be managed separately by Cloudflare.
5. Copy every unrelated TXT, verification, and mail record before proceeding.
6. At the domain registrar, replace the existing authoritative nameservers with
   the two nameservers Cloudflare provides.
7. Wait until Cloudflare reports the zone as **Active**, then verify
   `https://arkadios.me` still loads and its certificate is valid.

The repository already contains `static/CNAME` with `arkadios.me`; leave that
file in place for GitHub Pages.

## 2. Configure `support@arkadios.me`

Cloudflare Email Routing is a forwarding service, not an inbox. One private
delivery destination is therefore still required, but it never appears on the
site or in the Worker response.

If `arkadios.me` already receives mail through Google Workspace, Fastmail,
Proton Mail, Microsoft 365, or another provider, stop here before enabling Email
Routing: onboarding Email Routing changes the apex MX records. Either keep that
provider and use its mail delivery API, or deliberately migrate mail first.

For a new Cloudflare-routed support address:

1. Go to **Compute > Email Service > Email Routing**.
2. Choose `arkadios.me` and select **Onboard domain**.
3. Allow Cloudflare to add its MX and routing authentication records.
4. Under **Destination addresses**, add the private inbox that will ultimately
   receive support mail. Open the verification message in that inbox.
5. Under **Routing rules**, create this rule:
   - Custom address: `support@arkadios.me`
   - Action: **Send to an email**
   - Destination: the verified private inbox
6. Send a normal test email from a different account to
   `support@arkadios.me` and confirm it arrives.
7. Add `support@arkadios.me` itself under **Destination addresses**. Its
   verification message will pass through the routing rule to the private
   inbox. Verify it there. This makes it eligible as the Worker's fixed,
   allow-listed destination.

The checked-in `send_email` binding only permits messages to
`support@arkadios.me`; users cannot turn this endpoint into an open relay.

## 3. Create the Turnstile widget

1. In the Cloudflare dashboard, open **Turnstile** and select **Add widget**.
2. Name it `arkadios-feedback-production`.
3. Add the hostname `arkadios.me`.
4. Choose the **Managed** widget mode.
5. Create the widget and copy both values:
   - **Sitekey**: public; it goes in the Hugo configuration.
   - **Secret key**: private; it goes into a Worker secret.
6. In the repository, open `hugo.toml` and set:

   ```toml
   [params.feedback]
     endpoint = "https://feedback.arkadios.me/v1/feedback"
     turnstileSiteKey = "YOUR_PUBLIC_SITEKEY"
   ```

Never put the secret key in Hugo, JavaScript, Git, or the extension package.
The Worker checks the returned hostname and the `feedback` action in addition
to checking whether Cloudflare accepted the token.

## 4. Install Wrangler and authenticate

From this directory:

```bash
cd cloudflare/feedback-worker
npm ci
npx wrangler login
npx wrangler whoami
```

The login must use the same Cloudflare account that owns the `arkadios.me`
zone and its Email Routing configuration.

## 5. Create and migrate D1

Create the production database in the EU jurisdiction:

```bash
npx wrangler d1 create arkadios-feedback --jurisdiction=eu
```

Cloudflare prints a `database_id`. Replace the all-zero placeholder in
`wrangler.jsonc` with that ID, then apply the checked-in migration:

```bash
npm run db:migrate:remote
```

Confirm the output says `0001_create_feedback.sql` was applied. Do not deploy
the Worker while the placeholder database ID remains in the configuration.

For local-only D1 development, use:

```bash
npm run db:migrate:local
```

## 6. Add the Turnstile secret

Store the production secret through Wrangler:

```bash
npx wrangler secret put TURNSTILE_SECRET
```

Paste the secret when prompted. Wrangler stores it in Cloudflare; it is never
written to the repository.

For local testing only, copy `.dev.vars.example` to `.dev.vars`. The example
contains Cloudflare's always-pass test secret plus local origin and hostname
checks. Use the matching public test sitekey locally, never on the production
site. A local email binding may be simulated rather than delivered; production
delivery is verified after deployment.

## 7. Validate and deploy the Worker

Run the local checks:

```bash
npm run check
```

Deploy:

```bash
npm run deploy
```

Wrangler will create the `feedback.arkadios.me` DNS record and certificate for
the Worker custom domain. The deployment can fail safely if any of these are
not ready:

- `arkadios.me` is not active in the same Cloudflare account.
- The D1 database ID is still the placeholder.
- `support@arkadios.me` is not a verified Email Service destination.
- Email Routing has not onboarded `arkadios.me` as a routing domain.

After deployment, check the non-sensitive health endpoint:

```bash
curl https://feedback.arkadios.me/healthz
```

Expected response:

```json
{"ok":true}
```

## 8. Build and publish the Hugo site

From the repository root:

```bash
hugo --minify
```

Open `/feedback/` locally or publish the changes through the existing GitHub
Pages workflow. A production Turnstile token can only be tested from an allowed
hostname, so the final end-to-end check should happen on
`https://arkadios.me/feedback/`.

Submit one message with a reply address and one anonymous message. Both should:

- show a reference on the page;
- create a D1 row;
- arrive at `support@arkadios.me`;
- use the submitted email as `Reply-To` when one was provided.

For a full local form test, run `npm run dev` in the Worker directory, then run
Hugo from the repository root with temporary public test values:

```bash
HUGO_PARAMS_FEEDBACK_ENDPOINT=http://localhost:8787/v1/feedback \
HUGO_PARAMS_FEEDBACK_TURNSTILESITEKEY=1x00000000000000000000AA \
hugo server
```

Open `http://localhost:1313/feedback/`. These environment values affect only
that command; they do not modify `hugo.toml`.

## 9. Link the Chrome extension to the hosted form

Open the website form instead of embedding remote Turnstile code in the
extension. This requires no extension host permission:

```js
const feedbackUrl = new URL("https://arkadios.me/feedback/");
feedbackUrl.searchParams.set("source", "extension");
feedbackUrl.searchParams.set("version", chrome.runtime.getManifest().version);
chrome.tabs.create({ url: feedbackUrl.toString() });
```

The page validates the version format and pre-fills it. It does not read the
user's active tab, URL, browsing history, IP address, or user agent.

## Operations

### View usage and database information

In the Cloudflare dashboard, open **D1 SQL Database**, select
`arkadios-feedback`, and use **Metrics > Row Metrics** to see rows read, rows
written, and storage. The dashboard is the easiest way to check whether the
service is approaching a free allowance.

From the Worker directory, basic metadata is also available with:

```bash
npx wrangler d1 info arkadios-feedback
```

This shows the production database identity, version, size, and location. It
does not print the stored feedback rows.

### Inspect recent submissions

Use the D1 console in Cloudflare, or run this read-only query:

```bash
npx wrangler d1 execute arkadios-feedback --remote --command \
  "SELECT id, created_at, kind, subject, email_status FROM feedback ORDER BY created_at DESC LIMIT 50"
```

Open a specific row in the D1 dashboard to read the full message. Avoid putting
message text or user email addresses in shell commands, logs, screenshots, or
issue trackers.

The same read-only query can be run in the Cloudflare D1 console:

```sql
SELECT id, created_at, kind, subject, email_status
FROM feedback
ORDER BY created_at DESC
LIMIT 50;
```

### Find email delivery failures

```sql
SELECT id, created_at, subject, email_error
FROM feedback
WHERE email_status = 'failed'
ORDER BY created_at DESC;
```

The user still sees a successful receipt when D1 saved the submission but the
notification failed. This is intentional: the record is safe and can be handled
from D1.

### Export a private copy

Export the schema and data with Wrangler:

```bash
npx wrangler d1 export arkadios-feedback --remote --output=/private/path/arkadios-feedback.sql
```

The export contains message bodies and reply email addresses. Write it only to
an encrypted private location, never place it inside this repository, and remove
it when it is no longer required. To export only the non-sensitive schema, use:

```bash
npx wrangler d1 export arkadios-feedback --remote --output=/private/path/arkadios-feedback-schema.sql --no-data
```

Cloudflare's import/export reference is here:
<https://developers.cloudflare.com/d1/best-practices/import-export-data/>.

### Recovery and Time Travel

Cloudflare Time Travel is automatically enabled and free. On Workers Free it
can restore the database to a point within the previous seven days. Inspect the
current recovery bookmark without changing anything:

```bash
npx wrangler d1 time-travel info arkadios-feedback
```

To inspect the available bookmark for a particular time:

```bash
npx wrangler d1 time-travel info arkadios-feedback --timestamp="2026-08-22T10:00:00+00:00"
```

A Time Travel restore overwrites the production database and cancels in-flight
queries. Treat it as an emergency recovery operation: export the current state,
read Cloudflare's restore instructions, confirm the timestamp and database, and
only then approve the interactive restore. See:
<https://developers.cloudflare.com/d1/reference/time-travel/>.

### Data retention

The service does not automatically delete feedback because no retention period
has been chosen. Decide on a policy before launch (for example, delete resolved
messages after 12 months), document it in the site's privacy information, and
perform deletions by exact feedback ID or an explicitly reviewed cutoff date.

### Add another website origin

`ALLOWED_ORIGINS` is a comma-separated exact allow-list. For example:

```json
"ALLOWED_ORIGINS": "https://arkadios.me,https://www.arkadios.me"
```

Also add the hostname to the Turnstile widget. Do not use a wildcard. CORS is a
browser boundary, not authentication; Turnstile server validation remains
mandatory.

## Data model

Each D1 row stores:

- generated reference and UTC creation time;
- type and source;
- optional name and reply email;
- subject and message;
- optional extension version;
- email delivery state, Cloudflare message ID, or delivery error.

It deliberately does not store IP addresses, user agents, page URLs, extension
installation IDs, passwords, attachments, or arbitrary diagnostic data.

## Launch checklist

- [ ] `arkadios.me` is active on Cloudflare DNS and GitHub Pages still loads.
- [ ] Existing MX records were reviewed before enabling Email Routing.
- [ ] `support@arkadios.me` forwards successfully and is a verified destination.
- [ ] The Turnstile widget allows `arkadios.me` and uses Managed mode.
- [ ] The public Turnstile sitekey is present in `hugo.toml`.
- [ ] The private Turnstile secret was added with `wrangler secret put`.
- [ ] D1 was created with `--jurisdiction=eu` and its real ID replaced the placeholder.
- [ ] `npm run db:migrate:remote` completed successfully.
- [ ] `npm run check` passes.
- [ ] `npm run deploy` completed and `/healthz` returns `{"ok":true}`.
- [ ] The Hugo site was published through the existing GitHub Pages workflow.
- [ ] One anonymous and one reply-enabled production submission reached D1 and email.
- [ ] A retention period for resolved feedback has been chosen and documented.
