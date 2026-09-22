// netlify/functions/send-push.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');
const { getMessaging }                  = require('firebase-admin/messaging');

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db        = getFirestore();
const messaging = getMessaging();

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-push-secret',
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  const auth = event.headers['x-push-secret'];
  if (auth !== process.env.PUSH_SECRET) {
    return { statusCode: 401, headers: CORS, body: 'Unauthorized' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: 'Invalid JSON' };
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
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ sent: 0, reason: 'no tokens' }) };
    }

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

    // Clean up stale tokens
    if (stale.length) {
      const snap = await db.collection('users')
        .where('fcmTokens', 'array-contains-any', stale.slice(0, 10))
        .get();
      snap.forEach(async d => {
        const current = d.data().fcmTokens || [];
        const cleaned = current.filter(t => !stale.includes(t));
        await d.ref.update({ fcmTokens: cleaned });
      });
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent, staleRemoved: stale.length }),
    };
  } catch (err) {
    console.error('send-push error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};