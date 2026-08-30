// ============================================
// PROVASPACE — Disputes page
// ============================================

import {
    auth, db, onAuthStateChanged,
    doc, getDoc,
    collection, query, where, orderBy, getDocs, addDoc, serverTimestamp,
} from './firebase.js';

let currentUser = null;
let currentUserData = null;
let myContracts = [];

document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = themeToggle.querySelector('i');
    const backBtn = document.getElementById('backBtn');

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

    menuToggle.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        document.body.classList.contains('dark-theme')
            ? themeIcon.classList.replace('fa-moon', 'fa-sun')
            : themeIcon.classList.replace('fa-sun', 'fa-moon');
    });

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = 'login.html'; return; }
        currentUser = user;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { window.location.href = 'signup.html'; return; }
        currentUserData = snap.data();

        const isClient = currentUserData.role === 'client';
        const home = isClient ? 'client-dashboard.html' : 'index.html';
        backBtn.onclick = () => window.location.href = home;

        const initial = (currentUserData.companyName || currentUserData.fullName || '?').trim().charAt(0).toUpperCase();
        document.getElementById('sidebarAvatar').textContent = initial;
        document.getElementById('sidebarName').textContent = currentUserData.companyName || currentUserData.fullName || 'User';
        document.getElementById('sidebarRole').textContent = isClient ? 'Client' : 'Freelancer';

        document.getElementById('sidebarMenu').innerHTML = `
            <li data-route="${home}"><i class="fa-solid fa-chart-pie"></i> Overview</li>
            ${isClient ? '<li data-route="post-gig.html"><i class="fa-solid fa-square-plus"></i> Post a Gig</li>' : ''}
            <li data-route="space.html"><i class="fa-solid fa-globe"></i> The Space</li>
            <li data-route="${home}#contracts"><i class="fa-solid fa-file-signature"></i> Active Contracts</li>
            <li class="active"><i class="fa-solid fa-triangle-exclamation"></i> Disputes</li>
            <li data-route="${isClient ? 'company-profile.html' : 'profile.html'}"><i class="fa-solid ${isClient ? 'fa-building' : 'fa-user'}"></i> Profile</li>
        `;
        document.querySelectorAll('#sidebarMenu li[data-route]').forEach(li => {
            li.addEventListener('click', () => { window.location.href = li.dataset.route; });
        });
        document.getElementById('bottomNav').innerHTML = `
            <a href="${home}" class="nav-item"><i class="fa-solid fa-chart-pie"></i><span>Overview</span></a>
            
            <a href="disputes.html" class="nav-item active"><i class="fa-solid fa-triangle-exclamation"></i><span>Disputes</span></a>
            <a href="${isClient ? 'company-profile.html' : 'profile.html'}" class="nav-item"><i class="fa-solid fa-user"></i><span>Profile</span></a>
        `;

        await loadMyContracts();
        await loadDisputes();
    });

    async function loadMyContracts() {
        const field = currentUserData.role === 'client' ? 'clientId' : 'freelancerId';
        const q = query(collection(db, 'contracts'), where(field, '==', currentUser.uid));
        const snap = await getDocs(q);
        myContracts = [];
        snap.forEach(d => myContracts.push({ id: d.id, ...d.data() }));
    }

    async function loadDisputes() {
        const list = document.getElementById('disputesList');
        list.innerHTML = '<p class="empty-state" style="display:block;">Loading disputes...</p>';
        try {
            const q = query(collection(db, 'disputes'), where('raisedBy', '==', currentUser.uid));
            const snap = await getDocs(q);
            const disputes = [];
            snap.forEach(d => disputes.push({ id: d.id, ...d.data() }));

            if (disputes.length === 0) {
                list.innerHTML = '<p class="empty-state" style="display:block;">No disputes raised. If a contract goes wrong, raise a dispute and admin will review it.</p>';
                return;
            }

            disputes.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            list.innerHTML = '';
            disputes.forEach(d => {
                const contract = myContracts.find(c => c.id === d.contractId);
                const card = document.createElement('div');
                card.className = 'dispute-card';
                const statusBadge = d.status === 'open'
                    ? '<span class="badge badge-amber">Open</span>'
                    : '<span class="badge badge-green">Resolved</span>';
                card.innerHTML = `
                    <div class="dispute-top">
                        <span class="dispute-title">${escapeHtml(contract?.title || 'Contract')}</span>
                        ${statusBadge}
                    </div>
                    <p class="dispute-reason">${escapeHtml(d.reason)}</p>
                    ${d.resolution ? `<p class="dispute-reason"><strong>Resolution:</strong> ${escapeHtml(d.resolution)}</p>` : ''}
                    <span class="dispute-meta">Contract: ${escapeHtml(d.contractId)}</span>
                `;
                list.appendChild(card);
            });
        } catch (err) {
            console.error(err);
            list.innerHTML = '<p class="empty-state" style="display:block;">Could not load disputes.</p>';
        }
    }

    document.getElementById('raiseDisputeBtn').addEventListener('click', () => {
        if (myContracts.length === 0) {
            showModal('No Contracts', 'You need an active or past contract to raise a dispute against.', null);
            return;
        }
        const box = document.createElement('div');
        box.innerHTML = `
            <div class="form-group" style="margin-bottom:14px;">
                <label>Which contract?</label>
                <select id="disputeContractSelect" style="width:100%; background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 14px; color: var(--text-primary);">
                    ${myContracts.map(c => `<option value="${c.id}">${escapeHtml(c.title)} (${c.status})</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>What went wrong?</label>
                <textarea id="disputeReasonInput" placeholder="Describe the issue in detail..." style="width:100%; min-height:100px; background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 14px; color: var(--text-primary); font-family:inherit;"></textarea>
            </div>
        `;
        showModal('Raise a Dispute', box, null);
        modalActionBtn.textContent = 'Submit Dispute';
        modalActionBtn.onclick = async () => {
            const contractId = box.querySelector('#disputeContractSelect').value;
            const reason = box.querySelector('#disputeReasonInput').value.trim();
            if (!reason) return;
            try {
                await addDoc(collection(db, 'disputes'), {
                    contractId,
                    raisedBy: currentUser.uid,
                    raisedByRole: currentUserData.role,
                    reason,
                    status: 'open',
                    resolution: null,
                    createdAt: serverTimestamp(),
                });
                modalOverlay.classList.remove('active');
                showModal('Dispute Submitted', 'Your dispute has been sent to the admin team for review under Assurance.', () => loadDisputes());
            } catch (err) {
                console.error(err);
                showModal('Error', 'Could not submit dispute. Please try again.', null);
            }
        };
    });
});
