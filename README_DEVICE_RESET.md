# Device Reset System — What Changed & What You Need To Do

This covers the license-key device reset feature and the full UI redesign added to
the Hemn Mood / TEAM 18-81 panel. Read this before deploying.

## 1. What's in this repo vs. what isn't

This zip contains the **admin panel only** — a static site (`index.html`, `app.js`,
`style.css`) that talks directly to Firestore from the browser. There is no server
code here, and there was none in the original project either.

**Key activation** (the moment a license key gets bound to a phone/device for the
first time) does **not** happen in this repo. Based on the `hwid` field already
existing in your key documents, that binding happens from your SA-MP/Pawn gamemode
or launcher, calling Firestore directly (likely via the REST API). That code lives
outside this zip, so I could not inspect or modify it — but the reset system is
designed so it will keep working with **zero changes**, *as long as it follows the
write pattern described in section 3*.

## 2. New fields on `keys` documents

Every key document now has these fields in addition to what already existed:

| Field | Type | Meaning |
|---|---|---|
| `hwid` | string \| null | *(existing field, unchanged)* currently bound device id |
| `device_bound_at` | timestamp \| null | when the current `hwid` was set |
| `last_seen_at` | timestamp \| null | last time the device validated (update this from your activation/heartbeat code if you have one — the panel displays it but doesn't write it) |
| `reset_count` | number | lifetime resets performed on this key |
| `reset_history` | array of `{reset_at, reset_by, previous_hwid}` | audit trail, newest last |
| `last_reset_at` | timestamp \| null | when the most recent reset happened |

**Existing keys** (created before this update) won't have these fields. The panel
handles that gracefully — missing fields are treated as "0 resets, never reset,
no extra binding metadata" — so **no manual migration is required**. The first time
an old key is reset from the panel, these fields get created on it automatically.

## 3. How reset actually works (and why it can't be bypassed client-side)

The Reset Device button does exactly one thing: it sets `hwid` back to `null` on
that key's document (plus bookkeeping: `reset_count`, `reset_history`,
`last_reset_at`). It does **not** talk to the phone, the game server, or anything
else. Once `hwid` is `null` again, the key is simply back in the same state it was
in before it was ever activated.

That means your activation-side code needs exactly one property to make this whole
system work correctly, and it almost certainly already has it:

> **Activation must only bind a device when `hwid` is currently `null`, and must
> never overwrite an existing non-null `hwid`.**

If your Pawn/launcher activation code already checks "is this key's hwid empty or
does it match mine?" before allowing play — which is the standard way this kind of
license check is written — you need to change nothing. The reset button clearing
`hwid` to `null` is indistinguishable, from the activation code's point of view,
from a brand-new unused key.

### The real security boundary: Firestore Rules

Because this is a client-side Firebase app, **the browser code is not where
security lives** — anyone can open devtools and see every request the panel makes.
That's normal for Firebase; the actual gatekeeper is Firestore Security Rules,
which run on Google's servers and reject writes that don't comply, no matter what
any client (this panel, a modified copy of it, or a direct API call) sends.

I've added `firestore.rules` to this repo with rules that enforce, **server-side**:

- Only signed-in staff (admin or a doc in `/users/{uid}`) can delete keys or read
  the full key list.
- A **reset write** (`hwid` going from non-null to `null`) is only accepted if:
  - at least 24 hours have passed since `last_reset_at`, and
  - `reset_count` is below 3, and
  - `reset_count` is incremented by exactly 1 in the same write.
- A **device-binding write** (`hwid` going from `null` to a non-empty string) is
  only accepted if the key's status is currently `unused`, it isn't expired, and
  the write doesn't touch reset/admin bookkeeping fields. Once `hwid` is set, this
  rule can no longer clear it — only the staff reset path above can.

This is what actually prevents "unlimited automatic resets": even if someone
reverse-engineers the panel and fires raw Firestore writes, the rules reject
resets that violate the cooldown or the lifetime cap.

**Important — these rules are not deployed automatically.** `firebase.json` now
points to `firestore.rules`, so running:

```bash
firebase deploy --only firestore:rules
```

will publish them. If you've never set custom Firestore rules before, your project
may currently be running in a permissive default (or a rule set configured
directly in the Firebase Console) — check the Rules tab in the Firebase Console
for your `vampiric-engine` project before and after deploying, and confirm nothing
else in your project depends on the old rules.

### If your activation code runs with an admin/service-account key

If activation happens via a Firebase Admin SDK (service account) rather than a
normal client SDK call, Firestore Rules are bypassed entirely for that code path —
Admin SDK access ignores rules by design. In that case the rules above still
protect the panel and any other client-facing writes, but the cooldown/limit logic
for the *activation* side would need to be enforced in that server code directly.
I flagged this because I can't see that code from this zip — if it's Admin-SDK
based, tell me and I'll adjust the guidance.

## 4. Panel changes (admin UI)

- **Keys table** — new device/reset icon button per row (disabled with a tooltip
  explaining why, when reset isn't currently allowed — no device linked, cooldown
  active, or lifetime limit reached).
- **Click any key** to open a detail drawer: status, linked device, bound date,
  last seen, created date, first activation, expiry, reset count, last reset time,
  and a reset history list (audit trail, newest 10 shown).
- **Confirmation modal** before every reset (and every delete), showing resets
  used and the cooldown period, so it's an intentional action.
- **Toast notifications** for success/error/warning feedback instead of `alert()`.
- **Loading states**: buttons show a spinner while a request is in flight; the
  keys table shows skeleton rows while loading and a proper empty state with no
  results.
- Full visual redesign — rounded cards, refined typography, smoother modals,
  consistent hover/focus states, and light animation throughout (tab switches,
  card entrances, row entrances, toast slide-in, modal scale/fade).
- Fixed a pre-existing bug where the **Prev** page button didn't actually go back
  a page (it silently reset to page 1). Pagination now tracks page cursors
  properly in both directions.
- Stats now use Firestore's `getCountFromServer` instead of downloading full
  result sets just to count them — cheaper reads as your key count grows.

## 5. Tunable policy constants

At the top of `app.js`:

```js
const RESET_COOLDOWN_HOURS = 24;   // minimum time between resets on the same key
const RESET_MAX_COUNT = 3;         // lifetime resets allowed before needing manual override
```

If you change these, update the matching values in `firestore.rules`
(`duration.value(24, 'h')` and the `< 3` check) so client and server stay in sync —
the client-side check is just for instant UI feedback; the rules are what actually
enforce it.

## 6. Deploying

```bash
firebase deploy --only hosting,firestore:rules
```

(or `firebase deploy` for everything). Nothing about your `.firebaserc` or
hosting config changed other than `firebase.json` now also referencing
`firestore.rules`.
