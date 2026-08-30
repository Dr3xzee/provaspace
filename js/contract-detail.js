// ============================================
// PROVASPACE — Contract Detail (milestones, chat, actions)
// ============================================

import {
    auth, db, onAuthStateChanged,
    doc, getDoc, updateDoc,
    collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
} from './firebase.js';
import { notifyUser } from './notify-helper.js';

let currentUser = null;
let currentUserData = null;
let contractId = null;
let contractData = null;
let unsubscribeMessages = null;

document.addEventListener('DOMContentLoaded', () => {
    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const closeModal = document.getElementById('closeModal');
    const modalActionBtn = document.getElementById('modalActionBtn');

    function showModal(title, html, onAction) {
        modalTitle.textContent = title;
        if (html instanceof Node) { modalBody.innerHTML = ''; modalBody.appendChild(html); }
        else { modalBody.innerHTML = `<p>${html}</p>`; }
        modalOverlay.classList.add('active');
        modalActionBtn.textContent = 'Okay';
        modalActionBtn.onclick = () => { modalOverlay.classList.remove('active'); if (onAction) onAction(); };
    }
    closeModal.addEventListener('click', () => modalOverlay.classList.remove('active'));
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('active'); });

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }
    function formatNaira(n) {
        return '₦ ' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    const params = new URLSearchParams(window.location.search);
    contractId = params.get('id');

    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = 'login.html'; return; }
        currentUser = user;

        const userSnap = await getDoc(doc(db, 'users', user.uid));
        currentUserData = userSnap.exists() ? userSnap.data() : {};
        document.getElementById('backLink').href = currentUserData.role === 'client' ? 'client-dashboard.html' : 'index.html';

        if (!contractId) {
            document.getElementById('contractTitle').textContent = 'Contract not found';
            return;
        }

        await loadContract();
        listenToChat();
    });

    async function loadContract() {
        const snap = await getDoc(doc(db, 'contracts', contractId));
        if (!snap.exists()) {
            document.getElementById('contractTitle').textContent = 'Contract not found';
            return;
        }
        contractData = snap.data();
        render();
    }

    function isClientSide() {
        return currentUser.uid === contractData.clientId;
    }

    function render() {
        document.getElementById('contractTitle').textContent = contractData.title || 'Contract';

        const statusLine = document.getElementById('contractStatusLine');
        const total = (contractData.milestones || []).length;
        const done = (contractData.milestones || []).filter(m => m.released).length;
        statusLine.innerHTML = `Status: <strong>${escapeHtml(contractData.status)}</strong> · ${done}/${total} milestones released · Total: <strong>${formatNaira(contractData.totalPrice)}</strong> · Released so far: <strong>${formatNaira(contractData.payoutsEarned || 0)}</strong>`;

        renderMilestones();
        renderActions();
    }

    function renderMilestones() {
        const box = document.getElementById('milestonesList');
        box.innerHTML = '';
        (contractData.milestones || []).forEach((m, idx) => {
            const row = document.createElement('div');
            row.className = 'milestone-item' + (m.released ? ' done' : '');
            let actionHtml = '';
            if (m.released) {
                actionHtml = '<span class="badge badge-green">Paid</span>';
            } else if (isClientSide()) {
                actionHtml = m.submitted
                    ? `<button class="mini-btn" data-release="${idx}">Release Payment</button>`
                    : '<span class="badge badge-amber">Awaiting delivery</span>';
            } else {
                actionHtml = m.submitted
                    ? '<span class="badge badge-amber">Submitted — awaiting release</span>'
                    : `<button class="mini-btn mini-btn-outline" data-submit="${idx}">Mark Delivered</button>`;
            }
            row.innerHTML = `
                <div>
                    <div class="milestone-name">${escapeHtml(m.name || 'Milestone ' + (idx + 1))}</div>
                    <div class="milestone-percent">${m.percent}% · ${formatNaira((contractData.totalPrice || 0) * (m.percent / 100))}</div>
                </div>
                ${actionHtml}
            `;
            box.appendChild(row);
        });

        box.querySelectorAll('[data-release]').forEach(btn => {
            btn.addEventListener('click', () => releaseMilestone(parseInt(btn.dataset.release, 10)));
        });
        box.querySelectorAll('[data-submit]').forEach(btn => {
            btn.addEventListener('click', () => submitMilestone(parseInt(btn.dataset.submit, 10)));
        });
    }

    async function submitMilestone(idx) {
        const updated = [...contractData.milestones];
        updated[idx] = { ...updated[idx], submitted: true };
        await updateDoc(doc(db, 'contracts', contractId), { milestones: updated });
        contractData.milestones = updated;
        render();
    }

    async function releaseMilestone(idx) {
        const m = contractData.milestones[idx];
        const amount = Math.round((contractData.totalPrice || 0) * (m.percent / 100));
        const box = document.createElement('div');
        box.innerHTML = `<p>Release <strong>${formatNaira(amount)}</strong> for "<strong>${escapeHtml(m.name)}</strong>"?</p>
            <p style="margin-top:8px; font-size:0.8rem; color:red;">ARE YOU SURE THE JOB IS COMPLETE?</p>`;
        showModal('Release Milestone Payment', box, null);
        modalActionBtn.textContent = 'Confirm & Release';
        modalActionBtn.onclick = async () => {
            modalOverlay.classList.remove('active');
            const updated = [...contractData.milestones];
            updated[idx] = { ...m, released: true };
            const newPayoutsEarned = (contractData.payoutsEarned || 0) + amount;
            const allReleased = updated.every(x => x.released);

            await updateDoc(doc(db, 'contracts', contractId), {
                milestones: updated,
                payoutsEarned: newPayoutsEarned,
                status: allReleased ? 'completed' : contractData.status,
            });

            const clientSnap = await getDoc(doc(db, 'users', contractData.clientId));
            if (clientSnap.exists()) {
                await updateDoc(doc(db, 'users', contractData.clientId), {
                    totalSpent: (clientSnap.data().totalSpent || 0) + amount,
                });
            }
            const flSnap = await getDoc(doc(db, 'users', contractData.freelancerId));
            if (flSnap.exists()) {
                await updateDoc(doc(db, 'users', contractData.freelancerId), {
                    walletBalance: (flSnap.data().walletBalance || 0) + amount,
                });
            }

            contractData.milestones = updated;
            contractData.payoutsEarned = newPayoutsEarned;
            if (allReleased) contractData.status = 'completed';
            render();
            showModal('Payment Released', `${formatNaira(amount)} released.${allReleased ? ' All milestones are complete — this contract is now marked completed.' : ''}`, null);
        };
    }

    function renderActions() {
        const row = document.getElementById('contractActionsRow');
        row.innerHTML = '';

        if (contractData.status === 'active') {
            const disputeBtn = document.createElement('button');
            disputeBtn.className = 'mini-btn mini-btn-outline';
            disputeBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Raise Dispute';
            disputeBtn.addEventListener('click', () => { window.location.href = 'disputes.html'; });
            row.appendChild(disputeBtn);

            if (!isClientSide()) {
                const abandonBtn = document.createElement('button');
                abandonBtn.className = 'mini-btn mini-btn-outline';
                abandonBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Abandon Job';
                abandonBtn.addEventListener('click', abandonContract);
                row.appendChild(abandonBtn);
            }
        } else {
            const badge = document.createElement('span');
            badge.className = 'badge ' + (contractData.status === 'completed' ? 'badge-green' : 'badge-red');
            badge.textContent = contractData.status;
            row.appendChild(badge);
        }
    }

    async function abandonContract() {
        const box = document.createElement('div');
        box.innerHTML = `<p>Abandoning this job marks it as abandoned and may affect your trust score. This cannot be undone.</p>`;
        showModal('Abandon This Job?', box, null);
        modalActionBtn.textContent = 'Yes, Abandon';
        modalActionBtn.onclick = async () => {
            modalOverlay.classList.remove('active');
            await updateDoc(doc(db, 'contracts', contractId), { status: 'abandoned' });
            const flSnap = await getDoc(doc(db, 'users', currentUser.uid));
            if (flSnap.exists()) {
                const newScore = Math.max(0, (flSnap.data().trustScore || 100) - 15);
                await updateDoc(doc(db, 'users', currentUser.uid), { trustScore: newScore });
            }
            contractData.status = 'abandoned';
            render();
            showModal('Job Abandoned', 'This contract has been marked abandoned. Your trust score has been adjusted.', () => window.location.href = 'index.html');
        };
    }

    // ---------- CHAT ----------
    function listenToChat() {
        const chatWindow = document.getElementById('chatWindow');
        const q = query(collection(db, 'contracts', contractId, 'messages'), orderBy('sentAt', 'asc'));
        unsubscribeMessages = onSnapshot(q, (snap) => {
            if (snap.empty) {
                chatWindow.innerHTML = '<p class="empty-state" style="display:block;">No messages yet. Say hello!</p>';
                return;
            }
            chatWindow.innerHTML = '';
            snap.forEach(d => {
                const msg = d.data();
                const bubble = document.createElement('div');
                bubble.className = 'chat-bubble ' + (msg.senderId === currentUser.uid ? 'mine' : 'theirs');
                bubble.textContent = msg.text;
                chatWindow.appendChild(bubble);
            });
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }, (err) => {
            console.error(err);
            chatWindow.innerHTML = '<p class="empty-state" style="display:block;">Could not load messages.</p>';
        });
    }

    document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
    document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

    async function sendMessage() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text || !contractId) return;
        input.value = '';
        try {
            await addDoc(collection(db, 'contracts', contractId, 'messages'), {
                senderId: currentUser.uid,
                text,
                sentAt: serverTimestamp(),
            });

            // Ping the other party on this contract that a new message came in.
            const otherPartyId = currentUser.uid === contractData?.clientId ? contractData?.freelancerId : contractData?.clientId;
            if (otherPartyId) {
                notifyUser(otherPartyId, {
                    title: 'New message',
                    message: `${currentUserData?.fullName || currentUserData?.companyName || 'Someone'} sent a message on "${contractData?.title || 'a contract'}".`,
                    type: 'contract_chat',
                    link: `contract-detail.html?id=${contractId}`,
                }).catch(err => console.error('notifyUser failed', err));
            }
        } catch (err) {
            console.error(err);
        }
    }

    window.addEventListener('beforeunload', () => { if (unsubscribeMessages) unsubscribeMessages(); });
});
