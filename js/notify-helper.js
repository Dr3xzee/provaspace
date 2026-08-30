// ============================================
// PROVASPACE — Notification Helper (shared)
// Writes to `notifications` collection (in-app bell) AND calls the
// Netlify function to fire OS-level push to closed/background devices.
// ============================================

import {
    db, collection, addDoc, query, where, getDocs, serverTimestamp,
} from './firebase.js';

// Your Netlify site URL — no trailing slash
const SITE_URL = 'https://provaspaceapp.netlify.app';
const PUSH_SECRET = 'provaspace'; // must match Netlify PUSH_SECRET env var

async function triggerPush({ userId, role, title, message, link }) {
    try {
        await fetch(`${SITE_URL}/.netlify/functions/send-push`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-push-secret': PUSH_SECRET,
            },
            body: JSON.stringify({ userId, role, title, message, link }),
        });
    } catch (err) {
        // Push failure is non-fatal — in-app notification already written
        console.warn('triggerPush failed:', err);
    }
}

/**
 * Notify a single user.
 */
export async function notifyUser(userId, { title, message, type = 'general', link = '' } = {}) {
    if (!userId) return;
    await addDoc(collection(db, 'notifications'), {
        userId, title, message, type, link,
        read: false, readBy: [], createdAt: serverTimestamp(),
    });
    triggerPush({ userId, title, message, link });
}

/**
 * Broadcast to all users.
 */
export async function notifyAll({ title, message, type = 'broadcast', link = '', createdBy = '' } = {}) {
    await addDoc(collection(db, 'notifications'), {
        userId: 'all', title, message, type, link, createdBy,
        read: false, readBy: [], createdAt: serverTimestamp(),
    });
    triggerPush({ userId: 'all', title, message, link });
}

/**
 * Notify every user with a given role ('freelancer' or 'client').
 */
export async function notifyRole(role, { title, message, type = 'general', link = '' } = {}) {
    try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', role)));
        const writes = [];
        snap.forEach(d => writes.push(
            addDoc(collection(db, 'notifications'), {
                userId: d.id, title, message, type, link,
                read: false, readBy: [], createdAt: serverTimestamp(),
            })
        ));
        await Promise.all(writes);
        // Single push call with role targeting — more efficient than per-user
        triggerPush({ role, title, message, link });
    } catch (err) {
        console.error('notifyRole failed', err);
    }
}

/**
 * Notify specific users by uid list.
 */
export async function notifyUsers(userIds = [], payload = {}) {
    const unique = [...new Set(userIds.filter(Boolean))];
    await Promise.all(unique.map(uid => notifyUser(uid, payload)));
}