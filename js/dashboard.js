// ============================================
// PROVASPACE — Freelancer Overview Dashboard
// ============================================

import {
    auth, db, onAuthStateChanged, signOut,
    doc, getDoc, updateDoc,
    collection, query, where, getDocs, addDoc, serverTimestamp,
} from './firebase.js';
import { payWithPaystack } from './paystack.js';
import { initNotificationBell } from './notifications-ui.js';

let currentUser = null;
let currentUserData = null;
let priceSettings = null;

document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = themeToggle.querySelector('i');
    const toggleBalance = document.getElementById('toggleBalance');
    const eyeIcon = document.getElementById('eyeIcon');
    const balanceAmount = document.getElementById('balanceAmount');
    const logoutBtn = document.getElementById('logoutBtn');
    const installAppBtn = document.getElementById('installAppBtn');

    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const closeModal = document.getElementById('closeModal');
    const modalActionBtn = document.getElementById('modalActionBtn');

    let isBalanceHidden = false;

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

    // Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (
        window.innerWidth <= 900 &&
        sidebar.classList.contains('mobile-open') &&
        !sidebar.contains(e.target) &&
        e.target !== menuToggle &&
        !menuToggle.contains(e.target)
    ) {
        sidebar.classList.remove('mobile-open');
    }
});

    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        document.body.classList.contains('dark-theme')
            ? themeIcon.classList.replace('fa-moon', 'fa-sun')
            : themeIcon.classList.replace('fa-sun', 'fa-moon');
    });

    toggleBalance.addEventListener('click', () => {
        isBalanceHidden = !isBalanceHidden;
        balanceAmount.textContent = isBalanceHidden ? '₦ ••••••' : formatNaira(currentUserData?.walletBalance || 0);
        eyeIcon.classList.toggle('fa-eye');
        eyeIcon.classList.toggle('fa-eye-slash');
    });

    logoutBtn.addEventListener('click', async () => {
        await signOut(auth);
        window.location.href = 'login.html';
    });

    document.addEventListener('prova:install-available', () => { installAppBtn.style.display = 'flex'; });
    installAppBtn.addEventListener('click', async () => {
        const installed = await window.provaTriggerInstall?.();
        if (installed) installAppBtn.style.display = 'none';
    });

    // ---------- AUTH GUARD + BOOT ----------
    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = 'login.html'; return; }
        currentUser = user;

        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userSnap.exists()) { window.location.href = 'signup.html'; return; }
        currentUserData = userSnap.data();

        if (currentUserData.role === 'client') { window.location.href = 'client-dashboard.html'; return; }

        const priceSnap = await getDoc(doc(db, 'settings', 'prices'));
        priceSettings = priceSnap.exists() ? priceSnap.data() : defaultPrices();

        populateHeader();
        populateRentCard();
        populateProfileCard();
        await loadStatsAndContracts();
        initNotificationBell(user.uid);

        if (window.location.hash === '#contracts') {
            document.getElementById('contracts')?.scrollIntoView({ behavior: 'smooth' });
        }
    });

    function formatNaira(n) {
        return '₦ ' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function defaultPrices() {
        return {
            rentWeekly: 2000, rentMonthly: 7000, rentYearly: 70000,
            overdueFeeFlat: 500, gracePeriodDays: 7,
            taxPassTiers: [{ name: 'Slivering', gigLimit: 10, price: 5000 }],
            insuranceFeePercent: 3,
        };
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function populateHeader() {
        const name = currentUserData.fullName || 'Freelancer';
        const initial = name.trim().charAt(0).toUpperCase() || 'F';
        document.getElementById('sidebarName').textContent = name;
        document.getElementById('sidebarRole').textContent = 'Freelancer';
        document.getElementById('sidebarAvatar').textContent = initial;
        document.getElementById('topAvatar').textContent = initial;
        document.getElementById('topUsername').textContent = name;
        balanceAmount.textContent = formatNaira(currentUserData.walletBalance || 0);
        document.getElementById('statTrustScore').textContent = currentUserData.trustScore ?? 100;
    }

    function populateRentCard() {
        const rent = currentUserData.rentStatus || {};
        const summary = document.getElementById('rentSummary');
        const fill = document.getElementById('rentProgressFill');
        const text = document.getElementById('rentProgressText');

        if (!rent.plan) {
            summary.textContent = 'No active rent plan. Pay rent to keep operating in the space.';
            fill.style.width = '0%';
            text.textContent = 'No plan active';
            return;
        }

        const owed = rent.amountOwed || 0;
        const dueDate = rent.dueDate?.toDate ? rent.dueDate.toDate() : (rent.dueDate ? new Date(rent.dueDate) : null);
        const now = new Date();
        let daysToDue = dueDate ? Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24)) : null;

        summary.textContent = `Plan: ${rent.plan} · Owed: ${formatNaira(owed)}`;

        if (daysToDue !== null && daysToDue < 0) {
            const daysOverdue = Math.abs(daysToDue);
            const grace = priceSettings.gracePeriodDays || 7;
            if (daysOverdue > grace) {
                text.textContent = `${daysOverdue} days overdue — overdue fee applies (${formatNaira(priceSettings.overdueFeeFlat)})`;
                fill.style.background = 'var(--accent-red)';
                fill.style.width = '100%';
            } else {
                text.textContent = `${daysOverdue} days overdue — grace period (${grace - daysOverdue} days left)`;
                fill.style.background = 'var(--accent-amber)';
                fill.style.width = '75%';
            }
        } else if (daysToDue !== null) {
            text.textContent = `${daysToDue} day(s) until due`;
            fill.style.background = 'var(--accent-blue)';
            fill.style.width = Math.max(10, 100 - daysToDue * 10) + '%';
        }
    }

    function populateProfileCard() {
        const requiredFields = ['fullName', 'email', 'phone', 'location', 'skills', 'bankAccountNumber', 'ninVerified'];
        const filled = requiredFields.filter(f => {
            const v = currentUserData[f];
            return v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0);
        }).length;
        const pct = Math.round((filled / requiredFields.length) * 100);
        document.getElementById('profileProgressFill').style.width = pct + '%';
        document.getElementById('profileProgressText').textContent = `${pct}% complete`;
        if (pct === 100) {
            document.getElementById('completeProfileBtn').querySelector('span').textContent = 'Edit Profile';
        }
    }

    // ---------- STATS + ACTIVE CONTRACTS ----------
    async function loadStatsAndContracts() {
        const list = document.getElementById('contractsList');
        const q = query(collection(db, 'contracts'), where('freelancerId', '==', currentUser.uid));
        let snap;
        try {
            snap = await getDocs(q);
        } catch (err) {
            console.error(err);
            list.innerHTML = '<p class="empty-state" style="display:block;">Could not load contracts.</p>';
            return;
        }

        const all = [];
        snap.forEach(d => all.push({ id: d.id, ...d.data() }));
        const active = all.filter(c => c.status === 'active');
        const completed = all.filter(c => c.status === 'completed');
        const totalEarned = completed.reduce((sum, c) => sum + (c.payoutsEarned || 0), 0);

        document.getElementById('statActiveContracts').textContent = active.length;
        document.getElementById('statCompletedGigs').textContent = completed.length;
        document.getElementById('statTotalEarned').textContent = formatNaira(totalEarned).replace('.00', '');

        if (active.length === 0) {
            list.innerHTML = '<p class="empty-state" style="display:block;">No active contracts yet. Head to The Space to browse open gigs.</p>';
            return;
        }

        list.innerHTML = '';
        active.forEach((c) => {
            const total = (c.milestones || []).length;
            const done = (c.milestones || []).filter(m => m.released).length;
            const card = document.createElement('div');
            card.className = 'contract-card';
            card.innerHTML = `
                <div class="contract-card-top">
                    <span class="contract-name">${escapeHtml(c.title)}</span>
                    <span class="contract-badge">Active</span>
                </div>
                <div class="contract-progress-row">
                    <span>Milestones: <strong>${done} / ${total}</strong></span>
                    <span>Payouts earned: <strong>${formatNaira(c.payoutsEarned || 0)}</strong></span>
                </div>
                <div class="contract-actions">
                    <button class="mini-btn" data-view="${c.id}">Open Contract</button>
                </div>
            `;
            list.appendChild(card);
        });
        list.querySelectorAll('[data-view]').forEach(btn => {
            btn.addEventListener('click', () => { window.location.href = `contract-detail.html?id=${btn.dataset.view}`; });
        });
    }

    // ---------- RENT PAYMENT ----------
    document.getElementById('payRentBtn').addEventListener('click', async () => {
        const box = document.createElement('div');
        box.innerHTML = `
            <p style="margin-bottom:10px;">Choose a rent plan (prices set by admin):</p>
            <div class="role-toggle" id="rentPlanToggle" style="margin-bottom:10px;">
                <button type="button" data-plan="weekly" class="active">Weekly<br><small>${formatNaira(priceSettings.rentWeekly)}</small></button>
                <button type="button" data-plan="monthly">Monthly<br><small>${formatNaira(priceSettings.rentMonthly)}</small></button>
                <button type="button" data-plan="yearly">Yearly<br><small>${formatNaira(priceSettings.rentYearly)}</small></button>
            </div>
        `;
        let selectedPlan = 'weekly';
        showModal('Pay Rent', box, null);
        box.querySelectorAll('[data-plan]').forEach(btn => {
            btn.addEventListener('click', () => {
                box.querySelectorAll('[data-plan]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedPlan = btn.dataset.plan;
            });
        });
        modalActionBtn.textContent = 'Pay Now';
        modalActionBtn.onclick = async () => {
            modalOverlay.classList.remove('active');
            const priceKey = { weekly: 'rentWeekly', monthly: 'rentMonthly', yearly: 'rentYearly' }[selectedPlan];
            const amount = priceSettings[priceKey];
            try {
                await payWithPaystack({
                    email: currentUserData.email,
                    amountNaira: amount,
                    metadata: { purpose: 'rent', plan: selectedPlan, uid: currentUser.uid },
                });
                const days = { weekly: 7, monthly: 30, yearly: 365 }[selectedPlan];
                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + days);
                await updateDoc(doc(db, 'users', currentUser.uid), {
                    'rentStatus.plan': selectedPlan,
                    'rentStatus.amountOwed': 0,
                    'rentStatus.dueDate': dueDate,
                });
                currentUserData.rentStatus = { plan: selectedPlan, amountOwed: 0, dueDate };
                populateRentCard();
                showModal('Rent Paid', `Your ${selectedPlan} rent has been recorded.`, null);
            } catch (err) {
                console.error(err);
                showModal('Payment Not Completed', err.message || 'Payment was cancelled or failed.', null);
            }
        };
    });

    document.getElementById('completeProfileBtn').addEventListener('click', () => {
        window.location.href = 'profile.html';
    });

    // ---------- WITHDRAW ----------
    document.getElementById('withdrawBtn').addEventListener('click', () => {
        const balance = currentUserData?.walletBalance || 0;
        if (balance <= 0) {
            showModal('Nothing to Withdraw', 'Your wallet balance is currently ₦0.00. Complete milestones to earn a balance.', null);
            return;
        }
        if (!currentUserData.bankAccountNumber || !currentUserData.bankName) {
            showModal('Bank Details Missing', 'Add your bank details in your profile before requesting a withdrawal.', () => window.location.href = 'profile.html');
            return;
        }
        const box = document.createElement('div');
        box.innerHTML = `
            <p style="margin-bottom:10px;">Available balance: <strong>${formatNaira(balance)}</strong></p>
            <div class="form-group">
                <label>Amount to withdraw (₦)</label>
                <input type="number" id="withdrawAmountInput" max="${balance}" min="1" value="${balance}" style="width:100%; background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 14px; color: var(--text-primary);">
            </div>
            <p style="font-size:0.78rem; color:var(--text-secondary); margin-top:8px;">Payout goes to ${escapeHtml(currentUserData.bankName)} — ${escapeHtml(currentUserData.bankAccountNumber)}. Requests are reviewed by admin and paid out via bank transfer.</p>
        `;
        showModal('Withdraw Funds', box, null);
        modalActionBtn.textContent = 'Request Withdrawal';
        modalActionBtn.onclick = async () => {
            const amount = Math.min(parseFloat(box.querySelector('#withdrawAmountInput').value) || 0, balance);
            if (amount <= 0) return;
            try {
                await addDoc(collection(db, 'withdrawals'), {
                    userId: currentUser.uid,
                    amount,
                    bankName: currentUserData.bankName,
                    bankAccountNumber: currentUserData.bankAccountNumber,
                    bankAccountName: currentUserData.bankAccountName || '',
                    status: 'pending',
                    requestedAt: serverTimestamp(),
                });
                await updateDoc(doc(db, 'users', currentUser.uid), {
                    walletBalance: balance - amount,
                    walletBalancePending: (currentUserData.walletBalancePending || 0) + amount,
                });
                currentUserData.walletBalance = balance - amount;
                balanceAmount.textContent = formatNaira(currentUserData.walletBalance);
                modalOverlay.classList.remove('active');
                showModal('Withdrawal Requested', `${formatNaira(amount)} withdrawal has been submitted and is pending admin processing.`, null);
            } catch (err) {
                console.error(err);
                showModal('Error', 'Could not submit withdrawal request.', null);
            }
        };
    });

    // ---------- HISTORY ----------
    document.getElementById('historyBtn').addEventListener('click', async () => {
        try {
            const q = query(collection(db, 'contracts'), where('freelancerId', '==', currentUser.uid));
            const snap = await getDocs(q);
            const completed = [];
            snap.forEach(d => { const c = d.data(); if (c.status === 'completed') completed.push(c); });
            if (completed.length === 0) {
                showModal('Transaction History', 'No completed contracts yet.', null);
                return;
            }
            const box = document.createElement('div');
            box.innerHTML = completed.map(c => `
                <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border-color);">
                    <span>${escapeHtml(c.title)}</span>
                    <strong>${formatNaira(c.payoutsEarned || 0)}</strong>
                </div>
            `).join('');
            showModal('Transaction History', box, null);
        } catch (err) {
            console.error(err);
            showModal('Error', 'Could not load history.', null);
        }
    });

    document.getElementById('browseBtn').addEventListener('click', () => { window.location.href = 'space.html'; });

    document.getElementById('learnProtectionBtn').addEventListener('click', () => {
        showModal('Insurance & Assurance', 'Insurance is a small fee a client can add when posting a gig — it signals the job is backed by extra protection. Assurance is the platform\'s dispute process: if a job goes wrong, either side can raise a dispute from the Disputes page and admin reviews it, deciding on refunds or payouts from funds held in escrow.', null);
    });

    // Notification bell is now a live dropdown — wired via initNotificationBell() in onAuthStateChanged above.

    // Sidebar nav routing
    document.querySelectorAll('.sidebar-menu li[data-route]').forEach(li => {
        li.addEventListener('click', () => {
            const route = li.dataset.route;
            if (route.includes('#')) {
                const [page, hash] = route.split('#');
                if (page === '' || page === window.location.pathname.split('/').pop()) {
                    document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
                } else {
                    window.location.href = route;
                }
            } else {
                window.location.href = route;
            }
            if (window.innerWidth <= 900) sidebar.classList.remove('mobile-open');
        });
    });
});
