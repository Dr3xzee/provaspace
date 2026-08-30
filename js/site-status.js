// ============================================
// PROVASPACE — Site Status Guard
// Drop into any logged-in page (after firebase.js). Shows a full-screen
// blocking overlay if the user is banned/suspended, or if the platform is
// in maintenance mode (admins are exempt from the maintenance block).
// ============================================

import { auth, db, onAuthStateChanged, doc, onSnapshot, signOut } from './firebase.js';

function injectStyles() {
    if (document.getElementById('siteStatusStyles')) return;
    const style = document.createElement('style');
    style.id = 'siteStatusStyles';
    style.textContent = `
    .ss-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.92);z-index:99999;
      display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Plus Jakarta Sans',sans-serif;}
    .ss-overlay-card{background:var(--bg-card,#fff);border-radius:20px;max-width:420px;width:100%;padding:32px 28px;
      text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4);}
    .ss-overlay-icon{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;
      font-size:26px;margin:0 auto 18px;}
    .ss-overlay-icon.ban{background:rgba(239,68,68,.15);color:#ef4444;}
    .ss-overlay-icon.maint{background:rgba(245,158,11,.15);color:#f59e0b;}
    .ss-overlay-card h2{margin:0 0 10px;color:var(--text-primary,#16213e);font-size:1.2rem;}
    .ss-overlay-card p{color:var(--text-secondary,#64748b);font-size:0.9rem;line-height:1.5;margin:0 0 8px;}
    .ss-overlay-card .ss-meta{font-size:0.78rem;color:var(--text-secondary,#64748b);margin-top:14px;padding-top:14px;border-top:1px solid var(--border-color,rgba(65,105,225,.14));}
    .ss-overlay-btn{margin-top:18px;background:var(--accent-blue,#4169E1);color:#fff;border:none;border-radius:12px;
      padding:11px 22px;font-weight:600;cursor:pointer;font-size:0.85rem;}
    `;
    document.head.appendChild(style);
}

function showOverlay({ kind, title, message, meta, allowLogout = true }) {
    removeOverlay();
    injectStyles();
    const wrap = document.createElement('div');
    wrap.className = 'ss-overlay';
    wrap.id = 'siteStatusOverlay';
    wrap.innerHTML = `
        <div class="ss-overlay-card">
            <div class="ss-overlay-icon ${kind === 'maint' ? 'maint' : 'ban'}">
                <i class="fa-solid ${kind === 'maint' ? 'fa-screwdriver-wrench' : 'fa-ban'}"></i>
            </div>
            <h2>${title}</h2>
            <p>${message}</p>
            ${meta ? `<div class="ss-meta">${meta}</div>` : ''}
            ${allowLogout ? `<button class="ss-overlay-btn" id="siteStatusLogout">Log Out</button>` : ''}
        </div>
    `;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    const btn = document.getElementById('siteStatusLogout');
    if (btn) btn.addEventListener('click', async () => { await signOut(auth); window.location.href = 'login.html'; });
}

function removeOverlay() {
    const el = document.getElementById('siteStatusOverlay');
    if (el) el.remove();
    document.body.style.overflow = '';
}

let maintenanceState = null;
let userState = null;

function evaluate() {
    if (!userState) return;

    if (userState.banned) {
        showOverlay({
            kind: 'ban',
            title: 'Account Banned',
            message: 'Your Provaspace account has been banned and no longer has access to the dashboard.',
            meta: userState.banReason ? `Reason: ${userState.banReason}` : 'Contact support if you believe this is a mistake.',
        });
        return;
    }
    if (userState.suspended) {
        showOverlay({
            kind: 'ban',
            title: 'Account Suspended',
            message: 'Your Provaspace account is temporarily suspended and dashboard access is restricted.',
            meta: userState.suspendReason ? `Reason: ${userState.suspendReason}` : 'This is often related to overdue rent or a policy issue — check your notifications or contact support.',
        });
        return;
    }
    if (maintenanceState?.enabled && !userState.isAdmin) {
        showOverlay({
            kind: 'maint',
            title: 'Down for Maintenance',
            message: maintenanceState.reason || 'Provaspace is currently undergoing scheduled maintenance. Please check back shortly.',
            meta: maintenanceState.fixDate ? `Expected back: ${maintenanceState.fixDate}` : '',
        });
        return;
    }
    removeOverlay();
}

onAuthStateChanged(auth, (user) => {
    if (!user) { removeOverlay(); return; }

    onSnapshot(doc(db, 'users', user.uid), (snap) => {
        userState = snap.exists() ? snap.data() : {};
        evaluate();
    });

    onSnapshot(doc(db, 'settings', 'maintenance'), (snap) => {
        maintenanceState = snap.exists() ? snap.data() : { enabled: false };
        evaluate();
    });
});
