// ============================================
// PROVASPACE — Client Overview Dashboard
// ============================================

import {
    auth, db, onAuthStateChanged, signOut,
    doc, getDoc, updateDoc,
    collection, query, where, getDocs,
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

    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        document.body.classList.contains('dark-theme')
            ? themeIcon.classList.replace('fa-moon', 'fa-sun')
            : themeIcon.classList.replace('fa-sun', 'fa-moon');
    });

    function formatNaira(n) {
        return '₦ ' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }
    function defaultPrices() {
        return {
            rentWeekly: 2000, rentMonthly: 7000, rentYearly: 70000,
            overdueFeeFlat: 500, gracePeriodDays: 7,
            taxPassTiers: [
                { name: 'Slivering', gigLimit: 10, price: 5000 },
                { name: 'Golden Boy', gigLimit: 20, price: 9000 },
            ],
            insuranceFeePercent: 3,
        };
    }

    toggleBalance.addEventListener('click', () => {
        isBalanceHidden = !isBalanceHidden;
        balanceAmount.textContent = isBalanceHidden ? '₦ ••••••' : formatNaira(currentUserData?.totalSpent || 0);
        eyeIcon.classList.toggle('fa-eye');
        eyeIcon.classList.toggle('fa-eye-slash');
    });

    logoutBtn.addEventListener('click', async () => {
        await signOut(auth);
        window.location.href = 'login.html';
    });

    // ---------- AUTH GUARD + BOOT ----------
    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = 'login.html'; return; }
        currentUser = user;

        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userSnap.exists()) { window.location.href = 'signup.html'; return; }
        currentUserData = userSnap.data();

        if (currentUserData.role !== 'client') { window.location.href = 'index.html'; return; }

        const priceSnap = await getDoc(doc(db, 'settings', 'prices'));
        priceSettings = priceSnap.exists() ? priceSnap.data() : defaultPrices();

        populateHeader();
        populateTaxPassCard();
        await loadStatsAndContracts();
        initNotificationBell(user.uid);

        if (window.location.hash === '#contracts') {
            document.getElementById('contracts')?.scrollIntoView({ behavior: 'smooth' });
        }
    });

    function populateHeader() {
        const name = currentUserData.companyName || currentUserData.fullName || 'Client';
        const initial = name.trim().charAt(0).toUpperCase() || 'C';
        document.getElementById('sidebarName').textContent = name;
        document.getElementById('sidebarAvatar').textContent = initial;
        document.getElementById('topAvatar').textContent = initial;
        document.getElementById('topUsername').textContent = name;
        balanceAmount.textContent = formatNaira(currentUserData.totalSpent || 0);
        document.getElementById('statSaved').textContent = (currentUserData.savedFreelancers || []).length;
    }

    function populateTaxPassCard() {
        const pass = currentUserData.taxPass || {};
        const summary = document.getElementById('taxPassSummary');
        const fill = document.getElementById('taxPassProgressFill');
        const text = document.getElementById('taxPassProgressText');

        if (!pass.tier) {
            summary.textContent = 'No active tax pass. You need one to post gigs — buy a pass below.';
            fill.style.width = '0%';
            text.textContent = 'No pass active';
            return;
        }

        const limit = pass.gigLimit || 0;
        const remaining = pass.gigsRemaining ?? 0;
        const used = limit - remaining;
        const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;

        summary.textContent = `Tier: ${pass.tier} · ${remaining} gig post(s) remaining`;
        fill.style.width = pct + '%';
        text.textContent = `${used} / ${limit} gigs used`;
    }

    // ---------- STATS + ACTIVE CONTRACTS ----------
    async function loadStatsAndContracts() {
        const list = document.getElementById('contractsList');

        const [contractsSnap, gigsSnap] = await Promise.all([
            getDocs(query(collection(db, 'contracts'), where('clientId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'gigs'), where('postedBy', '==', currentUser.uid))),
        ]);

        const allContracts = [];
        contractsSnap.forEach(d => allContracts.push({ id: d.id, ...d.data() }));
        const active = allContracts.filter(c => c.status === 'active');
        const completed = allContracts.filter(c => c.status === 'completed');

        document.getElementById('statActiveContracts').textContent = active.length;
        document.getElementById('statGigsPosted').textContent = gigsSnap.size;
        document.getElementById('statCompletedGigs').textContent = completed.length;

        if (active.length === 0) {
            list.innerHTML = '<p class="empty-state" style="display:block;">No active contracts yet. Post a gig to get started.</p>';
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
                    <span>Released: <strong>${formatNaira(c.payoutsEarned || 0)}</strong></span>
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

    // ---------- TAX PASS PURCHASE ----------
    document.getElementById('buyTaxPassBtn').addEventListener('click', () => {
        const tiers = priceSettings.taxPassTiers || [];
        const box = document.createElement('div');
        box.innerHTML = `<p style="margin-bottom:10px;">Choose a tax pass tier (admin-set pricing):</p>` +
            tiers.map((t, i) => `
                <label style="display:flex; align-items:center; gap:10px; background:var(--bg-main); border:1px solid var(--border-color); border-radius:12px; padding:12px 14px; margin-bottom:8px; cursor:pointer;">
                    <input type="radio" name="taxTier" value="${i}" ${i === 0 ? 'checked' : ''}>
                    <span><strong>${escapeHtml(t.name)}</strong> — ${t.gigLimit} gigs — ${formatNaira(t.price)}</span>
                </label>
            `).join('');
        showModal('Buy Tax Pass', box, null);
        modalActionBtn.textContent = 'Pay Now';
        modalActionBtn.onclick = async () => {
            modalOverlay.classList.remove('active');
            const selectedIdx = parseInt(box.querySelector('input[name="taxTier"]:checked').value, 10);
            const tier = tiers[selectedIdx];
            try {
                await payWithPaystack({
                    email: currentUserData.email,
                    amountNaira: tier.price,
                    metadata: { purpose: 'taxPass', tier: tier.name, uid: currentUser.uid },
                });
                console.log({ email: currentUserData.email, amount: tier.price, tier: tier.name });
                await updateDoc(doc(db, 'users', currentUser.uid), {
                    'taxPass.tier': tier.name,
                    'taxPass.gigLimit': tier.gigLimit,
                    'taxPass.gigsRemaining': tier.gigLimit,
                });
                currentUserData.taxPass = { tier: tier.name, gigLimit: tier.gigLimit, gigsRemaining: tier.gigLimit };
                populateTaxPassCard();
                showModal('Tax Pass Active', `Your ${tier.name} pass is active with ${tier.gigLimit} gig posts.`, null);
            } catch (err) {
                console.error(err);
                showModal('Payment Not Completed', err.message || 'Payment was cancelled or failed.', null);
            }
        };
    });

    document.getElementById('postGigBtn').addEventListener('click', () => { window.location.href = 'post-gig.html'; });
    document.getElementById('findFreelancersBtn').addEventListener('click', () => { window.location.href = 'space.html'; });
    document.getElementById('savedFreelancersBtn').addEventListener('click', () => { window.location.href = 'space.html'; });

    document.getElementById('historyBtn').addEventListener('click', async () => {
        try {
            const q = query(collection(db, 'contracts'), where('clientId', '==', currentUser.uid));
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

    document.getElementById('learnProtectionBtn').addEventListener('click', () => {
        showModal('Insurance & Assurance', 'Insurance is a small fee you can add when posting a gig, held by the platform as extra protection. Assurance is the platform\'s dispute process — if a freelancer doesn\'t deliver, raise a dispute from the Disputes page and admin reviews it, deciding on refunds from the funds held in escrow.', null);
    });

    // Notification bell is now a live dropdown — wired via initNotificationBell() in onAuthStateChanged above.

    const sidebarTabs = document.querySelectorAll('.sidebar-menu li');
    sidebarTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            const routeMap = {
                home: 'client-dashboard.html',
                post: 'post-gig.html',
                space: 'space.html',
                disputes: 'disputes.html',
                profile: 'company-profile.html',
            };
            if (targetTab === 'contracts') {
                document.getElementById('contracts')?.scrollIntoView({ behavior: 'smooth' });
            } else if (routeMap[targetTab]) {
                window.location.href = routeMap[targetTab];
            }
            if (window.innerWidth <= 900) sidebar.classList.remove('mobile-open');
        });
    });
});
