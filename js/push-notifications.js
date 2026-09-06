// ============================================
// PROVASPACE — Push Notifications (Firebase Cloud Messaging)
// Registers the messaging service worker, requests permission, and saves
// the device's FCM token onto the user doc so a server-side function can
// target it. Swap FIREBASE_VAPID_KEY for your real "Web Push certificate"
// key from Firebase Console > Project Settings > Cloud Messaging.
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js';
import { db, doc, updateDoc, arrayUnion } from './firebase.js';

// Same public web config as js/firebase.js (Firebase web config is not a secret).
const firebaseConfig = {
    apiKey: "AIzaSyD1HbZeZU4WEcYcIeSyd_iZzApiaJ6YDSI",
    authDomain: "provaspace-4b8c4.firebaseapp.com",
    projectId: "provaspace-4b8c4",
    storageBucket: "provaspace-4b8c4.firebasestorage.app",
    messagingSenderId: "664218621918",
    appId: "1:664218621918:web:903dd6f770233b0ea4ef4f",
};

const FIREBASE_VAPID_KEY = 'BNI-me2SMYTiOhnIY9mHdJGuB8RmecyHgQffcjnsNHrtPFmDzsFfyO1SRPfJ9ZIrhQjWy0wDT-wWVMrR_1M1UcI';

let messagingApp = null;
function getMessagingInstance() {
    if (!messagingApp) messagingApp = initializeApp(firebaseConfig, 'messaging-app');
    return getMessaging(messagingApp);
}

export async function initPush(uid) {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return false;

        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const messaging = getMessagingInstance();
        const token = await getToken(messaging, { vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
        if (!token) return false;

        await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) });

        onMessage(messaging, (payload) => {
            // Foreground message — show a lightweight in-page notification.
            if (Notification.permission === 'granted') {
                new Notification(payload.notification?.title || 'Provaspace', {
                    body: payload.notification?.body || '',
                    icon: 'icons/icon-192.svg',
                });
            }
        });

        return true;
    } catch (err) {
        console.error('initPush failed', err);
        return false;
    }
}
