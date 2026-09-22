# Security

ChemDeck is a static, client-only web app: vanilla HTML, CSS, and JavaScript served from GitHub
Pages, with Google Firebase Authentication for sign-in and Cloud Firestore for storage. There is no
server of our own, no build step, and no third-party code beyond the pinned Firebase SDK modules.

That shape decides the whole threat model. There is no server to compromise, so the security of the
app rests on three things: the Firestore rules (the only real authorization boundary), the
Content-Security-Policy (the only thing standing between injected data and script execution), and
Google's handling of authentication.

## Reporting a vulnerability

Please report privately. Do not open a public GitHub issue for a security problem.

- **Where:** the [ChemDeck feedback form](https://docs.google.com/forms/d/e/1FAIpQLScUP8M6NQgWFrLJnILMcgqaDOjJzO_IBMbGm-C5LzXB8sd2Ug/viewform?usp=dialog),
  which reaches the maintainer directly. Start the message with `SECURITY:` so it is not read as a
  feature request.
- **Include:** what you found, the exact steps to reproduce it, what an attacker gains, and the
  browser and version you used.
- **Expect:** an acknowledgement when the maintainer next reads the form. This is a one-person
  project, so there is no paid bounty and no guaranteed response window.

### Rules of engagement

Testing against your own account is welcome. Do not:

- access, modify, or delete data belonging to any account other than your own;
- run automated scanners, load tests, or anything that degrades the service for other people;
- exploit a finding beyond the minimum needed to demonstrate it;
- publish the finding before it is fixed.

Research that stays inside those lines is considered authorized, and the maintainer will not pursue
it.

### Out of scope

- **The Firebase `apiKey` in `script.js`.** Firebase Web API keys are public identifiers, not
  secrets. They identify the project to Google; they grant nothing on their own. Authorization is
  enforced by the Firestore rules and the Authentication authorized-domains list. Reporting this as
  a leaked credential will be closed as intended behaviour.
- Missing HTTP security headers that GitHub Pages cannot send. See
  [Accepted limitations](#accepted-limitations).
- Self-XSS that requires the victim to paste attacker-supplied code into their own devtools console.
- Vulnerabilities in Google Firebase, Google Fonts, or GitHub Pages themselves. Report those to the
  vendor.
- Findings that require a compromised device or a malicious browser extension.

## Security review, September 2026

A full review of `index.html`, `script.js`, and `firestore.rules` was carried out on 22 September
2026. Everything listed here has been fixed.

### Fixed

| # | Severity | Issue |
|---|----------|-------|
| 1 | High | Stored XSS via the drawing data URL |
| 2 | High | Firestore rules accepted arbitrary strings in the drawing fields |
| 3 | Medium | Unescaped interpolation into modal HTML |
| 4 | Medium | Rich HTML paste into the card editor |
| 5 | Medium | No clickjacking defence |
| 6 | Medium | No account confirmation and no email-verification check |
| 7 | Low | Content-Security-Policy weaker than it needed to be |
| 8 | Low | Profile photo URL used without scheme validation |
| 9 | Low | Raw Firebase error text shown to the user |
| 10 | Low | Silent reuse of the last Google account |
| 11 | Low | Predictable card identifiers |

**1. Stored XSS via the drawing data URL (high).** `renderGrid()` built the card-grid preview with
a template literal:

```js
`<img src="${card.drawFront}" class="grid-card-drawing-preview" alt="Drawing" />`
```

`card.drawFront` is a string read back from Firestore, interpolated into an HTML attribute with no
escaping and no format check. A value containing a double quote closes the `src` attribute early and
lets the rest of the string be parsed as markup, for example an `onerror` handler on the same tag.
Combined with issue 2, which meant Firestore would store any string in that field, this was a
persistent XSS that fires whenever the card grid renders, in the victim's own origin, with their
session live.

Fixed by validating the value against a strict base64 PNG data-URL pattern before it is used, and
HTML-escaping what survives. `loadDrawingToCanvas()` applies the same validator before assigning
`img.src`. There is now one function, `safePngDataUrl()`, through which every drawing value must
pass.

**2. Firestore rules accepted arbitrary strings in the drawing fields (high).** The card rule
checked only `is string` for `drawFront`, `drawBack`, and `scratchpad`, with no length limit and no
format constraint. That is what made issue 1 persistent rather than transient, and it allowed a
single card document to be filled to the Firestore document limit. The rules now require each
drawing field to be empty or to match `data:image/png;base64,[A-Za-z0-9+/]+={0,2}`, capped at
700,000 characters. `saveAllCards()` runs the client-side validator over the same fields before
writing, so a malformed value is dropped locally instead of failing the batch server side.

**3. Unescaped interpolation into modal HTML (medium).** `showConfirm()` and `showDeckModal()` both
assembled their markup by interpolating a title and a message into an `innerHTML` string. Callers
were expected to pre-escape, and mostly did, but the contract was the wrong way round: the safety of
the sink depended on every present and future caller remembering. Both now write static markup and
set the dynamic parts with `textContent`, which cannot produce markup regardless of input. The
callers no longer pre-escape, so escaped entities no longer leak into dialog text either.

**4. Rich HTML paste into the card editor (medium).** The card front and back are
`contenteditable` elements. By default, `contenteditable` inserts the clipboard's `text/html`
flavour directly into the live DOM, so pasting copied content from a web page injected that page's
markup into the app. The persisted value was unaffected (it is read with `innerText`), but the
injected nodes were live in the document until the next render. `paste` and `drop` handlers now take
`text/plain` only and insert it as a text node.

**5. No clickjacking defence (medium).** Nothing stopped the app being framed by another site and
having its controls overlaid. GitHub Pages cannot send an `X-Frame-Options` or `frame-ancestors`
header, so `script.js` now checks `window.top !== window.self` at module load, attempts to break
out, clears the document, and throws before any application code runs.

**6. No account confirmation and no email-verification check (medium).** The app accepted whatever
identity Firebase handed back. Two consequences: on a shared or school computer the browser's cached
Google session signed you straight into somebody else's account, silently, and an identity with an
unverified or absent email address was trusted the same as a verified one. Sign-in now refuses any
account where `emailVerified` is false or `email` is absent, and on first sign-in the app shows the
address and requires explicit confirmation before any data is created. See
[Consent and account confirmation](#consent-and-account-confirmation).

**7. Content-Security-Policy weaker than it needed to be (low).** `default-src` was `'self'`, which
meant any fetch directive not explicitly listed silently fell back to permitting the origin.
`base-uri` was `'self'` rather than `'none'`, and `form-action`, `worker-src`, `manifest-src`, and
`media-src` were absent. The policy is now `default-src 'none'` with every needed directive
enumerated, plus `upgrade-insecure-requests` and a `strict-origin-when-cross-origin` referrer
policy. `terms.html` carries its own, tighter policy.

**8. Profile photo URL used without scheme validation (low).** `user.photoURL` went straight into
`img.src`. It comes from Google and is https in practice, but it is provider-controlled data
reaching a URL sink with no check. It is now parsed and required to be `https:`, with the element
falling back to no image.

**9. Raw Firebase error text shown to the user (low).** Sign-in failures rendered `e.message` into a
toast, exposing internal error strings. The detail now goes to `console.error` and the user sees a
fixed message.

**10. Silent reuse of the last Google account (low).** Without `prompt: 'select_account'`, a browser
with one cached Google session skips the chooser entirely. The provider now always requests the
account chooser, which is the other half of the fix for issue 6.

**11. Predictable card identifiers (low).** Card ids were `Date.now()` plus `Math.random()`.
`Math.random()` is not a CSPRNG and the timestamp is guessable, so ids were predictable. Ids now
come from `crypto.randomUUID()`. This is hardening rather than a live vulnerability: the Firestore
rules scope every card to its owner's uid, so knowing an id grants nothing. Existing ids are left
alone.

## Current controls

### Authentication

- Google sign-in via Firebase Authentication. ChemDeck never handles a password.
- The account chooser is always shown (`prompt: 'select_account'`).
- Accounts without a Google-verified email address are refused and signed out.
- Sign-out clears in-memory state and the rendered sidebar.

### Authorization

Cloud Firestore rules in `firestore.rules` are the only authorization boundary, and they are the
single most important file in the project. They enforce:

- **Ownership.** Every path is scoped to `users/{uid}/…` and requires
  `request.auth.uid == uid`. There is no cross-account read path.
- **Shape.** `keys().hasOnly([...])` on every writable document, so an unexpected field is rejected
  rather than stored.
- **Type and size.** Names are capped at 40 characters, card text at 5,000, drawings at 700,000 and
  constrained to a base64 PNG data URL.
- **Default deny.** A catch-all `match /{document=**} { allow read, write: if false; }` closes
  anything not explicitly matched.

Rules changes only take effect once deployed:

```bash
firebase deploy --only firestore:rules
```

The rules in this repository are ahead of an undeployed project. Deploy them, then confirm in the
Firebase console that the active rules match this file.

### Injection defences

- **CSP.** `default-src 'none'`, `object-src 'none'`, `base-uri 'none'`, with script, style, font,
  image, connect, and frame sources enumerated. No `unsafe-eval`, and no inline `<script>` anywhere
  in the project.
- **One validator per sink.** `safePngDataUrl()` for drawing data, `safeHttpsUrl()` for provider
  URLs, `escHtml()` for text interpolated into markup.
- **Text sinks over HTML sinks.** Dialog text, toasts, user names, and card text all go through
  `textContent` or `innerText`.
- **Plain-text paste** into both `contenteditable` regions.
- **Server-side validation** of the same constraints in the Firestore rules, so a tampered client
  cannot store a value the renderer is not prepared for.

### Transport

HTTPS end to end, enforced by GitHub Pages and reinforced by `upgrade-insecure-requests`. Firestore
traffic goes to Google over TLS.

## Consent and account confirmation

Shown once, on first use, and not again unless the terms change.

1. **Cookie and storage notice.** A blocking screen before anything else in the app is usable. It
   lists everything stored on the device and why. Accepting writes
   `chemdeck-cookie-consent = <terms version>` to local storage. Sign-in is refused until it is
   accepted.
2. **Account confirmation and terms.** After a successful first sign-in, the app displays the
   verified email address Google returned and requires both an explicit confirmation that it is the
   right account and a ticked agreement to the terms. Declining signs the user out. Confirming
   writes `users/{uid}/meta/consent` with `{ termsVersion, acceptedAt }`, mirrored to local storage
   as a cache.

On every later sign-in, the app reads that consent record and skips both screens. The record is
version-stamped: raising `TERMS_VERSION` in `script.js` (and the version shown in `terms.html`)
makes every existing user see the terms and confirm their account once more. The two values must be
kept in step, and both must be changed whenever the terms change materially.

The consent document has its own Firestore rule: only the document id `consent`, only the two
expected fields, only the owning user.

## Accepted limitations

These are known, deliberate, and documented rather than fixed.

- **No `frame-ancestors` or `X-Frame-Options` header.** GitHub Pages serves static files and cannot
  set response headers, and `frame-ancestors` is ignored in a `<meta>` tag. The JavaScript
  frame-buster in `script.js` is the mitigation. A host that can set headers (Firebase Hosting,
  Netlify, Cloudflare Pages) would be strictly better here.
- **`style-src 'unsafe-inline'`.** The app sets inline `style` attributes in several places and
  loads Google Fonts. With every HTML sink now either static or text-only, the residual risk is
  style injection with no script path, which is accepted.
- **No Subresource Integrity on the Firebase SDK.** ES module imports from
  `https://www.gstatic.com/firebasejs/11.4.0/…` cannot carry an `integrity` attribute. The version
  is pinned rather than floating, which is the available mitigation. Review the pin when upgrading.
- **No per-account quota.** Firestore rules can cap the size of a document but not the number of
  documents a user creates. A determined signed-in user can create decks and cards until the project
  hits its Firebase quota. Set budget alerts and daily spend caps in the Google Cloud console.
- **Session persistence is Firebase's default (`browserLocalPersistence`).** A signed-in session
  survives closing the browser. This is deliberate, because the app is a study tool used across
  sessions, but it means signing out matters on a shared device. The terms say so.
- **Client-side deletion only.** Deleting a card issues a Firestore delete from the client. There is
  no server-side job reconciling orphaned subcollections, so a deck deleted while offline can leave
  its cards behind.
- **Maintenance flag is advisory.** `status.json` toggles a maintenance screen in the UI. It is not
  a security control and does not stop Firestore access.

## Checklist when changing this app

- Never interpolate a value into `innerHTML`. Use `textContent`, or escape with `escHtml()` and
  justify why in a comment.
- Any value that reaches `src`, `href`, or `url()` goes through `safePngDataUrl()` or
  `safeHttpsUrl()` first.
- Every new Firestore field needs a matching type, size, and format check in `firestore.rules`, and
  the field must be added to the relevant `keys().hasOnly([...])`.
- Deploy the rules after changing them. An untested rule change is a live authorization change.
- New external origins need a CSP directive. If a resource is blocked, widen the specific directive,
  never `default-src`.
- Changing `terms.html` materially means bumping `TERMS_VERSION` in `script.js` and the version
  string in `terms.html` together.

Last reviewed: 22 September 2026.
