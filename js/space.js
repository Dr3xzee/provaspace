// hm ============================================
// PROVASPACE — The Space (shared marketplace: gig feed for freelancers, talent search for clients)
// ============================================

import {
    auth, db, onAuthStateChanged, signOut,
    doc, getDoc, updateDoc,
    collection, query, where, orderBy, limit, getDocs,
    runTransaction, serverTimestamp, arrayUnion,
} from './firebase.js';

let currentUser = null;
let currentUserData = null;
let allResults = [];
let activeCategory = 'all';

const CATEGORIES = ['Design', 'Development', 'Writing', 'Marketing', 'Video', 'Admin/Support', 'Other'];

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
        const isDark = document.body.classList.toggle('dark-theme');
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        isDark
            ? themeIcon.classList.replace('fa-moon', 'fa-sun')
            : themeIcon.classList.replace('fa-sun', 'fa-moon');
        localStorage.setItem('prova_theme', isDark ? 'dark' : 'light');
    });

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }
    function formatNaira(n) {
        return '₦ ' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = 'login.html'; return; }
        currentUser = user;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { window.location.href = 'signup.html'; return; }
        currentUserData = snap.data();

        const initial = (currentUserData.companyName || currentUserData.fullName || '?').trim().charAt(0).toUpperCase();
        document.getElementById('sidebarAvatar').textContent = initial;
        document.getElementById('sidebarName').textContent = currentUserData.companyName || currentUserData.fullName || 'User';
        document.getElementById('sidebarRole').textContent = currentUserData.role === 'client' ? 'Client' : 'Freelancer';

        backBtn.onclick = () => window.location.href = currentUserData.role === 'client' ? 'client-dashboard.html' : 'index.html';

        buildSidebarNav();
        buildBottomNav();

        if (currentUserData.role === 'client') {
            setupClientMode();
            await loadFreelancers();
        } else {
            setupFreelancerMode();
            await loadGigs();
        }

        document.getElementById('searchBtn').addEventListener('click', applyFilters);
        document.getElementById('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
    });

    function buildSidebarNav() {
        const isClient = currentUserData.role === 'client';
        const menu = document.getElementById('sidebarMenu');
        const home = isClient ? 'client-dashboard.html' : 'index.html';
        menu.innerHTML = `
            <li data-route="${home}"><i class="fa-solid fa-chart-pie"></i> Overview</li>
            ${isClient ? '<li data-route="post-gig.html"><i class="fa-solid fa-square-plus"></i> Post a Gig</li>' : ''}
            <li class="active"><i class="fa-solid fa-globe"></i> The Space</li>
            <li data-route="${home}#contracts"><i class="fa-solid fa-file-signature"></i> Active Contracts</li>
            <li data-route="disputes.html"><i class="fa-solid fa-triangle-exclamation"></i> Disputes</li>
            <li data-route="${isClient ? 'company-profile.html' : 'profile.html'}"><i class="fa-solid ${isClient ? 'fa-building' : 'fa-user'}"></i> Profile</li>
        `;
        menu.querySelectorAll('li[data-route]').forEach(li => {
            li.addEventListener('click', () => { window.location.href = li.dataset.route; });
        });
    }

    function buildBottomNav() {
        const isClient = currentUserData.role === 'client';
        const home = isClient ? 'client-dashboard.html' : 'index.html';
        document.getElementById('bottomNav').innerHTML = `
            <a href="${home}" class="nav-item"><i class="fa-solid fa-chart-pie"></i><span>Overview</span></a>
            <a href="space.html" class="nav-item active"><i class="fa-solid fa-globe"></i><span>Space</span></a>
            ${isClient ? '<a href="post-gig.html" class="nav-item"><i class="fa-solid fa-square-plus"></i><span>Post</span></a>' : ''}
            <a href="disputes.html" class="nav-item"><i class="fa-solid fa-triangle-exclamation"></i><span>Disputes</span></a>
        `;
    }

    // ============================================
    // FREELANCER MODE — browse & claim gigs
    // ============================================
    function setupFreelancerMode() {
        document.getElementById('spaceTitle').textContent = 'The Space';
        document.getElementById('spaceSubtitle').textContent = 'Browse open gigs and claim work that fits your skills.';
        const chipsBox = document.getElementById('filterChips');
        chipsBox.innerHTML = '<button class="filter-chip active" data-filter="all">All</button>' +
            CATEGORIES.map(c => `<button class="filter-chip" data-filter="${c}">${c}</button>`).join('');
        wireChips();
    }

    async function loadGigs() {
        const grid = document.getElementById('resultsGrid');
        grid.innerHTML = '<p class="empty-state" style="display:block; grid-column:1/-1;">Loading gigs...</p>';
        try {
            const q = query(collection(db, 'gigs'), where('status', '==', 'open'), orderBy('postedAt', 'desc'), limit(50));
            const snap = await getDocs(q);
            allResults = [];
            snap.forEach(d => allResults.push({ id: d.id, ...d.data() }));
            renderGigs(allResults);
        } catch (err) {
            console.error(err);
            grid.innerHTML = '<p class="empty-state" style="display:block; grid-column:1/-1;">Could not load gigs. This query may need a Firestore composite index on gigs(status, postedAt) — check the Firebase console for a direct link the first time it runs.</p>';
        }
    }

    function renderGigs(list) {
        const grid = document.getElementById('resultsGrid');
        if (list.length === 0) {
            grid.innerHTML = '<p class="empty-state" style="display:block; grid-column:1/-1;">No gigs match your search.</p>';
            return;
        }
        grid.innerHTML = '';
        list.forEach(gig => {
            const card = document.createElement('div');
            card.className = 'listing-card';
            card.innerHTML = `
                <div class="listing-top">
                    <span class="listing-title">${escapeHtml(gig.title)}</span>
                    ${gig.insuranceOpted ? '<i class="fa-solid fa-shield-halved" style="color:var(--accent-blue);" title="Insured"></i>' : ''}
                </div>
                <span class="listing-sub">${escapeHtml(gig.category || 'Other')} · ${gig.duration} ${escapeHtml(gig.durationUnit || '')}</span>
                <p class="listing-desc">${escapeHtml(gig.description)}</p>
                <div class="listing-footer">
                    <span class="listing-price">${formatNaira(gig.price)}</span>
                    <button class="mini-btn">Claim</button>
                </div>
            `;
            card.addEventListener('click', () => openGigPreview(gig));
            grid.appendChild(card);
        });
    }

    function openGigPreview(gig) {
        const box = document.createElement('div');

        // Build abandoned progress info if any
        let abandonedInfo = '';
        if (gig.previousFreelancer && gig.abandonedMilestones) {
            const completedMs = (gig.abandonedMilestones || []).filter(m => m.released);
            const totalMs = (gig.abandonedMilestones || []).length;
            const paidSoFar = gig.previousPayoutsEarned || 0;
            abandonedInfo = `
                <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:0.8rem;">
                    <p style="font-weight:700;color:#92400e;margin-bottom:4px;">⚠️ Previously abandoned</p>
                    <p style="color:#78350f;">${completedMs.length} of ${totalMs} milestone(s) already paid out (${formatNaira(paidSoFar)}). You continue from where the last freelancer stopped.</p>
                </div>
            `;
        }

        const assuranceNote = gig.insuranceOpted && gig.assuranceFeeFlat > 0
            ? `<p style="margin-bottom:6px;color:var(--accent-blue);"><i class="fa-solid fa-shield-halved"></i> Insured — assurance fee: <strong>${formatNaira(gig.assuranceFeeFlat)}</strong></p>`
            : gig.insuranceOpted ? `<p style="margin-bottom:6px;color:var(--accent-blue);"><i class="fa-solid fa-shield-halved"></i> Insured gig</p>` : '';

        box.innerHTML = `
            ${abandonedInfo}
            <p style="margin-bottom:10px;"><strong>${escapeHtml(gig.title)}</strong></p>
            <p style="margin-bottom:10px;">${escapeHtml(gig.description)}</p>
            <p style="margin-bottom:6px;">Category: <strong>${escapeHtml(gig.category || 'Other')}</strong></p>
            <p style="margin-bottom:6px;">Price: <strong>${formatNaira(gig.price)}</strong></p>
            <p style="margin-bottom:6px;">Duration: <strong>${gig.duration} ${escapeHtml(gig.durationUnit || '')}</strong></p>
            ${assuranceNote}
        `;
        showModal('Gig Preview', box, null);
        modalActionBtn.textContent = 'Claim This Job';
        modalActionBtn.onclick = () => claimGig(gig.id);
    }

