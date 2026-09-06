// ============================================
// PROVASPACE — Netlify Function: send-push
// Receives a notification payload, fetches FCM tokens from Firestore,
// and fires OS-level push via Firebase Admin SDK.
//
// Env vars to set in Netlify Dashboard → Site → Environment Variables:
//   FIREBASE_PROJECT_ID       = provaspace-4b8c4
//   FIREBASE_CLIENT_EMAIL     = (from your service account JSON)
//   FIREBASE_PRIVATE_KEY      = (from your service account JSON — include the \n chars)
// ============================================

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');
const { getMessaging }                  = require('firebase-admin/messaging');

// Init once — Netlify may reuse the function instance
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Netlify stores \n as literal \\n in env vars — fix it
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db        = getFirestore();
const messaging = getMessaging();

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Basic shared secret check — set PUSH_SECRET in Netlify env vars too
  const auth = event.headers['x-push-secret'];
  if (auth !== process.env.PUSH_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { userId, role, title, message, link = '/' } = payload;

  try {
    let tokens = [];

    if (userId === 'all') {
      const snap = await db.collection('users').get();
      snap.forEach(d => {
        const t = d.data().fcmTokens;
        if (Array.isArray(t)) tokens.push(...t);
      });
    } else if (role) {
      const snap = await db.collection('users').where('role', '==', role).get();
      snap.forEach(d => {
        const t = d.data().fcmTokens;
        if (Array.isArray(t)) tokens.push(...t);
      });
    } else if (userId) {
      const userSnap = await db.doc(`users/${userId}`).get();
      const t = userSnap.data()?.fcmTokens;
      if (Array.isArray(t)) tokens = t;
    }

    tokens = [...new Set(tokens)];

    if (!tokens.length) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0, reason: 'no tokens' }) };
    }

    // Send in batches of 500 (FCM limit)
    let sent = 0;
    const stale = [];
    const BATCH = 500;

    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH);
      const res = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title, body: message },
        webpush: {
          fcmOptions: { link },
          notification: {
            icon: '/icons/icon-192.svg',
            badge: '/icons/icon-192.svg',
          },
        },
      });

      res.responses.forEach((r, idx) => {
        if (r.success) {
          sent++;
        } else {
          const code = r.error?.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            stale.push(batch[idx]);
          }
        }
      });
    }

    // Clean up stale tokens (fire and forget)
    if (stale.length) {
      const snap = await db.collection('users')
        .where('fcmTokens', 'array-contains-any', stale.slice(0, 10))
        .get();
      snap.forEach(d => {
        d.ref.update({
          fcmTokens: stale.reduce((fv, t) => {
            // Use FieldValue.arrayRemove equivalent via Admin SDK
            return fv;
          }, null),
        });
      });
      // Simpler: rewrite the array without stale tokens
      snap.forEach(async d => {
        const current = d.data().fcmTokens || [];
        const cleaned = current.filter(t => !stale.includes(t));
        await d.ref.update({ fcmTokens: cleaned });
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ sent, staleRemoved: stale.length }),
    };
  } catch (err) {
    console.error('send-push error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};