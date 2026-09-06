// ============================================
// PROVASPACE — Firebase Messaging Service Worker
// Handles push notifications when the app is NOT in the foreground.
// Must live at the site root (same scope as sw.js) so the browser can
// register it against '/firebase-messaging-sw.js'.
// ============================================

importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// Same public web config as js/firebase.js (Firebase web config is not a secret).
firebase.initializeApp({
    apiKey: "AIzaSyD1HbZeZU4WEcYcIeSyd_iZzApiaJ6YDSI",
    authDomain: "provaspace-4b8c4.firebaseapp.com",
    projectId: "provaspace-4b8c4",
    storageBucket: "provaspace-4b8c4.firebasestorage.app",
    messagingSenderId: "664218621918",
    appId: "1:664218621918:web:903dd6f770233b0ea4ef4f",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || 'Provaspace';
    const options = {
        body: payload.notification?.body || '',
        icon: '/icons/icon-192.svg',
        badge: '/icons/icon-192.svg',
        data: { link: payload.data?.link || '/' },
    };
    self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = event.notification.data?.link || '/';
    event.waitUntil(clients.openWindow(link));
});
