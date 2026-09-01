// hm ============================================
// PROVASPACE — The Space (shared marketplace: gig feed for freelancers, talent search for clients)
// ============================================

import {
    auth, db, onAuthStateChanged, signOut,
    doc, getDoc, updateDoc,
    collection, query, where, orderBy, limit, getDocs,
    runTransaction, serverTimestamp,
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
        box.innerHTML = `
            <p style="margin-bottom:10px;"><strong>${escapeHtml(gig.title)}</strong></p>
            <p style="margin-bottom:10px;">${escapeHtml(gig.description)}</p>
            <p style="margin-bottom:6px;">Category: <strong>${escapeHtml(gig.category || 'Other')}</strong></p>
            <p style="margin-bottom:6px;">Price: <strong>${formatNaira(gig.price)}</strong></p>
            <p style="margin-bottom:6px;">Duration: <strong>${gig.duration} ${escapeHtml(gig.durationUnit || '')}</strong></p>
            ${gig.insuranceOpted ? '<p style="margin-bottom:6px;color:var(--accent-blue);"><i class="fa-solid fa-shield-halved"></i> Insured gig</p>' : ''}
        `;
        showModal('Gig Preview', box, null);
        modalActionBtn.textContent = 'Claim This Job';
        modalActionBtn.onclick = () => claimGig(gig.id);
    }

async function claimGig(gigId) {
    modalOverlay.classList.remove('active');

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

        const gigRef = doc(db, 'gigs', gigId);
        await runTransaction(db, async (t) => {
            const gigSnap = await t.get(gigRef);
            if (!gigSnap.exists()) throw new Error('Gig no longer exists.');
            const gig = gigSnap.data();
            if (gig.status !== 'open') throw new Error('This gig has already been claimed.');

            t.update(gigRef, { status: 'claimed', claimedBy: currentUser.uid, timerStart: serverTimestamp() });

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
                escrowBalance: gig.deposit || 0,   // only the deposit is in escrow initially
                createdAt: serverTimestamp(),
            });
        });

        showModal('Job Claimed', 'You\'ve claimed this job. It\'s now in your Active Contracts and the timer has started.', () => window.location.href = 'index.html#contracts');
    } catch (err) {
        console.error(err);
        showModal('Could Not Claim Job', err.message || 'Something went wrong. Please try again.', () => loadGigs());
    }
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
            snap.forEach(d => allResults.push({ id: d.id, ...d.data() }));
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
            const card = document.createElement('div');
            card.className = 'listing-card';
            card.innerHTML = `
                <div class="listing-top">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="listing-avatar">${initial}</div>
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
                    <button class="mini-btn mini-btn-outline">View Profile</button>
                </div>
            `;
            card.querySelector('[data-save]').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSaveFreelancer(fl.id);
            });
            card.addEventListener('click', () => openFreelancerPreview(fl));
            grid.appendChild(card);
        });
    }

    function openFreelancerPreview(fl) {
        const skills = Array.isArray(fl.skills) ? fl.skills.join(', ') : (fl.skills || '—');
        const box = document.createElement('div');
        box.innerHTML = `
            <p style="margin-bottom:6px;"><strong>${escapeHtml(fl.fullName)}</strong></p>
            <p style="margin-bottom:6px;">Location: ${escapeHtml(fl.location || '—')}</p>
            <p style="margin-bottom:6px;">Experience: ${fl.experience ?? '—'} years</p>
            <p style="margin-bottom:6px;">Skills: ${escapeHtml(skills)}</p>
            <p style="margin-bottom:6px;">Trust Score: ${fl.trustScore ?? 100}</p>
            ${fl.portfolioLink ? `<p style="margin-bottom:6px;"><a href="${escapeHtml(fl.portfolioLink)}" target="_blank" style="color:var(--accent-blue);">View Portfolio</a></p>` : ''}
            <p style="font-size:0.78rem; color:var(--text-secondary); margin-top:10px;">To hire, post a gig and invite this freelancer, or wait for them to claim your open gig from The Space.</p>
        `;
        showModal(fl.fullName || 'Freelancer', box, null);
        modalActionBtn.textContent = 'Post a Gig';
        modalActionBtn.onclick = () => { modalOverlay.classList.remove('active'); window.location.href = 'post-gig.html'; };
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