// ============================================
// PROVASPACE — Notification Helper (shared)
// Writes to the `notifications` collection. The in-app bell reads this
// collection directly. Actual OS/PWA push delivery to *other* devices
// requires a server (Cloud Function) triggered on document create — see
// README-NOTIFICATIONS.md for the trigger you need to deploy. This file
// only handles the in-app + "push to this same open tab" side.
// ============================================

import {
    db, collection, addDoc, query, where, getDocs, serverTimestamp,
} from './firebase.js';

/**
 * Create a notification for a single user.
 */
export async function notifyUser(userId, { title, message, type = 'general', link = '' } = {}) {
    if (!userId) return;
    return addDoc(collection(db, 'notifications'), {
        userId, title, message, type, link,
        read: false,
        readBy: [],
        createdAt: serverTimestamp(),
    });
}

/**
 * Create one notification document visible to everyone (userId: 'all').
 * Per-user read state is tracked via the `readBy` array.
 */
export async function notifyAll({ title, message, type = 'broadcast', link = '', createdBy = '' } = {}) {
    return addDoc(collection(db, 'notifications'), {
        userId: 'all', title, message, type, link, createdBy,
        read: false,
        readBy: [],
        createdAt: serverTimestamp(),
    });
}

/**
 * Notify every user with a given role (e.g. 'freelancer' or 'client').
 * Writes one doc per matching user — fine for MVP scale.
 */
export async function notifyRole(role, { title, message, type = 'general', link = '' } = {}) {
    try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', role)));
        const writes = [];
        snap.forEach(d => {
            writes.push(notifyUser(d.id, { title, message, type, link }));
        });
        await Promise.all(writes);
    } catch (err) {
        console.error('notifyRole failed', err);
    }
}

/**
 * Notify specific users by uid list (e.g. both parties on a contract).
 */
export async function notifyUsers(userIds = [], payload = {}) {
    const unique = [...new Set(userIds.filter(Boolean))];
    await Promise.all(unique.map(uid => notifyUser(uid, payload)));
}
