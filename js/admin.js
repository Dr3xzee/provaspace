// ============================================
// PROVASPACE — Admin ("Space God") Dashboard
// ============================================

import {
    auth, db, onAuthStateChanged, signOut,
    doc, getDoc, setDoc, updateDoc,
    collection, query, where, getDocs, addDoc, serverTimestamp,
} from './firebase.js';

let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = themeToggle.querySelector('i');
    const logoutBtn = document.getElementById('logoutBtn');

    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const closeModal = document.getElementById('closeModal');
    const modalActionBtn = document.getElementById('modalActionBtn');

    function showModal(title, msg, onAction) {
        modalTitle.textContent = title;
        if (msg instanceof Node) { modalBody.innerHTML = ''; modalBody.appendChild(msg); }
        else { modalBody.innerHTML = `<p>${msg}</p>`; }
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
    logoutBtn.addEventListener('click', async () => { await signOut(auth); window.location.href = 'login.html'; });

    function formatNaira(n) {
        return '₦ ' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ---------- TAB SWITCHING ----------
    const sidebarTabs = document.querySelectorAll('.sidebar-menu li');
    const topTabs = document.querySelectorAll('.admin-tab-btn');
    function activateTab(tabName) {
        sidebarTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        topTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
        document.getElementById(`section-${tabName}`)?.classList.add('active');
        if (window.innerWidth <= 900) sidebar.classList.remove('mobile-open');
    }
    [...sidebarTabs, ...topTabs].forEach(el => {
        el.addEventListener('click', () => activateTab(el.dataset.tab));
    });

    // ---------- AUTH GUARD (admin only) ----------
    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = 'login.html'; return; }
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists() || snap.data().isAdmin !== true) {
            // Not an admin — bounce out. Set isAdmin: true manually on your own user doc
            // in the Firestore console to access this panel during development.
            window.location.href = 'login.html';
            return;
        }
        currentUser = user;
        document.getElementById('sidebarName').textContent = snap.data().fullName || 'Admin';

        await loadOverviewStats();
        await loadPriceSettings();
        await loadVerifications();
        await loadDisputes();
        await loadOverdueRents();
        await loadUsers();
    });

    // ---------- OVERVIEW ----------
    async function loadOverviewStats() {
        try {
            const [freelancersSnap, clientsSnap, gigsSnap, contractsSnap, disputesSnap] = await Promise.all([
                getDocs(query(collection(db, 'users'), where('role', '==', 'freelancer'))),
                getDocs(query(collection(db, 'users'), where('role', '==', 'client'))),
                getDocs(collection(db, 'gigs')),
                getDocs(query(collection(db, 'contracts'), where('status', '==', 'active'))),
                getDocs(query(collection(db, 'disputes'), where('status', '==', 'open'))),
            ]);

            document.getElementById('statFreelancers').textContent = freelancersSnap.size;
            document.getElementById('statClients').textContent = clientsSnap.size;
            document.getElementById('statGigs').textContent = gigsSnap.size;
            document.getElementById('statContracts').textContent = contractsSnap.size;
            document.getElementById('statDisputes').textContent = disputesSnap.size;

            let pending = 0;
            freelancersSnap.forEach(d => { if (!d.data().ninVerified) pending++; });
            clientsSnap.forEach(d => { if (!d.data().cacVerified) pending++; });
            document.getElementById('statPending').textContent = pending;

            let overdue = 0;
            const now = new Date();
            freelancersSnap.forEach(d => {
                const rent = d.data().rentStatus;
                const due = rent?.dueDate?.toDate ? rent.dueDate.toDate() : (rent?.dueDate ? new Date(rent.dueDate) : null);
                if (due && due < now) overdue++;
            });
            document.getElementById('statOverdue').textContent = overdue;

            let holding = 0;
            gigsSnap.forEach(d => {
                const g = d.data();
                if (g.status !== 'completed') holding += (g.deposit || 0) + (g.insuranceFee || 0);
            });
            document.getElementById('statHolding').textContent = formatNaira(holding);
        } catch (err) {
            console.error(err);
        }
    }

    // ---------- PRICE SETTINGS ----------
    const taxTiersBox = document.getElementById('taxTiersBox');

    function addTierRow(tier = { name: '', gigLimit: '', price: '' }) {
        const row = document.createElement('div');
        row.className = 'tier-row';
        row.innerHTML = `
            <input type="text" placeholder="Tier name (e.g. Slivering)" class="tier-name" value="${escapeHtml(tier.name)}">
            <input type="number" placeholder="Gig limit" class="tier-limit" value="${tier.gigLimit}" style="max-width:110px;">
            <input type="number" placeholder="Price (₦)" class="tier-price" value="${tier.price}" style="max-width:130px;">
            <button type="button" class="remove-tier-btn"><i class="fa-solid fa-xmark"></i></button>
        `;
        row.querySelector('.remove-tier-btn').addEventListener('click', () => row.remove());
        taxTiersBox.appendChild(row);
    }

    document.getElementById('addTierBtn').addEventListener('click', () => addTierRow());

    async function loadPriceSettings() {
        const snap = await getDoc(doc(db, 'settings', 'prices'));
        const p = snap.exists() ? snap.data() : {
            rentWeekly: 2000, rentMonthly: 7000, rentYearly: 70000,
            gracePeriodDays: 7, overdueFeeFlat: 500, insuranceFeePercent: 3,
            taxPassTiers: [{ name: 'Slivering', gigLimit: 10, price: 5000 }, { name: 'Golden Boy', gigLimit: 20, price: 9000 }],
        };
        document.getElementById('rentWeekly').value = p.rentWeekly ?? '';
        document.getElementById('rentMonthly').value = p.rentMonthly ?? '';
        document.getElementById('rentYearly').value = p.rentYearly ?? '';
        document.getElementById('gracePeriodDays').value = p.gracePeriodDays ?? '';
        document.getElementById('overdueFeeFlat').value = p.overdueFeeFlat ?? '';
        document.getElementById('insuranceFeePercent').value = p.insuranceFeePercent ?? '';
        taxTiersBox.innerHTML = '';
        (p.taxPassTiers || []).forEach(t => addTierRow(t));
    }

    document.getElementById('savePricesBtn').addEventListener('click', async () => {
        const taxPassTiers = [...taxTiersBox.querySelectorAll('.tier-row')].map(row => ({
            name: row.querySelector('.tier-name').value.trim(),
            gigLimit: parseInt(row.querySelector('.tier-limit').value, 10) || 0,
            price: parseFloat(row.querySelector('.tier-price').value) || 0,
        }));

        const priceData = {
            rentWeekly: parseFloat(document.getElementById('rentWeekly').value) || 0,
            rentMonthly: parseFloat(document.getElementById('rentMonthly').value) || 0,
            rentYearly: parseFloat(document.getElementById('rentYearly').value) || 0,
            gracePeriodDays: parseInt(document.getElementById('gracePeriodDays').value, 10) || 0,
            overdueFeeFlat: parseFloat(document.getElementById('overdueFeeFlat').value) || 0,
            insuranceFeePercent: parseFloat(document.getElementById('insuranceFeePercent').value) || 0,
            taxPassTiers,
            updatedAt: new Date(),
        };

        try {
            await setDoc(doc(db, 'settings', 'prices'), priceData, { merge: true });
            showModal('Prices Saved', 'All pricing has been updated across the platform.', null);
        } catch (err) {
            console.error(err);
            showModal('Error', 'Could not save prices. Check that your Firestore rules allow admin writes to settings/prices.', null);
        }
    });

    // ---------- VERIFICATIONS ----------
   // ---------- VERIFICATIONS ----------
