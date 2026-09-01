// ============================================
// PROVASPACE — Admin Extras
// Support tickets, withdrawal settings, broadcast notifications, maintenance mode.
// Loaded alongside admin.js (kept separate to avoid touching the existing file too much).
// ============================================

import {
    auth, db, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, query, where, orderBy, getDocs, addDoc, onSnapshot, serverTimestamp, limit,
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
        watchRecentNotifications();
        wireWithdrawalForm();
        wireMaintenanceForm();
        watchWithdrawalRequests();
        watchMilestoneReleaseRequests();
        loadReferralSettings();
        wireReferralForm();
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
    // ---------- RECENT NOTIFICATIONS (admin delete) ----------
    function watchRecentNotifications() {
        const container = document.getElementById('recentNotificationsContainer');
        if (!container) return;

        const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(50));
        onSnapshot(q, (snap) => {
            if (snap.empty) {
                container.innerHTML = '<p style="font-size:0.85rem; color:var(--text-secondary);">No notifications sent yet.</p>';
                return;
            }
            container.innerHTML = '';
            snap.forEach(d => {
                const n = { id: d.id, ...d.data() };
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color); gap:12px;';
                const target = n.userId === 'all' ? '📢 All users' : n.role ? `👥 ${n.role}s` : `👤 ${n.userId.slice(0,8)}...`;
                const time = n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString() : '—';
                row.innerHTML = `
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:0.85rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(n.title || '—')}</div>
                        <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">${target} · ${time}</div>
                        <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(n.message || '')}</div>
                    </div>
                    <button class="table-action-btn" style="background:rgba(239,68,68,0.12); color:#ef4444; flex-shrink:0;" data-delete-notif="${n.id}">Delete</button>
                `;
                container.appendChild(row);
            });

            container.querySelectorAll('[data-delete-notif]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Delete this notification? It will be removed for all recipients.')) return;
                    try {
                        await deleteDoc(doc(db, 'notifications', btn.dataset.deleteNotif));
                    } catch (err) {
                        console.error(err);
                        alertModal('Error', 'Could not delete notification.');
                    }
                });
            });
        });
    }

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

    // ---------- WITHDRAWAL REQUESTS ----------
    function watchWithdrawalRequests() {
        const body = document.getElementById('withdrawalRequestsBody');
        if (!body) return;
        const q = query(collection(db, 'withdrawals'), where('status', '==', 'pending'), orderBy('requestedAt', 'desc'));
        onSnapshot(q, (snap) => {
            body.innerHTML = snap.empty ? '<tr><td colspan="6">No pending withdrawal requests.</td></tr>' : '';
            snap.forEach(d => {
                const w = { id: d.id, ...d.data() };
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(w.bankAccountName || '—')}</td>
                    <td>${escapeHtml(w.bankName || '—')}</td>
                    <td>${escapeHtml(w.bankAccountNumber || '—')}</td>
                    <td>₦${Number(w.amount || 0).toLocaleString()}</td>
                    <td>${timeAgo(w.requestedAt)}</td>
                    <td style="display:flex; gap:6px;">
                        <button class="table-action-btn" data-approve-withdrawal="${w.id}" data-uid="${w.userId}" data-amount="${w.amount}">Approve</button>
                        <button class="table-action-btn" style="background:rgba(239,68,68,0.15); color:#ef4444;" data-reject-withdrawal="${w.id}" data-uid="${w.userId}" data-amount="${w.amount}">Reject</button>
                    </td>
                `;
                body.appendChild(tr);
            });

            body.querySelectorAll('[data-approve-withdrawal]').forEach(btn => {
                btn.addEventListener('click', () => approveWithdrawal(btn.dataset.approveWithdrawal, btn.dataset.uid, parseFloat(btn.dataset.amount)));
            });
            body.querySelectorAll('[data-reject-withdrawal]').forEach(btn => {
                btn.addEventListener('click', () => rejectWithdrawal(btn.dataset.rejectWithdrawal, btn.dataset.uid, parseFloat(btn.dataset.amount)));
            });
        });
    }

    async function approveWithdrawal(withdrawalId, userId, amount) {
        if (!confirm(`Approve withdrawal of ₦${amount.toLocaleString()}? Mark as paid after bank transfer.`)) return;
        try {
            await updateDoc(doc(db, 'withdrawals', withdrawalId), {
                status: 'approved', approvedAt: serverTimestamp(), approvedBy: currentAdmin.uid,
            });
            // Remove pending balance from user
            const userSnap = await getDoc(doc(db, 'users', userId));
            if (userSnap.exists()) {
                const pending = userSnap.data().walletBalancePending || 0;
                await updateDoc(doc(db, 'users', userId), {
                    walletBalancePending: Math.max(0, pending - amount),
                });
            }
            const { notifyUser } = await import('./notify-helper.js');
            await notifyUser(userId, {
                title: '✅ Withdrawal approved',
                message: `Your withdrawal of ₦${amount.toLocaleString()} has been approved and will be paid to your bank account.`,
                type: 'withdrawal_approved',
            });
            alertModal('Approved', `Withdrawal of ₦${amount.toLocaleString()} marked as approved.`);
        } catch (err) {
            console.error(err);
            alertModal('Error', 'Could not approve withdrawal.');
        }
    }

    async function rejectWithdrawal(withdrawalId, userId, amount) {
        if (!confirm(`Reject this withdrawal? The amount will be returned to the user's wallet.`)) return;
        try {
            await updateDoc(doc(db, 'withdrawals', withdrawalId), {
                status: 'rejected', rejectedAt: serverTimestamp(), rejectedBy: currentAdmin.uid,
            });
            // Refund to wallet
            const userSnap = await getDoc(doc(db, 'users', userId));
            if (userSnap.exists()) {
                const d = userSnap.data();
                await updateDoc(doc(db, 'users', userId), {
                    walletBalance: (d.walletBalance || 0) + amount,
                    walletBalancePending: Math.max(0, (d.walletBalancePending || 0) - amount),
                });
            }
            const { notifyUser } = await import('./notify-helper.js');
            await notifyUser(userId, {
                title: 'Withdrawal rejected',
                message: `Your withdrawal of ₦${amount.toLocaleString()} was rejected. The amount has been returned to your wallet.`,
                type: 'withdrawal_rejected',
            });
            alertModal('Rejected', `Withdrawal rejected and ₦${amount.toLocaleString()} returned to user's wallet.`);
        } catch (err) {
            console.error(err);
            alertModal('Error', 'Could not reject withdrawal.');
        }
    }

    // ---------- MILESTONE RELEASE REQUESTS ----------
    function watchMilestoneReleaseRequests() {
        const container = document.getElementById('milestoneReleasesContainer');
        if (!container) return;

        const q = query(collection(db, 'contracts'));
        onSnapshot(q, (snap) => {
            const pending = [];
            snap.forEach(d => {
                const c = { id: d.id, ...d.data() };
                if (c.status !== 'active') return;
                (c.milestones || []).forEach((m, idx) => {
                    // Show if submitted and not yet released (with or without releaseRequested)
                    if (m.submitted && !m.released) {
                        pending.push({ contract: c, milestoneIdx: idx, milestone: m });
                    }
                });
            });

            if (pending.length === 0) {
                container.innerHTML = '<p style="font-size:0.85rem; color:var(--text-secondary);">No pending release requests.</p>';
                return;
            }

            // Group by contract
            const byContract = {};
            pending.forEach(p => {
                if (!byContract[p.contract.id]) byContract[p.contract.id] = { contract: p.contract, milestones: [] };
                byContract[p.contract.id].milestones.push(p);
            });

            container.innerHTML = '';
            Object.values(byContract).forEach(({ contract, milestones }) => {
                const block = document.createElement('div');
                block.style.cssText = 'background:var(--bg-main); border:1px solid var(--border-color); border-radius:14px; padding:14px; margin-bottom:12px;';

                const header = document.createElement('div');
                header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;';
                header.innerHTML = `
                    <strong style="font-size:0.9rem;">${escapeHtml(contract.title)}</strong>
                    <button class="table-action-btn toggle-milestones-btn">Show Milestones ▾</button>
                `;

                const details = document.createElement('div');
                details.style.display = 'none';
                milestones.forEach(({ milestone, milestoneIdx }) => {
                    const amount = Math.round((contract.totalPrice || 0) * (milestone.percent / 100));
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-top:1px solid var(--border-color);';
                    const statusLabel = milestone.releaseRequested
                        ? '<span style="color:#f59e0b; font-size:0.72rem;">⏳ Release requested by client</span>'
                        : '<span style="color:#6b7280; font-size:0.72rem;">✅ Delivered — no release request yet</span>';
                    row.innerHTML = `
                        <div>
                            <div style="font-size:0.85rem; font-weight:600;">${escapeHtml(milestone.name || 'Milestone ' + (milestoneIdx + 1))}</div>
                            <div style="font-size:0.78rem; color:var(--text-secondary);">₦${amount.toLocaleString()} · ${milestone.percent}%</div>
                            ${statusLabel}
                        </div>
                        <button class="table-action-btn"
                            data-contract-id="${contract.id}"
                            data-milestone-idx="${milestoneIdx}"
                            data-amount="${amount}"
                            data-freelancer="${contract.freelancerId}"
                            data-client="${contract.clientId}"
                            data-title="${escapeHtml(contract.title)}">
                            Approve Release
                        </button>
                    `;
                    details.appendChild(row);
                });

                block.appendChild(header);
                block.appendChild(details);
                container.appendChild(block);

                // Wire toggle
                header.querySelector('.toggle-milestones-btn').addEventListener('click', function() {
                    const isHidden = details.style.display === 'none' || details.style.display === '';
                    details.style.display = isHidden ? 'block' : 'none';
                    this.textContent = isHidden ? 'Hide Milestones ▴' : 'Show Milestones ▾';
                });
            });

            container.querySelectorAll('[data-contract-id]').forEach(btn => {
                btn.addEventListener('click', () => adminApproveMilestoneRelease(btn));
            });
        });
    }

    async function adminApproveMilestoneRelease(btn) {
        const contractId = btn.dataset.contractId;
        const idx = parseInt(btn.dataset.milestoneIdx, 10);
        const amount = parseFloat(btn.dataset.amount);
        const freelancerId = btn.dataset.freelancer;
        const clientId = btn.dataset.client;
        const title = btn.dataset.title;

        if (!confirm(`Approve release of ₦${amount.toLocaleString()} for this milestone?`)) return;

        try {
            const contractSnap = await getDoc(doc(db, 'contracts', contractId));
            if (!contractSnap.exists()) return;
            const contract = contractSnap.data();

            // ── ESCROW GATE ──────────────────────────
            const escrow    = contract.escrowBalance || 0;
            const released  = contract.payoutsEarned || 0;
            const available = escrow - released;
            if (amount > available) {
                const shortfall = amount - available;
                alertModal('⚠️ Insufficient Escrow',
                    `Only ₦${available.toLocaleString()} is in escrow but this milestone needs ₦${amount.toLocaleString()}. ` +
                    `Client must top up ₦${shortfall.toLocaleString()} first.`
                );
                const { notifyUser } = await import('./notify-helper.js');
                await notifyUser(contract.clientId, {
                    title: '💳 Payment required',
                    message: `Milestone "${freelancer}" on "${title}" needs ₦${shortfall.toLocaleString()} more in escrow before release.`,
                    type: 'escrow_topup_required',
                    link: 'client-dashboard.html',
                });
                return;
            }
            // ─────────────────────────────────────────
            const updated = [...contract.milestones];
            updated[idx] = { ...updated[idx], released: true, releaseRequested: false, releasedAt: new Date().toISOString(), releasedBy: currentAdmin.uid };
            const newPayoutsEarned = (contract.payoutsEarned || 0) + amount;
            const allReleased = updated.every(x => x.released);

            await updateDoc(doc(db, 'contracts', contractId), {
                milestones: updated,
                payoutsEarned: newPayoutsEarned,
                status: allReleased ? 'completed' : contract.status,
            });

            // Credit freelancer
            const flSnap = await getDoc(doc(db, 'users', freelancerId));
            if (flSnap.exists()) {
                await updateDoc(doc(db, 'users', freelancerId), {
                    walletBalance: (flSnap.data().walletBalance || 0) + amount,
                });
            }
            // Update client totalSpent
            const clSnap = await getDoc(doc(db, 'users', clientId));
            if (clSnap.exists()) {
                await updateDoc(doc(db, 'users', clientId), {
                    totalSpent: (clSnap.data().totalSpent || 0) + amount,
                });
            }

            const { notifyUser } = await import('./notify-helper.js');
            await notifyUser(freelancerId, {
                title: '💰 Payment released!',
                message: `Admin released ₦${amount.toLocaleString()} for a milestone on "${title}".`,
                type: 'payment_released',
            });
            await notifyUser(clientId, {
                title: 'Payment released',
                message: `₦${amount.toLocaleString()} has been released to the freelancer on "${title}".`,
                type: 'payment_released',
            });

            alertModal('Released ✓', `₦${amount.toLocaleString()} released to freelancer.${allReleased ? ' Contract marked completed.' : ''}`);
        } catch (err) {
            console.error(err);
            alertModal('Error', 'Could not approve release.');
        }
    }

    // ---------- REFERRAL SETTINGS ----------
    async function loadReferralSettings() {
        const snap = await getDoc(doc(db, 'settings', 'referral'));
        const val = snap.exists() ? (snap.data().rentCredit || 0) : 0;
        const input = document.getElementById('referralRentCredit');
        if (input) input.value = val;
    }

    function wireReferralForm() {
        document.getElementById('saveReferralBtn')?.addEventListener('click', async () => {
            const amount = parseFloat(document.getElementById('referralRentCredit').value) || 0;
            try {
                await setDoc(doc(db, 'settings', 'referral'), { rentCredit: amount, updatedAt: new Date() }, { merge: true });
                alertModal('Saved', `Referral rent credit set to ₦${amount.toLocaleString()}.`);
            } catch (err) {
                console.error(err);
                alertModal('Error', 'Could not save referral settings.');
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