// ============================================
// PROVASPACE — Cloud Functions
// Handles OS-level push notifications via FCM.
// Deploy: cd functions && npm install
//         cd .. && firebase deploy --only functions
// ============================================

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1' });

// ── Triggered whenever a new doc lands in notifications/{notifId} ──
// Covers all cases: gig posted, contract message, admin broadcast, dispute update, etc.
// The client-side notify-helper.js already writes these docs — nothing extra needed there.
exports.sendPushOnNotification = onDocumentCreated('notifications/{notifId}', async (event) => {
  const n = event.data.data();
  if (!n) return;

  const title   = n.title   || 'Provaspace';
  const body    = n.message || '';
  const link    = n.link    || '/';

  let tokens = [];

  try {
    if (n.userId === 'all') {
      // Broadcast — gather every user's FCM tokens
      const snap = await admin.firestore().collection('users').get();
      snap.forEach(d => {
        const t = d.data().fcmTokens;
        if (Array.isArray(t)) tokens.push(...t);
      });
    } else if (n.role) {
      // Role-targeted (e.g. userId === 'freelancer' or 'client')
      const snap = await admin.firestore()
        .collection('users')
        .where('role', '==', n.role)
        .get();
      snap.forEach(d => {
        const t = d.data().fcmTokens;
        if (Array.isArray(t)) tokens.push(...t);
      });
    } else {
      // Single user
      const userSnap = await admin.firestore().doc(`users/${n.userId}`).get();
      const t = userSnap.data()?.fcmTokens;
      if (Array.isArray(t)) tokens = t;
    }

    // Dedupe tokens
    tokens = [...new Set(tokens)];
    if (!tokens.length) {
      console.log(`No FCM tokens for notif ${event.params.notifId} — skipping push`);
      return;
    }

    // FCM v1 sendEachForMulticast (batches of 500 max)
    const BATCH = 500;
    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH);
      const res = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        webpush: {
          fcmOptions: { link },
          notification: {
            icon: '/icons/icon-192.svg',
            badge: '/icons/icon-192.svg',
          },
        },
      });

      // Clean up stale/invalid tokens from Firestore
      const staleBatch = [];
      res.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            staleBatch.push(batch[idx]);
          }
          console.warn(`FCM error for token[${i + idx}]:`, r.error?.message);
        }
      });

      // Remove stale tokens from user docs
      if (staleBatch.length) {
        const usersSnap = await admin.firestore()
          .collection('users')
          .where('fcmTokens', 'array-contains-any', staleBatch.slice(0, 10)) // Firestore limit
          .get();
        const writes = [];
        usersSnap.forEach(d => {
          writes.push(
            d.ref.update({
              fcmTokens: admin.firestore.FieldValue.arrayRemove(...staleBatch),
            })
          );
        });
        await Promise.all(writes);
        console.log(`Removed ${staleBatch.length} stale token(s)`);
      }
    }

    console.log(`Push sent for notif ${event.params.notifId} to ${tokens.length} token(s)`);
  } catch (err) {
    console.error('sendPushOnNotification error:', err);
  }
});