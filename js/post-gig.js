// ============================================
// PROVASPACE — Post a Gig (real Firestore + Paystack deposit logic)
// ============================================

import {
    auth, db, onAuthStateChanged,
    doc, getDoc, updateDoc,
    addDoc, collection, serverTimestamp, query, where, getDocs,
} from './firebase.js';
import { payWithPaystack } from './paystack.js';
import { notifyRole } from './notify-helper.js';

let currentUser = null;
let currentUserData = null;
let priceSettings = null;

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
    const milestonesBox = document.getElementById('milestonesBox');
    const addMilestoneBtn = document.getElementById('addMilestoneBtn');
    const milestoneTotal = document.getElementById('milestoneTotal');
    const form = document.getElementById('postGigForm');
    const insuranceFeeText = document.getElementById('insuranceFeeText');
    const submitBtn = form.querySelector('button[type="submit"]');

    function defaultPrices() {
        return { insuranceFeePercent: 3, taxPassTiers: [{ name: 'Slivering', gigLimit: 10, price: 5000 }] };
    }

    // ---------- AUTH GUARD ----------
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        currentUser = user;

        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userSnap.exists()) {
            window.location.href = 'signup.html';
            return;
        }
        currentUserData = userSnap.data();

        if (currentUserData.role !== 'client') {
            window.location.href = 'index.html';
            return;
        }

        const priceSnap = await getDoc(doc(db, 'settings', 'prices'));
        priceSettings = priceSnap.exists() ? priceSnap.data() : defaultPrices();

        insuranceFeeText.textContent = `Adds ${priceSettings.insuranceFeePercent}% of total gig price, held by the platform as protection.`;

        const gigsRemaining = currentUserData.taxPass?.gigsRemaining ?? 0;
        if (gigsRemaining <= 0) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.6';
            submitBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Buy a Tax Pass to Post';
            submitBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = 'client-dashboard.html';
            });
        }
    });

    function recalcMilestoneTotal() {
        const percents = [...document.querySelectorAll('.milestone-percent')].map(input => parseFloat(input.value) || 0);
        const total = percents.reduce((a, b) => a + b, 0);
        milestoneTotal.textContent = `Total: ${total}% (must equal 100%)`;
        milestoneTotal.style.color = total === 100 ? 'var(--accent-green)' : 'var(--accent-red)';
        return total;
    }

    function addMilestoneRow() {
        const row = document.createElement('div');
        row.className = 'milestone-row';
        row.innerHTML = `
            <input type="text" placeholder="Milestone name" class="milestone-name">
            <input type="number" placeholder="%" class="milestone-percent" min="0" max="100">
            <button type="button" class="remove-milestone-btn"><i class="fa-solid fa-xmark"></i></button>
        `;
        milestonesBox.appendChild(row);
        row.querySelector('.remove-milestone-btn').addEventListener('click', () => { row.remove(); recalcMilestoneTotal(); });
        row.querySelector('.milestone-percent').addEventListener('input', recalcMilestoneTotal);
    }

    addMilestoneBtn.addEventListener('click', addMilestoneRow);

    document.querySelectorAll('.remove-milestone-btn').forEach(btn => {
        btn.addEventListener('click', () => { btn.closest('.milestone-row').remove(); recalcMilestoneTotal(); });
    });
    document.querySelectorAll('.milestone-percent').forEach(input => {
        input.addEventListener('input', recalcMilestoneTotal);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const total = recalcMilestoneTotal();
        if (total !== 100) {
            alert('Milestone percentages must add up to 100%.');
            return;
        }

        const gigsRemaining = currentUserData.taxPass?.gigsRemaining ?? 0;
        if (gigsRemaining <= 0) {
            alert('You have no gig posts remaining on your current tax pass. Please buy or renew one first.');
            window.location.href = 'client-dashboard.html';
            return;
        }

        const milestones = [...document.querySelectorAll('.milestone-row')].map(row => ({
            name: row.querySelector('.milestone-name').value.trim(),
            percent: parseFloat(row.querySelector('.milestone-percent').value) || 0,
            released: false,
        }));

        const price = parseFloat(document.getElementById('gigPrice').value);
        const deposit = parseFloat(document.getElementById('gigDeposit').value);
        const insuranceOpted = document.getElementById('insuranceToggle').checked;
        const insuranceFee = insuranceOpted ? Math.round(price * (priceSettings.insuranceFeePercent / 100)) : 0;
        // Flat fee charged to FREELANCER when claiming an insured gig (admin-set)
        const assuranceFeeFlat = insuranceOpted ? (priceSettings.assuranceFeeFlat || 0) : 0;
        const amountToPayNow = deposit + insuranceFee;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing deposit...';

        // Check if email typed but not resolved
        const emailTyped = document.getElementById('assignFreelancerEmail')?.value.trim();
        if (emailTyped && !assignedFreelancer) {
            alert("You entered a freelancer email but it didn't resolve. Clear the field to post to The Space, or wait for lookup.");
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-square-plus"></i> Post Gig';
            return;
        }

        try {
            // Deposit (+ insurance fee if opted) is paid up front, held in escrow
            await payWithPaystack({
                email: currentUserData.email,
                amountNaira: amountToPayNow,
                metadata: { purpose: 'gigDeposit', insuranceOpted, uid: currentUser.uid },
            });

            const baseGigData = {
                title: document.getElementById('gigTitle').value.trim(),
                category: document.getElementById('gigCategory').value,
                description: document.getElementById('gigDescription').value.trim(),
                price,
                deposit,
                escrowBalance: deposit,
                insuranceFee,
                assuranceFeeFlat,
                duration: parseFloat(document.getElementById('gigDuration').value),
                durationUnit: document.getElementById('gigDurationUnit').value,
                milestones,
                insuranceOpted,
                terms: document.getElementById('gigTerms').value.trim(),
                postedBy: currentUser.uid,
                postedAt: serverTimestamp(),
            };

            if (assignedFreelancer) {
                // ── DIRECT HIRE PATH ─────────────────────────────────
                const gigData = { ...baseGigData, status: 'claimed', claimedBy: assignedFreelancer.uid, timerStart: serverTimestamp(), assignedDirectly: true };
                const gigRef = await addDoc(collection(db, 'gigs'), gigData);

                await addDoc(collection(db, 'contracts'), {
                    gigId: gigRef.id,
                    clientId: currentUser.uid,
                    freelancerId: assignedFreelancer.uid,
                    title: baseGigData.title,
                    milestones: milestones.map(m => ({ ...m, released: false })),
                    status: 'active',
                    payoutsEarned: 0,
                    totalPrice: price,
                    escrowBalance: deposit,
                    insuranceOpted,
                    insuranceFee,
                    assuranceFeeFlat,
                    directHire: true,
                    createdAt: serverTimestamp(),
                });

                // Notify freelancer of direct hire
                import('./notify-helper.js').then(({ notifyUser }) => {
                    notifyUser(assignedFreelancer.uid, {
                        title: '📩 You have been directly hired!',
                        message: `${currentUserData.displayName || 'A client'} assigned "${baseGigData.title}" to you. Check your active contracts.`,
                        type: 'direct_hire',
                        link: 'index.html#contracts',
                    });
                }).catch(() => {});

                await updateDoc(doc(db, 'users', currentUser.uid), { 'taxPass.gigsRemaining': gigsRemaining - 1 });
                alert('Gig assigned directly to ' + (assignedFreelancer.displayName || assignedFreelancer.email) + '! Contract is now active.');

            } else {
                // ── SPACE PATH ───────────────────────────────────────
                const gigData = { ...baseGigData, status: 'open', claimedBy: null, timerStart: null };
                await addDoc(collection(db, 'gigs'), gigData);
                await updateDoc(doc(db, 'users', currentUser.uid), { 'taxPass.gigsRemaining': gigsRemaining - 1 });

                notifyRole('freelancer', {
                    title: 'New gig posted',
                    message: `"${gigData.title}" was just posted — check The Space to claim it.`,
                    type: 'gig_posted',
                    link: 'space.html',
                }).catch(err => console.error('notifyRole failed', err));

                alert('Gig posted to The Space! Deposit is held in escrow.');
            }

            window.location.href = 'client-dashboard.html';
        } catch (err) {
            console.error(err);
            alert(err.message || 'Something went wrong posting the gig.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-square-plus"></i> Post Gig';
        }
    });

    recalcMilestoneTotal();

    // ── DIRECT ASSIGN — pre-fill from URL (assignUid) or manual email entry ──
    let assignedFreelancer = null;
    const assignInput  = document.getElementById('assignFreelancerEmail');
    const assignStatus = document.getElementById('assignLookupStatus');
    let lookupTimer = null;

    // Pre-fill from URL param set by Space → Assign button
    // Must run INSIDE onAuthStateChanged so Firestore (db) is ready
    const urlParams      = new URLSearchParams(window.location.search);
    const prefilledUid   = urlParams.get('assignUid');
    const prefilledName  = urlParams.get('assignName');

    if (prefilledUid && assignInput) {
        assignInput.disabled = true;
        assignInput.placeholder = 'Loading freelancer…';
        assignStatus.style.color = 'var(--text-secondary)';
        assignStatus.textContent = 'Looking up freelancer…';

        try {
            const flSnap = await getDoc(doc(db, 'users', prefilledUid));
            if (!flSnap.exists() || flSnap.data().role !== 'freelancer') {
                assignStatus.style.color = 'var(--accent-red)';
                assignStatus.textContent = 'Freelancer not found. You can type an email manually.';
                assignInput.disabled = false;
                assignInput.placeholder = 'Enter freelancer\'s account email';
            } else {
                assignedFreelancer = { uid: prefilledUid, ...flSnap.data() };
                const displayName = assignedFreelancer.fullName || assignedFreelancer.displayName || prefilledName || 'Freelancer';
                assignInput.value = assignedFreelancer.email || prefilledName || displayName;
                assignInput.readOnly = true;
                assignInput.style.cssText += 'border-color:var(--accent-blue);color:var(--accent-blue);font-weight:600;';
                assignStatus.style.color = 'var(--accent-green)';
                assignStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> Assigning to <strong>${escapeHtml(displayName)}</strong>`;
            }
        } catch (e) {
            console.error('Pre-fill lookup failed:', e);
            assignStatus.style.color = 'var(--accent-red)';
            assignStatus.textContent = 'Could not load freelancer. Type their email manually.';
            assignInput.disabled = false;
        }
    }

    assignInput?.addEventListener('input', () => {
        if (assignInput.readOnly) return;
        clearTimeout(lookupTimer);
        assignedFreelancer = null;
        const email = assignInput.value.trim().toLowerCase();
        if (!email) { assignStatus.textContent = ''; return; }
        assignStatus.style.color = 'var(--text-secondary)';
        assignStatus.textContent = 'Looking up…';
        lookupTimer = setTimeout(async () => {
            try {
                const q = query(collection(db, 'users'), where('email', '==', email), where('role', '==', 'freelancer'));
                const snap = await getDocs(q);
                if (snap.empty) {
                    assignStatus.style.color = 'var(--accent-red)';
                    assignStatus.textContent = 'No freelancer found with that email.';
                } else {
                    const d = snap.docs[0];
                    assignedFreelancer = { uid: d.id, ...d.data() };
                    assignStatus.style.color = 'var(--accent-green)';
                    assignStatus.textContent = `✓ Found: ${assignedFreelancer.fullName || assignedFreelancer.displayName || assignedFreelancer.email}`;
                }
            } catch (e) {
                assignStatus.style.color = 'var(--accent-red)';
                assignStatus.textContent = 'Lookup failed. Check your connection.';
            }
        }, 600);
    });
});