async function loadVerifications() {
    const freelancerBody = document.getElementById('freelancerVerifyBody');
    const clientBody = document.getElementById('clientVerifyBody');

    // Helper — renders a <dl> of all fields in a user doc
    function buildUserDetailNode(data) {
        const dl = document.createElement('dl');
        dl.style.cssText = 'display:grid; grid-template-columns: max-content 1fr; gap: 6px 16px; font-size:0.82rem; margin:0;';
        const skip = new Set(['password', 'passwordHash']); // omit sensitive-looking fields
        for (const [key, val] of Object.entries(data)) {
            if (skip.has(key)) continue;
            let display = val;
            if (val && typeof val.toDate === 'function') display = val.toDate().toLocaleString();
            else if (val && typeof val === 'object') display = JSON.stringify(val, null, 2);

            const dt = document.createElement('dt');
            dt.style.cssText = 'color:var(--text-secondary); font-weight:500; word-break:break-all;';
            dt.textContent = key;

            const dd = document.createElement('dd');
            dd.style.cssText = 'margin:0; word-break:break-all; color:var(--text-primary);';
            dd.textContent = String(display ?? '—');

            dl.appendChild(dt);
            dl.appendChild(dd);
        }
        return dl;
    }

    try {
        const flSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'freelancer'), where('ninVerified', '==', false)));
        freelancerBody.innerHTML = flSnap.empty ? '<tr><td colspan="5">No pending NIN verifications.</td></tr>' : '';
        flSnap.forEach(d => {
            const u = d.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(u.fullName)}</td>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.phone)}</td>
                <td><button class="table-action-btn secondary" data-more-freelancer="${d.id}">More</button></td>
                <td><button class="table-action-btn" data-verify-freelancer="${d.id}">Verify</button></td>
            `;
            freelancerBody.appendChild(tr);
        });

        freelancerBody.querySelectorAll('[data-more-freelancer]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const snap = await getDoc(doc(db, 'users', btn.dataset.moreFreelancer));
                if (!snap.exists()) return;
                showModal(`User — ${snap.data().fullName || snap.id}`, buildUserDetailNode(snap.data()), null);
            });
        });
        freelancerBody.querySelectorAll('[data-verify-freelancer]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await updateDoc(doc(db, 'users', btn.dataset.verifyFreelancer), { ninVerified: true });
                showModal('Verified', 'Freelancer NIN marked as verified.', () => loadVerifications());
            });
        });
    } catch (err) {
        console.error(err);
        freelancerBody.innerHTML = '<tr><td colspan="5">Could not load — needs composite index on users(role, ninVerified).</td></tr>';
    }

    try {
        const clSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'client'), where('cacVerified', '==', false)));
        clientBody.innerHTML = clSnap.empty ? '<tr><td colspan="4">No pending CAC verifications.</td></tr>' : '';
        clSnap.forEach(d => {
            const u = d.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(u.companyName || u.fullName)}</td>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.phone)}</td>
                <td><button class="table-action-btn secondary" data-more-client="${d.id}">More</button></td>
                <td><button class="table-action-btn" data-verify-client="${d.id}">Verify</button></td>
            `;
            clientBody.appendChild(tr);
        });

        clientBody.querySelectorAll('[data-more-client]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const snap = await getDoc(doc(db, 'users', btn.dataset.moreClient));
                if (!snap.exists()) return;
                showModal(`User — ${snap.data().companyName || snap.data().fullName || snap.id}`, buildUserDetailNode(snap.data()), null);
            });
        });
        clientBody.querySelectorAll('[data-verify-client]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await updateDoc(doc(db, 'users', btn.dataset.verifyClient), { cacVerified: true });
                showModal('Verified', 'Client CAC marked as verified.', () => loadVerifications());
            });
        });
    } catch (err) {
        console.error(err);
        clientBody.innerHTML = '<tr><td colspan="4">Could not load — needs composite index on users(role, cacVerified).</td></tr>';
    }
}

    // ---------- DISPUTES ----------
    async function loadDisputes() {
        const body = document.getElementById('disputesBody');
        try {
            const snap = await getDocs(query(collection(db, 'disputes'), where('status', '==', 'open')));
            body.innerHTML = snap.empty ? '<tr><td colspan="5">No open disputes.</td></tr>' : '';
            snap.forEach(d => {
                const disp = d.data();
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(disp.contractId)}</td>
                    <td>${escapeHtml(disp.raisedBy)}</td>
                    <td>${escapeHtml(disp.reason)}</td>
                    <td><span class="badge badge-amber">Open</span></td>
                    <td><button class="table-action-btn" data-resolve="${d.id}">Resolve</button></td>
                `;
                body.appendChild(tr);
            });
            body.querySelectorAll('[data-resolve]').forEach(btn => {
                btn.addEventListener('click', () => openResolveDisputeModal(btn.dataset.resolve));
            });
        } catch (err) {
            console.error(err);
            body.innerHTML = '<tr><td colspan="5">Could not load disputes.</td></tr>';
        }
    }

    async function openResolveDisputeModal(disputeId) {
        const disputeSnap = await getDoc(doc(db, 'disputes', disputeId));
        if (!disputeSnap.exists()) return;
        const dispute = disputeSnap.data();

        let contract = null;
        if (dispute.contractId) {
            const contractSnap = await getDoc(doc(db, 'contracts', dispute.contractId));
            if (contractSnap.exists()) contract = { id: contractSnap.id, ...contractSnap.data() };
        }

        const remaining = contract
            ? (contract.totalPrice || 0) - (contract.payoutsEarned || 0)
            : 0;

        const box = document.createElement('div');
        box.innerHTML = `
            <p style="margin-bottom:6px;"><strong>Reason:</strong> ${escapeHtml(dispute.reason)}</p>
            <p style="margin-bottom:14px; font-size:0.8rem; color:var(--text-secondary);">Raised by: ${escapeHtml(dispute.raisedBy)} (${escapeHtml(dispute.raisedByRole || '—')})${contract ? ` · Contract: ${escapeHtml(contract.title)} · Remaining in escrow: ${formatNaira(remaining)}` : ''}</p>

            <div class="form-group" style="margin-bottom:14px;">
                <label>Assurance decision</label>
                <select id="disputeDecisionSelect" style="width:100%; background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 14px; color: var(--text-primary);">
                    <option value="none">No action — dismiss dispute</option>
                    <option value="favor_client">Favor client — cancel contract, do not release remaining funds</option>
                    <option value="favor_freelancer">Favor freelancer — release remaining milestones as paid</option>
                </select>
            </div>

            <div class="form-group">
                <label>Resolution note</label>
                <textarea id="disputeResolutionInput" placeholder="Explain the decision..." style="width:100%; min-height:90px; background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 14px; color: var(--text-primary); font-family:inherit;"></textarea>
            </div>
        `;

        showModal('Resolve Dispute', box, null);
        modalActionBtn.textContent = 'Confirm Resolution';
        modalActionBtn.onclick = async () => {
            const decision = box.querySelector('#disputeDecisionSelect').value;
            const resolution = box.querySelector('#disputeResolutionInput').value.trim();
            modalOverlay.classList.remove('active');

            try {
                await updateDoc(doc(db, 'disputes', disputeId), {
                    status: 'resolved',
                    decision,
                    resolution: resolution || '(no note provided)',
                    resolvedAt: new Date(),
                    resolvedBy: currentUser.uid,
                });

                if (contract && decision === 'favor_client') {
                    await updateDoc(doc(db, 'contracts', contract.id), { status: 'cancelled' });
                } else if (contract && decision === 'favor_freelancer') {
                    const updatedMilestones = (contract.milestones || []).map(m => ({ ...m, released: true, submitted: true }));
                    await updateDoc(doc(db, 'contracts', contract.id), {
                        milestones: updatedMilestones,
                        payoutsEarned: contract.totalPrice || 0,
                        status: 'completed',
                    });
                    const flSnap = await getDoc(doc(db, 'users', contract.freelancerId));
                    if (flSnap.exists()) {
                        await updateDoc(doc(db, 'users', contract.freelancerId), {
                            walletBalance: (flSnap.data().walletBalance || 0) + remaining,
                        });
                    }
                }

                showModal('Dispute Resolved', 'The dispute has been closed and any linked contract updated accordingly.', () => { loadDisputes(); loadOverviewStats(); });
            } catch (err) {
                console.error(err);
                showModal('Error', 'Could not resolve dispute. Please try again.', null);
            }
        };
    }

    // ---------- OVERDUE RENTS ----------
    async function loadOverdueRents() {
        const body = document.getElementById('overdueRentsBody');
        try {
            const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'freelancer')));
            const now = new Date();
            const overdue = [];
            snap.forEach(d => {
                const u = d.data();
                const due = u.rentStatus?.dueDate?.toDate ? u.rentStatus.dueDate.toDate() : (u.rentStatus?.dueDate ? new Date(u.rentStatus.dueDate) : null);
                if (due && due < now) {
                    const daysOverdue = Math.ceil((now - due) / (1000 * 60 * 60 * 24));
                    overdue.push({ id: d.id, ...u, daysOverdue });
                }
            });

            body.innerHTML = overdue.length === 0 ? '<tr><td colspan="5">No overdue rents.</td></tr>' : '';
            overdue.forEach(u => {
                const suspended = u.daysOverdue > 14;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(u.fullName)}</td>
                    <td>${escapeHtml(u.rentStatus?.plan || '—')}</td>
                    <td>${u.daysOverdue} days</td>
                    <td>${suspended ? '<span class="badge badge-red">Suspended</span>' : '<span class="badge badge-amber">Grace/Overdue</span>'}</td>
                    <td>
                        <button class="table-action-btn" data-remind="${u.id}">Send Reminder</button>
                        <button class="table-action-btn danger" data-suspend="${u.id}" data-current="${u.suspended ? '1' : '0'}">${u.suspended ? 'Unsuspend' : 'Suspend'}</button>
                    </td>
                `;
                body.appendChild(tr);
            });

            body.querySelectorAll('[data-remind]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await addDoc(collection(db, 'notifications'), {
                            userId: btn.dataset.remind,
                            type: 'rent_reminder',
                            message: 'Your rent is overdue. Please pay to avoid suspension.',
                            read: false,
                            createdAt: serverTimestamp(),
                        });
                        showModal('Reminder Sent', 'A rent reminder notification has been logged for this freelancer.', null);
                    } catch (err) {
                        console.error(err);
                        showModal('Error', 'Could not send reminder.', null);
                    }
                });
            });
            body.querySelectorAll('[data-suspend]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const isCurrentlySuspended = btn.dataset.current === '1';
                    await updateDoc(doc(db, 'users', btn.dataset.suspend), { suspended: !isCurrentlySuspended });
                    showModal(isCurrentlySuspended ? 'Unsuspended' : 'Suspended', `User has been ${isCurrentlySuspended ? 'restored' : 'suspended'}.`, () => loadOverdueRents());
                });
            });
        } catch (err) {
            console.error(err);
            body.innerHTML = '<tr><td colspan="5">Could not load overdue rents.</td></tr>';
        }
    }

    // ---------- USERS ----------
    async function loadUsers() {
        const body = document.getElementById('usersBody');
        try {
            const snap = await getDocs(collection(db, 'users'));
            body.innerHTML = snap.empty ? '<tr><td colspan="5">No users yet.</td></tr>' : '';
            snap.forEach(d => {
                const u = d.data();
                const name = u.companyName || u.fullName || '—';
                const statusBadge = u.banned
                    ? '<span class="badge badge-red">Banned</span>'
                    : (u.suspended
                        ? '<span class="badge badge-amber">Suspended</span>'
                        : '<span class="badge badge-green">Active</span>');
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(name)}</td>
                    <td><span class="badge badge-blue">${escapeHtml(u.role || '—')}</span></td>
                    <td>${escapeHtml(u.email)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="table-action-btn secondary" data-toggle-suspend="${d.id}" data-current="${u.suspended ? '1' : '0'}">
                            ${u.suspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                        <button class="table-action-btn danger" data-toggle-ban="${d.id}" data-current="${u.banned ? '1' : '0'}">
                            ${u.banned ? 'Unban' : 'Ban'}
                        </button>
                    </td>
                `;
                body.appendChild(tr);
            });
            body.querySelectorAll('[data-toggle-suspend]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const isCurrentlySuspended = btn.dataset.current === '1';
                    await updateDoc(doc(db, 'users', btn.dataset.toggleSuspend), { suspended: !isCurrentlySuspended });
                    showModal(isCurrentlySuspended ? 'Unsuspended' : 'Suspended', `User has been ${isCurrentlySuspended ? 'restored' : 'suspended'}.`, () => loadUsers());
                });
            });
            body.querySelectorAll('[data-toggle-ban]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const isCurrentlyBanned = btn.dataset.current === '1';
                    if (!isCurrentlyBanned && !confirm('Ban this user? They will immediately lose access to their dashboard.')) return;
                    await updateDoc(doc(db, 'users', btn.dataset.toggleBan), { banned: !isCurrentlyBanned });
                    showModal(isCurrentlyBanned ? 'Unbanned' : 'Banned', `User has been ${isCurrentlyBanned ? 'restored' : 'banned'}.`, () => loadUsers());
                });
            });
        } catch (err) {
            console.error(err);
            body.innerHTML = '<tr><td colspan="5">Could not load users.</td></tr>';
        }
    }
});
