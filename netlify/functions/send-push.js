// netlify/functions/send-push.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
    });
}

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-push-secret',
};

exports.handler = async (event) => {
    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
    }

    const authHeader = event.headers['x-push-secret'];
    if (authHeader !== process.env.PUSH_SHARED_SECRET) {
        return { statusCode: 401, headers: CORS_HEADERS, body: 'Unauthorized' };
    }

    try {
        const { tokens, title, body, data } = JSON.parse(event.body);
        if (!Array.isArray(tokens) || tokens.length === 0) {
            return { statusCode: 400, headers: CORS_HEADERS, body: 'No tokens provided' };
        }

        const message = {
            notification: { title: title || 'Provaspace', body: body || '' },
            data: data || {},
            tokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);

        const badTokens = [];
        response.responses.forEach((res, i) => {
            if (!res.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(res.error?.code)) {
                badTokens.push(tokens[i]);
            }
        });

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({ successCount: response.successCount, failureCount: response.failureCount, badTokens }),
        };
    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};