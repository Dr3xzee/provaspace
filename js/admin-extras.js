// ============================================
// PROVASPACE — Admin Extras
// Support tickets, withdrawal settings, broadcast notifications, maintenance mode.
// Loaded alongside admin.js (kept separate to avoid touching the existing file too much).
// ============================================

import {
    auth, db, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc,
    collection, query, where, orderBy, getDocs, addDoc, onSnapshot, serverTimestamp,
} from './firebase.js';
import { notifyAll, notifyRole, notifyUser } from './notify-helper.js';

let currentAdmin = null;
let activeTicketUnsub = null;

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
function timeAgo(ts) {
    try {
        const d = ts?.toDate ? ts.toDate() : new Date(ts);
        const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
        return d.toLocaleDateString();
    } catch { return '—'; }
}

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists() || snap.data().isAdmin !== true) return;
        currentAdmin = user;

        watchTickets();
        loadWithdrawalSettings();
        loadMaintenanceSettings();
        wireBroadcastForm();
        wireWithdrawalForm();
        wireMaintenanceForm();
    });

    // ---------- SUPPORT TICKETS ----------
    function watchTickets() {
        const body = document.getElementById('ticketsBody');
        const badge = document.getElementById('ticketBadge');
        const q = query(collection(db, 'supportTickets'), where('status', '==', 'open'));
        onSnapshot(q, (snap) => {
            const tickets = [];
            snap.forEach(d => tickets.push({ id: d.id, ...d.data() }));
            tickets.sort((a, b) => (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));

            const needingReply = tickets.filter(t => t.needsApproval).length;
            if (needingReply > 0) { badge.style.display = 'inline-block'; badge.textContent = needingReply; }
            else badge.style.display = 'none';

            body.innerHTML = tickets.length === 0 ? '<tr><td colspan="5">No open tickets.</td></tr>' : '';
            tickets.forEach(t => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(t.userName)} <span class="badge badge-blue" style="margin-left:4px;">${escapeHtml(t.userRole || '')}</span></td>
                    <td>${escapeHtml(t.subject)} ${t.needsApproval ? '<span class="badge badge-amber" style="margin-left:4px;">Needs reply</span>' : ''}</td>
                    <td><span class="badge badge-green">Open</span></td>
                    <td>${timeAgo(t.lastMessageAt)}</td>
                    <td><button class="table-action-btn" data-open-ticket="${t.id}">Open Chat</button></td>
                `;
                body.appendChild(tr);
            });
            body.querySelectorAll('[data-open-ticket]').forEach(btn => {
                btn.addEventListener('click', () => openTicketChat(btn.dataset.openTicket, tickets.find(t => t.id === btn.dataset.openTicket)));
            });
        }, (err) => {
            console.error(err);
            body.innerHTML = '<tr><td colspan="5">Could not load tickets.</td></tr>';
        });
    }

    function openTicketChat(ticketId, ticket) {
        const box = document.createElement('div');
        box.innerHTML = `
            <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:10px;">
                ${escapeHtml(ticket?.userName)} · ${escapeHtml(ticket?.userRole)} · Subject: ${escapeHtml(ticket?.subject)}
            </p>
            <div class="ticket-chat-window">
                <div class="ticket-chat-body" id="ticketChatBody"><p style="font-size:0.8rem; color:var(--text-secondary);">Loading...</p></div>
                <div class="ticket-chat-input-row">
                    <input type="text" id="ticketChatInput" placeholder="Reply to this ticket...">
                    <button class="table-action-btn" id="ticketChatSend"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
        `;
        showAdminModal(`Ticket — ${ticket?.subject || ''}`, box, null);
        const modalActionBtn = document.getElementById('modalActionBtn');
        modalActionBtn.textContent = 'Close Ticket';
        modalActionBtn.onclick = async () => {
            if (!confirm('Close this ticket? The user will no longer be able to reply in this thread.')) return;
            await updateDoc(doc(db, 'supportTickets', ticketId), { status: 'closed', closedAt: serverTimestamp(), closedBy: currentAdmin.uid });
            await notifyUser(ticket.userId, {
                title: 'Support ticket closed',
                message: `Your ticket "${ticket.subject}" has been closed by an admin.`,
                type: 'ticket_closed',
            });
            document.getElementById('modalOverlay').classList.remove('active');
        };

        if (activeTicketUnsub) activeTicketUnsub();
        const q = query(collection(db, 'supportTickets', ticketId, 'messages'), orderBy('sentAt', 'asc'));
        activeTicketUnsub = onSnapshot(q, (snap) => {
            const chatBody = document.getElementById('ticketChatBody');
            if (!chatBody) return;
            chatBody.innerHTML = '';
            snap.forEach(d => {
                const m = d.data();
                const kind = m.senderRole === 'admin' ? 'admin' : (m.senderRole === 'ai' ? 'ai' : 'user');
                const bubble = document.createElement('div');
                bubble.className = `ticket-chat-bubble ${kind}`;
                bubble.textContent = m.text;
                chatBody.appendChild(bubble);
            });
            chatBody.scrollTop = chatBody.scrollHeight;
        });

        document.getElementById('modalOverlay').addEventListener('click', function onOverlayClick(e) {
            if (e.target.id === 'modalOverlay') {
                if (activeTicketUnsub) { activeTicketUnsub(); activeTicketUnsub = null; }
                document.getElementById('modalOverlay').removeEventListener('click', onOverlayClick);
            }
        });

        async function send() {
            const input = document.getElementById('ticketChatInput');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            await addDoc(collection(db, 'supportTickets', ticketId, 'messages'), {
                senderRole: 'admin', senderId: currentAdmin.uid, text, sentAt: serverTimestamp(),
            });
            await updateDoc(doc(db, 'supportTickets', ticketId), { lastMessageAt: serverTimestamp(), needsApproval: false });
        }
        document.getElementById('ticketChatSend').addEventListener('click', send);
        document.getElementById('ticketChatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    }

    function showAdminModal(title, node, onAction) {
        const modalOverlay = document.getElementById('modalOverlay');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        modalTitle.textContent = title;
        modalBody.innerHTML = '';
        modalBody.appendChild(node);
        modalOverlay.classList.add('active');
        const modalActionBtn = document.getElementById('modalActionBtn');
        modalActionBtn.textContent = 'Okay';
        modalActionBtn.onclick = () => { modalOverlay.classList.remove('active'); if (onAction) onAction(); };
    }

    // ---------- WITHDRAWAL SETTINGS ----------
    async function loadWithdrawalSettings() {
        const snap = await getDoc(doc(db, 'settings', 'withdrawal'));
        const w = snap.exists() ? snap.data() : { minWithdrawal: 2000, maxWithdrawal: 500000, feeType: 'percent', feeValue: 2 };
        document.getElementById('withdrawMin').value = w.minWithdrawal ?? '';
        document.getElementById('withdrawMax').value = w.maxWithdrawal ?? '';
        document.getElementById('withdrawFeeType').value = w.feeType || 'percent';
        document.getElementById('withdrawFeeValue').value = w.feeValue ?? '';
    }

    function wireWithdrawalForm() {
        document.getElementById('saveWithdrawalBtn').addEventListener('click', async () => {
            const data = {
                minWithdrawal: parseFloat(document.getElementById('withdrawMin').value) || 0,
                maxWithdrawal: parseFloat(document.getElementById('withdrawMax').value) || 0,
                feeType: document.getElementById('withdrawFeeType').value,
                feeValue: parseFloat(document.getElementById('withdrawFeeValue').value) || 0,
                updatedAt: new Date(),
            };
            try {
                await setDoc(doc(db, 'settings', 'withdrawal'), data, { merge: true });
                alertModal('Saved', 'Withdrawal settings updated.');
            } catch (err) {
                console.error(err);
                alertModal('Error', 'Could not save withdrawal settings.');
            }
        });
    }

    // ---------- MAINTENANCE ----------
    async function loadMaintenanceSettings() {
        const snap = await getDoc(doc(db, 'settings', 'maintenance'));
        const m = snap.exists() ? snap.data() : { enabled: false, reason: '', fixDate: '' };
        document.getElementById('maintenanceEnabled').checked = !!m.enabled;
        document.getElementById('maintenanceReason').value = m.reason || '';
        document.getElementById('maintenanceFixDate').value = m.fixDate || '';
    }

    function wireMaintenanceForm() {
        document.getElementById('saveMaintenanceBtn').addEventListener('click', async () => {
            const data = {
                enabled: document.getElementById('maintenanceEnabled').checked,
                reason: document.getElementById('maintenanceReason').value.trim(),
                fixDate: document.getElementById('maintenanceFixDate').value || '',
                updatedAt: new Date(),
            };
            try {
                await setDoc(doc(db, 'settings', 'maintenance'), data, { merge: true });
                alertModal('Saved', data.enabled ? 'Maintenance mode is now ON — non-admin users will see the maintenance screen.' : 'Maintenance mode is now OFF.');
            } catch (err) {
                console.error(err);
                alertModal('Error', 'Could not save maintenance settings.');
            }
        });
    }

    // ---------- BROADCAST NOTIFICATIONS ----------
    function wireBroadcastForm() {
        const audienceSelect = document.getElementById('broadcastAudience');
        const emailWrap = document.getElementById('broadcastEmailWrap');
        audienceSelect.addEventListener('change', () => {
            emailWrap.style.display = audienceSelect.value === 'specific' ? 'block' : 'none';
        });

        document.getElementById('sendBroadcastBtn').addEventListener('click', async () => {
            const audience = audienceSelect.value;
            const title = document.getElementById('broadcastTitle').value.trim();
            const message = document.getElementById('broadcastMessage').value.trim();
            if (!title || !message) { alertModal('Missing info', 'Please add a title and a message.'); return; }

            try {
                if (audience === 'all') {
                    await notifyAll({ title, message, createdBy: currentAdmin.uid });
                } else if (audience === 'freelancer' || audience === 'client') {
                    await notifyRole(audience, { title, message, type: 'broadcast' });
                } else {
                    const email = document.getElementById('broadcastEmail').value.trim();
                    if (!email) { alertModal('Missing info', 'Please enter the user\'s email.'); return; }
                    const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
                    if (snap.empty) { alertModal('Not found', 'No user with that email.'); return; }
                    await notifyUser(snap.docs[0].id, { title, message, type: 'broadcast' });
                }
                document.getElementById('broadcastTitle').value = '';
                document.getElementById('broadcastMessage').value = '';
                alertModal('Sent', 'Notification has been sent.');
            } catch (err) {
                console.error(err);
                alertModal('Error', 'Could not send notification.');
            }
        });
    }

    function alertModal(title, msg) {
        const modalOverlay = document.getElementById('modalOverlay');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        const modalActionBtn = document.getElementById('modalActionBtn');
        modalTitle.textContent = title;
        modalBody.innerHTML = `<p>${escapeHtml(msg)}</p>`;
        modalOverlay.classList.add('active');
        modalActionBtn.textContent = 'Okay';
        modalActionBtn.onclick = () => modalOverlay.classList.remove('active');
    }
});