function showRentGate() {
    if (document.getElementById('ssRentGate')) return; // don't double-render

    const gate = document.createElement('div');
    gate.id = 'ssRentGate';
    gate.style.cssText = `
        position:fixed;inset:0;background:rgba(15,23,42,0.88);backdrop-filter:blur(8px);
        z-index:50000;display:flex;align-items:center;justify-content:center;padding:20px;
    `;
    gate.innerHTML = `
        <div style="background:var(--bg-card);border-radius:24px;padding:32px;max-width:420px;width:100%;text-align:center;box-shadow:0 24px 48px rgba(0,0,0,0.3);">
            <div style="font-size:3rem;margin-bottom:16px;">🏠</div>
            <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:10px;">Pay Rent to Claim</h2>
            <p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:20px;line-height:1.6;">
                You're browsing the Space for free — but to claim a gig you need an active rent plan.
            </p>
            <div id="spaceRentPicker" style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
                <p style="color:var(--text-secondary);font-size:0.85rem;">Loading plans…</p>
            </div>
            <button id="spaceRentPayBtn" style="width:100%;background:var(--accent-gradient);color:white;border:none;border-radius:14px;padding:14px;font-weight:700;font-size:0.95rem;cursor:pointer;display:none;">
                Pay &amp; Claim
            </button>
            <button id="spaceRentClose" style="width:100%;background:transparent;border:none;color:var(--text-secondary);margin-top:12px;font-size:0.85rem;cursor:pointer;">
                Maybe later — keep browsing
            </button>
        </div>
    `;
    document.body.appendChild(gate);
    document.getElementById('spaceRentClose').addEventListener('click', () => gate.remove());

    // Load plans from settings
    getDoc(doc(db, 'settings', 'prices')).then(snap => {
        const plans = snap.exists() && snap.data().rentTiers?.length
            ? snap.data().rentTiers
            : [{ name: 'Weekly', days: 7, price: 2000 }, { name: 'Monthly', days: 30, price: 7000 }, { name: 'Yearly', days: 365, price: 70000 }];

        const picker = document.getElementById('spaceRentPicker');
        picker.innerHTML = '';
        let selectedIdx = 0;

        plans.forEach((p, i) => {
            const priceLabel = p.price === 0
                ? '<span style="color:#10b981;font-weight:800;">Free</span>'
                : `₦${p.price.toLocaleString()}`;
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;gap:12px;background:var(--bg-main);border:1.5px solid var(--border-color);border-radius:12px;padding:12px 16px;cursor:pointer;text-align:left;';
            lbl.innerHTML = `
                <input type="radio" name="spaceRentPlan" value="${i}" ${i===0?'checked':''} style="accent-color:#4169E1;flex-shrink:0;">
                <span><strong>${p.name}</strong> · ${p.days} day(s) · ${priceLabel}</span>
            `;
            lbl.querySelector('input').addEventListener('change', () => { selectedIdx = i; updateBtn(); });
            picker.appendChild(lbl);
        });

        const payBtn = document.getElementById('spaceRentPayBtn');
        payBtn.style.display = 'block';

        function updateBtn() {
            payBtn.textContent = plans[selectedIdx].price === 0 ? '✓ Activate Free Plan & Claim' : 'Pay Rent & Claim';
        }
        updateBtn();

        payBtn.addEventListener('click', async () => {
            const plan = plans[selectedIdx];
            const existingDue = currentUserData.rentStatus?.dueDate?.toDate
                ? currentUserData.rentStatus.dueDate.toDate()
                : (currentUserData.rentStatus?.dueDate ? new Date(currentUserData.rentStatus.dueDate) : null);
            const base = existingDue && existingDue > new Date() ? existingDue : new Date();
            const dueDate = new Date(base);
            dueDate.setDate(dueDate.getDate() + plan.days);

            try {
                if (plan.price > 0) {
                    await payWithPaystackSpace({
                        email: currentUserData.email,
                        amountNaira: plan.price,
                        metadata: { purpose: 'rent', plan: plan.name, uid: currentUser.uid },
                    });
                } else if (currentUserData.hasUsedFreeRent) {
                    alert('You\'ve already claimed a free rent plan. Please pick a paid plan.');
                    return;
                }
                await updateDoc(doc(db, 'users', currentUser.uid), {
                    'rentStatus.plan': plan.name,
                    'rentStatus.amountOwed': 0,
                    'rentStatus.dueDate': dueDate,
                });
                if (plan.price === 0) {
                    await updateDoc(doc(db, 'users', currentUser.uid), { hasUsedFreeRent: true });
                    currentUserData.hasUsedFreeRent = true;
                }
                currentUserData.rentStatus = { plan: plan.name, amountOwed: 0, dueDate };
                gate.remove();
                // Small toast then re-trigger claim
                const t = document.createElement('div');
                t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:10px 22px;border-radius:999px;font-weight:700;font-size:0.85rem;z-index:99999;';
                t.textContent = `${plan.name} rent active ✓ — tap Claim again to proceed`;
                document.body.appendChild(t);
                setTimeout(() => t.remove(), 3500);
            } catch (err) {
                console.error(err);
                alert(err.message || 'Payment failed. Try again.');
            }
        });
    }).catch(() => {
        document.getElementById('spaceRentPicker').innerHTML = '<p style="color:#ef4444;font-size:0.85rem;">Could not load plans. Check your connection.</p>';
    });
}

