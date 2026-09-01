// ============================================
// PROVASPACE — Post a Gig (real Firestore + Paystack deposit logic)
// ============================================

import {
    auth, db, onAuthStateChanged,
    doc, getDoc, updateDoc,
    addDoc, collection, serverTimestamp,
} from './firebase.js';
import { payWithPaystack } from './paystack.js';
import { notifyRole } from './notify-helper.js';

let currentUser = null;
let currentUserData = null;
let priceSettings = null;

document.addEventListener('DOMContentLoaded', () => {
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
        const amountToPayNow = deposit + insuranceFee;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing deposit...';

        try {
            // Deposit (+ insurance fee if opted) is paid up front, held by the platform (escrow)
            await payWithPaystack({
                email: currentUserData.email,
                amountNaira: amountToPayNow,
                metadata: { purpose: 'gigDeposit', insuranceOpted, uid: currentUser.uid },
            });

            const gigData = {
                title: document.getElementById('gigTitle').value.trim(),
                category: document.getElementById('gigCategory').value,
                description: document.getElementById('gigDescription').value.trim(),
                price,
                deposit,
                escrowBalance: deposit,   // tracks real money held; grows when client tops up
                insuranceFee,
                duration: parseFloat(document.getElementById('gigDuration').value),
                durationUnit: document.getElementById('gigDurationUnit').value,
                milestones,
                insuranceOpted,
                terms: document.getElementById('gigTerms').value.trim(),
                postedBy: currentUser.uid,
                status: 'open',
                claimedBy: null,
                timerStart: null,
                postedAt: serverTimestamp(),
            };

            // Note: this write (and the tax-pass decrement below) happen client-side for this
            // build. In production, move this into a Cloud Function triggered after Paystack
            // server-side verification so price/deposit/tax-pass values can't be tampered with.
            await addDoc(collection(db, 'gigs'), gigData);

            await updateDoc(doc(db, 'users', currentUser.uid), {
                'taxPass.gigsRemaining': gigsRemaining - 1,
            });

            // Let freelancers know a fresh gig is up for grabs.
            notifyRole('freelancer', {
                title: 'New gig posted',
                message: `"${gigData.title}" was just posted — check The Space to claim it.`,
                type: 'gig_posted',
                link: 'space.html',
            }).catch(err => console.error('notifyRole failed', err));

            alert('Gig posted successfully! Deposit is held in escrow.');
            window.location.href = 'client-dashboard.html';
        } catch (err) {
            console.error(err);
            alert(err.message || 'Something went wrong posting the gig.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-square-plus"></i> Post Gig';
        }
    });

    recalcMilestoneTotal();
});