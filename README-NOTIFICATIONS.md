# Notifications & Silver Surfer — setup notes

## What's already wired up (client-side, works out of the box)

- **In-app notification bell** (`js/notifications-ui.js`) — reads the `notifications`
  collection (personal docs where `userId == uid`, plus broadcast docs where
  `userId == 'all'`), shows unread state, marks read on click.
- **Admin → Notifications tab** — broadcast to all users, a role (`freelancer`/`client`),
  or one user by email. Writes into the same `notifications` collection.
- **Triggers already calling the notification helper (`js/notify-helper.js`):**
  - Client posts a gig → all freelancers notified (`js/post-gig.js`)
  - Admin sends a broadcast → target audience notified (`js/admin-extras.js`)
  - New message in a contract chat → the other party notified (`js/contract-detail.js`)
  - Admin closes a support ticket → the ticket's user notified (`js/admin-extras.js`)

## What still needs a server (Cloud Function) — real push delivery

A browser tab can write a Firestore doc, and any *open* tab listening via
`onSnapshot` will show it instantly (that's the in-app bell). But actually
pushing an OS-level notification to a user's phone/desktop when the app is
**closed** requires the Firebase Admin SDK, which can't run in client JS.

Deploy something like this as a Cloud Function (Node.js, `firebase-functions` +
`firebase-admin`), triggered on every new `notifications/{id}` document:

```js
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
admin.initializeApp();

exports.sendPushOnNotification = onDocumentCreated('notifications/{notifId}', async (event) => {
  const n = event.data.data();
  let tokens = [];

  if (n.userId === 'all') {
    const usersSnap = await admin.firestore().collection('users').get();
    usersSnap.forEach(d => { if (d.data().fcmTokens) tokens.push(...d.data().fcmTokens); });
  } else {
    const userSnap = await admin.firestore().doc(`users/${n.userId}`).get();
    tokens = userSnap.data()?.fcmTokens || [];
  }
  if (!tokens.length) return;

  await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: n.title, body: n.message },
    data: { link: n.link || '/' },
  });
});
```

## Firebase config you need to fill in

1. **OpenRouter API key** — `js/silver-surfer.js`, constant `OPENROUTER_API_KEY`.
   Get one at https://openrouter.ai/keys. For production, proxy this call
   through a Cloud Function so the key isn't shipped to the browser.
2. **FCM VAPID key** — `js/push-notifications.js`, constant `FIREBASE_VAPID_KEY`.
   Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
   → generate a key pair.
3. Both `firebase-messaging-sw.js` (root) and `js/push-notifications.js` reuse
   the same public Firebase web config already in `js/firebase.js` — nothing
   else to change there.

## Firestore collections added

- `supportTickets/{id}` — `{ userId, userName, userRole, subject, status: 'open'|'closed', needsApproval, createdAt, lastMessageAt }`
  - `supportTickets/{id}/messages/{id}` — `{ senderRole: 'user'|'admin'|'ai', senderId, text, sentAt }`
- `notifications/{id}` — `{ userId: uid|'all', title, message, type, link, read, readBy: [uid], createdAt }`
- `settings/withdrawal` — `{ minWithdrawal, maxWithdrawal, feeType: 'percent'|'flat', feeValue }`
- `settings/maintenance` — `{ enabled, reason, fixDate }`
- `users/{uid}` gained: `banned` (bool), `fcmTokens` (array)
