# Provaspace — v2 (Functional Build)

This version is wired to real Firestore reads/writes and a real Paystack checkout flow (client-side popup). It is **not production-hardened** — see the TODOs below and in `firestore.rules` before this touches real money.

## Colors
Primary `#4169E1` (royal blue), Secondary `#FFFFFF`. Default theme is light/brand; dark mode toggle available (adds `.dark-theme` to `<body>`).

## What's real now
- **Auth**: signup creates a real `users/{uid}` doc with role (`freelancer`/`client`), free first rent month for freelancers, login redirects by role (`freelancer` → `index.html`, `client` → `client-dashboard.html`, `isAdmin: true` → `admin.html`)
- **Freelancer dashboard**: pulls live rent status, profile completion %, trust score, open gigs feed (Firestore query), active contracts (Firestore query)
- **Claiming a gig**: real Firestore transaction — checks profile complete, checks 3-active-job limit, atomically flips gig to `claimed` and creates a `contracts` doc, starts the timer
- **Client dashboard**: live tax pass status, active contracts, milestone payment release (updates contract + client's totalSpent)
- **Post a Gig**: dynamic milestone builder (must total 100%), insurance toggle pulling live fee % from `settings/prices`, blocks posting if tax pass has 0 gigs remaining, real Paystack popup for deposit + insurance fee
- **Rent payment**: real Paystack popup, updates `rentStatus` on success
- **Tax pass purchase**: real Paystack popup, sets tier/gigLimit/gigsRemaining
- **Admin dashboard** (`admin.html`): overview stats, full price editor (rent tiers, grace period, overdue fee, insurance %, tax pass tiers — add/remove), pending NIN/CAC verification queues with one-click verify, disputes list with resolve action, overdue rents list with suspend/reminder actions, full user list with suspend/unsuspend

## Paystack
`js/paystack.js` has a placeholder public key:
```js
export const PAYSTACK_PUBLIC_KEY = "pk_test_TODO_REPLACE_WITH_YOUR_PAYSTACK_PUBLIC_KEY";
```
Replace with your real test/live public key. **Read the comment in that file** — Paystack's client-side popup only confirms the *card charge*. You still need a backend (Cloud Function) that calls Paystack's `/transaction/verify` endpoint with your **secret key** before trusting any payment and updating balances for real. Everywhere this scaffold updates Firestore right after a Paystack popup resolves, it's flagged `TODO: verify server-side` — that's the part that isn't safe to ship as-is.

## Admin access
There's no self-serve admin signup (correctly — you don't want that). To get into `admin.html` during development:
1. Sign up a normal account through `signup.html`
2. In the Firebase console, open that user's doc under `users/{uid}` and manually set `isAdmin: true`
3. Log in again — you'll be redirected to `admin.html`

## Known gaps (still TODO, flagged inline in code)
- Withdrawals (needs Paystack Transfers API — requires a backend/secret key, can't be pure client-side)
- Real-time chat per contract (subcollection `contracts/{id}/messages` — structure is noted in comments, not built)
- NIN/CAC automated verification (currently manual admin approve button — no third-party KYC API wired)
- Full contract detail view / countdown timer / abandon-job flow
- Assurance claim flow tied to disputes (dispute resolution currently just flips status, doesn't move money)
- Profile edit page (`profile.html` doesn't exist yet — button shows a TODO modal)
- Everything flagged `TODO: verify server-side` — money-moving actions need a Cloud Functions layer, not client-side trust

## File structure
```
provaspace/
├── index.html               → freelancer dashboard
├── client-dashboard.html    → client dashboard
├── post-gig.html            → gig posting form
├── admin.html                → Space God admin panel
├── signup.html / login.html
├── firestore.rules          → starting-point security rules (see TODOs inside)
├── css/style.css
└── js/
    ├── firebase.js           → your real Firebase config is already in here
    ├── paystack.js            → Paystack popup helper, public key TODO
    ├── auth.js
    ├── dashboard.js
    ├── client-dashboard.js
    ├── post-gig.js
    └── admin.js
```

## Next steps (priority order)
1. Drop in your real Paystack public key in `js/paystack.js`
2. Deploy `firestore.rules` (after tightening per the TODOs inside it)
3. Stand up a Cloud Function for Paystack webhook verification + any Firestore write that moves money
4. Build `profile.html` (freelancer) and a company-profile equivalent for clients
5. Build the chat subcollection + UI
6. Wire a real KYC provider for NIN/CAC auto-verification (currently manual admin approval)