async function claimGig(gigId) {
    modalOverlay.classList.remove('active');

    // ── ONE-CLAIM-PER-GIG CHECK ───────────────────────────────────
    const alreadyClaimed = (currentUserData.claimedGigIds || []).includes(gigId);
    if (alreadyClaimed) {
        showModal('Already Claimed', 'You have already claimed this gig before. Each gig can only be claimed once per freelancer.', null);
        return;
    }
    // ─────────────────────────────────────────────────────────────

    // ── RENT CHECK ────────────────────────────────────────────────
    const rent = currentUserData.rentStatus || {};
    const rentCredit = currentUserData.rentCredit || 0;
    const planActive = rent.plan && rent.dueDate &&
        (rent.dueDate?.toDate ? rent.dueDate.toDate() : new Date(rent.dueDate)) > new Date();

    if (!planActive && rentCredit <= 0) {
        showRentGate();
        return;
    }
    // ──────────────────────────────────────────────────────────────

    const missing = [];
    if (!currentUserData.ninNumber || !currentUserData.ninVerified) missing.push('NIN verification');
    if (!currentUserData.bankAccountNumber || !currentUserData.bankName || !currentUserData.bankAccountName) missing.push('bank details');

    if (missing.length > 0) {
        showModal('Profile Incomplete', `You must add the following before claiming a job: ${missing.join(', ')}.`, () => window.location.href = 'profile.html');
        return;
    }

    try {
        const activeQ = query(collection(db, 'contracts'), where('freelancerId', '==', currentUser.uid), where('status', '==', 'active'));
        const activeSnap = await getDocs(activeQ);
        if (activeSnap.size >= 3) {
            showModal('Job Limit Reached', 'You can only hold a maximum of 3 active jobs at once.', null);
            return;
        }

        // Fetch gig to check insurance BEFORE transaction
        const gigSnap = await getDocs(query(collection(db, 'gigs'), where('__name__', '==', gigId)));
        const gigDocSnap = await import('./firebase.js').then(m => m.getDoc(m.doc(db, 'gigs', gigId)));
        if (!gigDocSnap.exists()) {
            showModal('Gig Not Found', 'This gig no longer exists.', () => loadGigs());
            return;
        }
        const gigData = gigDocSnap.data();

        // ── INSURANCE / ASSURANCE CHECK ────────────────────────
        const assuranceFee = gigData.assuranceFeeFlat || gigData.insuranceFee || 0;
        if (gigData.insuranceOpted && assuranceFee > 0) {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
                background:#4169E1; color:white; padding:12px 24px; border-radius:999px;
                font-size:0.85rem; font-weight:700; z-index:99999; white-space:nowrap;
                box-shadow:0 8px 24px rgba(65,105,225,0.4);
            `;
            toast.innerHTML = `<i class="fa-solid fa-shield-halved" style="margin-right:8px;"></i>This gig is insured — assurance fee required`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3500);

            // Show assurance fee modal
            showModal(
                '🛡️ Insured Gig — Assurance Fee Required',
                `<p style="margin-bottom:10px;">This gig has insurance enabled by the client. To claim it, you must pay the freelancer assurance fee:</p>
                <p style="font-size:1.2rem; font-weight:800; color:var(--accent-blue); margin-bottom:10px;">${formatNaira(assuranceFee)}</p>
                <p style="font-size:0.8rem; color:var(--text-secondary);">This fee is held by the platform for the duration of the contract and partially refunded if there's no dispute.</p>`,
                null
            );
            modalActionBtn.textContent = 'Pay & Claim';
            modalActionBtn.onclick = async () => {
                modalOverlay.classList.remove('active');
                try {
                    await payWithPaystackSpace({
                        email: currentUserData.email,
                        amountNaira: assuranceFee,
                        metadata: { purpose: 'assuranceFee', gigId, uid: currentUser.uid },
                    });
                    await doClaimTransaction(gigId, gigData);
                } catch (err) {
                    console.error(err);
                    showModal('Payment Failed', err.message || 'Could not process assurance fee payment.', null);
                }
            };
            return;
        }
        // ──────────────────────────────────────────────────────

        await doClaimTransaction(gigId, gigData);
    } catch (err) {
        console.error(err);
        showModal('Could Not Claim Job', err.message || 'Something went wrong. Please try again.', () => loadGigs());
    }
}

