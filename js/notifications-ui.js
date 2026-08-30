// ============================================
// PROVASPACE — Notification Bell Dropdown (shared)
// Call initNotificationBell() from a page after auth resolves. Wires up
// the existing #notificationsBtn / #notifDot elements already in the
// dashboard headers into a real dropdown, listening for both personal
// (userId == uid) and broadcast (userId == 'all') notifications.
// ============================================

import {
    db, collection, query, where, onSnapshot, doc, updateDoc, arrayUnion, orderBy, limit,
} from './firebase.js';
import { initPush } from './push-notifications.js';

function injectStyles() {
    if (document.getElementById('notifBellStyles')) return;
    const style = document.createElement('style');
    style.id = 'notifBellStyles';
    style.textContent = `
    #notifDropdown{position:absolute;top:52px;right:0;width:320px;max-width:88vw;max-height:420px;overflow-y:auto;
      background:var(--bg-card,#fff);border:1px solid var(--border-color,rgba(65,105,225,.14));border-radius:14px;
      box-shadow:0 16px 40px rgba(0,0,0,.18);z-index:500;display:none;}
    #notifDropdown.open{display:block;}
    .notif-item{padding:12px 14px;border-bottom:1px solid var(--border-color,rgba(65,105,225,.1));cursor:pointer;}
    .notif-item:last-child{border-bottom:none;}
    .notif-item:hover{background:var(--bg-card-hover,#eef1fc);}
    .notif-item.unread{background:rgba(65,105,225,.06);}
    .notif-item h5{margin:0 0 3px;font-size:0.82rem;color:var(--text-primary,#16213e);}
    .notif-item p{margin:0;font-size:0.76rem;color:var(--text-secondary,#64748b);line-height:1.4;}
    .notif-item .notif-time{font-size:0.68rem;color:var(--text-secondary,#64748b);margin-top:4px;display:block;}
    .notif-empty{padding:26px 14px;text-align:center;font-size:0.8rem;color:var(--text-secondary,#64748b);}
    .notif-enable-push{margin:8px 12px;font-size:0.72rem;padding:7px 10px;border-radius:10px;border:1px dashed var(--border-color,rgba(65,105,225,.3));
      background:transparent;color:var(--accent-blue,#4169E1);cursor:pointer;width:calc(100% - 24px);}
    `;
    document.head.appendChild(style);
}

function timeAgo(ts) {
    try {
        const d = ts?.toDate ? ts.toDate() : new Date(ts);
        const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
        return d.toLocaleDateString();
    } catch { return ''; }
}

export function initNotificationBell(uid) {
    injectStyles();
    const btn = document.getElementById('notificationsBtn');
    const dot = document.getElementById('notifDot');
    if (!btn) return;
    btn.style.position = 'relative';

    const dropdown = document.createElement('div');
    dropdown.id = 'notifDropdown';
    dropdown.innerHTML = `<button class="notif-enable-push" id="notifEnablePush"><i class="fa-solid fa-bell"></i> Enable push notifications</button><div id="notifList"></div>`;
    btn.appendChild(dropdown);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('notifEnablePush').addEventListener('click', async () => {
        const ok = await initPush(uid);
        showToastInline(ok ? 'Push notifications enabled.' : 'Could not enable push notifications.');
    });

    let personal = [];
    let broadcast = [];

    function render() {
        const all = [...personal, ...broadcast].sort((a, b) => (b._ts || 0) - (a._ts || 0)).slice(0, 25);
        const list = document.getElementById('notifList');
        if (!list) return;
        if (all.length === 0) {
            list.innerHTML = '<div class="notif-empty">You\'re all caught up.</div>';
            dot.style.display = 'none';
            return;
        }
        list.innerHTML = '';
        let hasUnread = false;
        all.forEach(n => {
            const isRead = n.userId === 'all' ? (n.readBy || []).includes(uid) : !!n.read;
            if (!isRead) hasUnread = true;
            const item = document.createElement('div');
            item.className = 'notif-item' + (isRead ? '' : ' unread');
            item.innerHTML = `<h5>${escapeHtml(n.title || 'Notification')}</h5><p>${escapeHtml(n.message || '')}</p><span class="notif-time">${timeAgo(n.createdAt)}</span>`;
            item.addEventListener('click', async () => {
                try {
                    if (n.userId === 'all') {
                        await updateDoc(doc(db, 'notifications', n.id), { readBy: arrayUnion(uid) });
                    } else if (!n.read) {
                        await updateDoc(doc(db, 'notifications', n.id), { read: true });
                    }
                } catch (err) { console.error(err); }
                if (n.link) window.location.href = n.link;
            });
            list.appendChild(item);
        });
        dot.style.display = hasUnread ? 'block' : 'none';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    onSnapshot(query(collection(db, 'notifications'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(25)), (snap) => {
        personal = []; snap.forEach(d => personal.push({ id: d.id, ...d.data(), _ts: d.data().createdAt?.toMillis?.() || 0 })); render();
    }, () => {
        // fallback if composite index missing — no orderBy
        onSnapshot(query(collection(db, 'notifications'), where('userId', '==', uid)), (snap) => {
            personal = []; snap.forEach(d => personal.push({ id: d.id, ...d.data(), _ts: d.data().createdAt?.toMillis?.() || 0 })); render();
        });
    });

    onSnapshot(query(collection(db, 'notifications'), where('userId', '==', 'all'), orderBy('createdAt', 'desc'), limit(25)), (snap) => {
        broadcast = []; snap.forEach(d => broadcast.push({ id: d.id, ...d.data(), _ts: d.data().createdAt?.toMillis?.() || 0 })); render();
    }, () => {
        onSnapshot(query(collection(db, 'notifications'), where('userId', '==', 'all')), (snap) => {
            broadcast = []; snap.forEach(d => broadcast.push({ id: d.id, ...d.data(), _ts: d.data().createdAt?.toMillis?.() || 0 })); render();
        });
    });
}

function showToastInline(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#16213e;color:#fff;padding:10px 18px;border-radius:10px;font-size:0.8rem;z-index:99999;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}