async function doClaimTransaction(gigId, gigData) {
    const gigRef = doc(db, 'gigs', gigId);
    await runTransaction(db, async (t) => {
        const gigSnap = await t.get(gigRef);
        if (!gigSnap.exists()) throw new Error('Gig no longer exists.');
        const gig = gigSnap.data();
        if (gig.status !== 'open') throw new Error('This gig has already been claimed.');

        t.update(gigRef, { status: 'claimed', claimedBy: currentUser.uid, timerStart: serverTimestamp() });

        // Record this gig as claimed by this freelancer — prevents re-claiming
        const userRef = doc(db, 'users', currentUser.uid);
        t.update(userRef, { claimedGigIds: arrayUnion(gigId) });

        const contractRef = doc(collection(db, 'contracts'));
        t.set(contractRef, {
            gigId,
            clientId: gig.postedBy,
            freelancerId: currentUser.uid,
            title: gig.title,
            milestones: (gig.milestones || []).map(m => ({ ...m, released: false })),
            status: 'active',
            payoutsEarned: 0,
            totalPrice: gig.price,
            escrowBalance: gig.deposit || 0,
            insuranceOpted: gig.insuranceOpted || false,
            insuranceFee: gig.insuranceFee || 0,
            createdAt: serverTimestamp(),
        });
    });

    showModal('Job Claimed! 🎉', 'You\'ve claimed this job. It\'s now in your Active Contracts and the timer has started.', () => window.location.href = 'index.html#contracts');
    // Update local cache so same-session re-claim attempt is also blocked
    currentUserData.claimedGigIds = [...(currentUserData.claimedGigIds || []), gigId];
}

// Paystack wrapper for space.js (no dependency on paystack.js import)
function payWithPaystackSpace({ email, amountNaira, metadata }) {
    return new Promise((resolve, reject) => {
        if (typeof PaystackPop === 'undefined') {
            reject(new Error('Paystack not loaded.'));
            return;
        }
        const handler = PaystackPop.setup({
            key: window.PAYSTACK_PUBLIC_KEY || 'pk_live_xxxxxxxxxxxxxxxx',
            email,
            amount: Math.round(amountNaira * 100),
            currency: 'NGN',
            metadata,
            callback: () => resolve(),
            onClose: () => reject(new Error('Payment window closed.')),
        });
        handler.openIframe();
    });
}

    // ============================================
    // CLIENT MODE — browse & save freelancers
    // ============================================
    function setupClientMode() {
        document.getElementById('spaceTitle').textContent = 'The Space';
        document.getElementById('spaceSubtitle').textContent = 'Find and save freelancers by skill.';
        const chipsBox = document.getElementById('filterChips');
        chipsBox.innerHTML = `
            <button class="filter-chip active" data-filter="all">All</button>
            <button class="filter-chip" data-filter="saved">Saved</button>
        `;
        wireChips();
    }

    async function loadFreelancers() {
    const grid = document.getElementById('resultsGrid');
    grid.innerHTML = '<p class="empty-state" style="display:block; grid-column:1/-1;">Loading freelancers...</p>';
    try {
        const q = query(collection(db, 'users'), where('role', '==', 'freelancer'));
        const snap = await getDocs(q);
        allResults = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.banned === true) return; // exclude banned users
            allResults.push({ id: d.id, ...data });
        });
        allResults.sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0));
        renderFreelancers(allResults);
    } catch (err) {
        console.error(err);
        grid.innerHTML = '<p class="empty-state" style="display:block; grid-column:1/-1;">Could not load freelancers.</p>';
    }
}

    function renderFreelancers(list) {
        const grid = document.getElementById('resultsGrid');
        const saved = currentUserData.savedFreelancers || [];
        if (list.length === 0) {
            grid.innerHTML = '<p class="empty-state" style="display:block; grid-column:1/-1;">No freelancers match.</p>';
            return;
        }
        grid.innerHTML = '';
        list.forEach(fl => {
            const isSaved = saved.includes(fl.id);
            const initial = (fl.fullName || '?').trim().charAt(0).toUpperCase();
            const skills = Array.isArray(fl.skills) ? fl.skills.join(', ') : (fl.skills || '');
            const avatarHtml = fl.avatarUrl
                ? `<img src="${escapeHtml(fl.avatarUrl)}" alt="${escapeHtml(fl.fullName || '')}" loading="lazy">`
                : initial;
            const card = document.createElement('div');
            card.className = 'listing-card';
            card.innerHTML = `
                <div class="listing-top">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="listing-avatar">${avatarHtml}</div>
                        <div>
                            <div class="listing-title">${escapeHtml(fl.fullName || 'Freelancer')}</div>
                            <div class="listing-sub">${escapeHtml(fl.location || '—')} · Trust ${fl.trustScore ?? 100}</div>
                        </div>
                    </div>
                    <button class="bookmark-btn ${isSaved ? 'saved' : ''}" data-save="${fl.id}"><i class="fa-solid fa-bookmark"></i></button>
                </div>
                <p class="listing-desc">${escapeHtml(skills || 'No skills listed yet.')}</p>
                <div class="listing-footer">
                    <span class="listing-sub">${fl.ninVerified ? '<i class="fa-solid fa-circle-check" style="color:var(--accent-green);"></i> Verified' : 'Unverified'}</span>
                    <div style="display:flex;gap:8px;">
                        <button class="mini-btn mini-btn-outline view-btn">View Profile</button>
                        ${currentUserData.role === 'client' ? `<button class="mini-btn assign-btn" style="background:var(--accent-gradient);color:#fff;" data-email="${escapeHtml(fl.email || '')}" data-name="${escapeHtml(fl.fullName || '')}"><i class="fa-solid fa-user-check"></i> Assign</button>` : ''}
                    </div>
                </div>
            `;
            card.querySelector('[data-save]').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSaveFreelancer(fl.id);
            });
            card.querySelector('.view-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                openFreelancerPreview(fl);
            });
            card.querySelector('.assign-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                assignFreelancer(fl);
            });
            card.addEventListener('click', () => openFreelancerPreview(fl));
            grid.appendChild(card);
        });
    }

    function openFreelancerPreview(fl) {
        const skills = Array.isArray(fl.skills) ? fl.skills.join(', ') : (fl.skills || '—');
        const box = document.createElement('div');
        const modalAvatar = fl.avatarUrl
            ? `<img src="${escapeHtml(fl.avatarUrl)}" alt="${escapeHtml(fl.fullName || '')}" style="width:68px;height:68px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color);">`
            : `<div style="width:68px;height:68px;border-radius:50%;background:var(--accent-gradient);color:white;display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;">${(fl.fullName||'?').charAt(0).toUpperCase()}</div>`;
        box.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:14px;">${modalAvatar}</div>
            <p style="margin-bottom:6px;text-align:center;"><strong>${escapeHtml(fl.fullName)}</strong></p>
            <p style="margin-bottom:6px;">Location: ${escapeHtml(fl.location || '—')}</p>
            <p style="margin-bottom:6px;">Experience: ${fl.experience ?? '—'} years</p>
            <p style="margin-bottom:6px;">Skills: ${escapeHtml(skills)}</p>
            <p style="margin-bottom:6px;">Trust Score: ${fl.trustScore ?? 100}</p>
            ${fl.portfolioLink ? `<p style="margin-bottom:6px;"><a href="${escapeHtml(fl.portfolioLink)}" target="_blank" style="color:var(--accent-blue);">View Portfolio</a></p>` : ''}
            <p style="font-size:0.78rem; color:var(--text-secondary); margin-top:10px;">To hire, post a gig and invite this freelancer, or wait for them to claim your open gig from The Space.</p>
        `;
        showModal(fl.fullName || 'Freelancer', box, null);
        modalActionBtn.textContent = 'Assign This Freelancer';
        modalActionBtn.onclick = () => { modalOverlay.classList.remove('active'); assignFreelancer(fl); };
    }

    function assignFreelancer(fl) {
        window.location.href = `post-gig.html?assignUid=${encodeURIComponent(fl.id)}&assignName=${encodeURIComponent(fl.fullName || fl.displayName || '')}`;
    }

    async function toggleSaveFreelancer(freelancerId) {
        const saved = currentUserData.savedFreelancers || [];
        const isSaved = saved.includes(freelancerId);
        const updated = isSaved ? saved.filter(id => id !== freelancerId) : [...saved, freelancerId];
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { savedFreelancers: updated });
            currentUserData.savedFreelancers = updated;
            applyFilters();
        } catch (err) {
            console.error(err);
        }
    }

    // ============================================
    // SEARCH + FILTER (shared)
    // ============================================
    function wireChips() {
        document.querySelectorAll('.filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                activeCategory = chip.dataset.filter;
                applyFilters();
            });
        });
    }

    function applyFilters() {
        const term = document.getElementById('searchInput').value.trim().toLowerCase();
        const isClient = currentUserData.role === 'client';

        let filtered = allResults;

        if (isClient) {
            if (activeCategory === 'saved') {
                const saved = currentUserData.savedFreelancers || [];
                filtered = filtered.filter(fl => saved.includes(fl.id));
            }
            if (term) {
                filtered = filtered.filter(fl => {
                    const skills = Array.isArray(fl.skills) ? fl.skills.join(' ') : (fl.skills || '');
                    return (fl.fullName || '').toLowerCase().includes(term) ||
                        skills.toLowerCase().includes(term) ||
                        (fl.location || '').toLowerCase().includes(term);
                });
            }
            renderFreelancers(filtered);
        } else {
            if (activeCategory !== 'all') {
                filtered = filtered.filter(g => (g.category || 'Other') === activeCategory);
            }
            if (term) {
                filtered = filtered.filter(g =>
                    (g.title || '').toLowerCase().includes(term) ||
                    (g.description || '').toLowerCase().includes(term)
                );
            }
            renderGigs(filtered);
        }
    }
});