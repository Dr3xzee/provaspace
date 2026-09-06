// ============================================
// PROVASPACE — Auth logic (signup.html + login.html)
// ============================================
import {
    auth, db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    googleProvider,
    doc, setDoc, getDoc,
    serverTimestamp,
    sendPasswordResetEmail,
} from './firebase.js';
import { initPush } from './push-notifications.js';
import { generateReferralCode, applyReferralOnSignup } from './referral-helper.js';

function redirectForRole(role) {
    if (role === 'client') window.location.href = 'client-dashboard.html';
    else if (role === 'admin') window.location.href = 'admin.html';
    else window.location.href = 'index.html';
}

async function initPushThenRedirect(uid, role) {
    try { await initPush(uid); } catch (e) { /* non-fatal */ }
    redirectForRole(role);
}

// Pull referral code from URL if present: signup.html?ref=PV-XXXXXX
function getRefCodeFromUrl() {
    return new URLSearchParams(window.location.search).get('ref') || '';
}

// --------------------------------------------
// SIGNUP PAGE
// --------------------------------------------
const signupForm = document.getElementById('signupForm');
if (signupForm) {
    let selectedRole = 'freelancer';
    const roleFreelancerBtn = document.getElementById('roleFreelancer');
    const roleClientBtn = document.getElementById('roleClient');
    const nameLabel = document.getElementById('nameLabel');
    const companyNameGroup = document.getElementById('companyNameGroup');
    const formError = document.getElementById('formError');

    // Pre-fill referral field if code in URL
    const refFromUrl = getRefCodeFromUrl();
    const refInput = document.getElementById('referralCodeInput');
    if (refInput && refFromUrl) refInput.value = refFromUrl;

    function setRole(role) {
        selectedRole = role;
        roleFreelancerBtn.classList.toggle('active', role === 'freelancer');
        roleClientBtn.classList.toggle('active', role === 'client');
        companyNameGroup.style.display = role === 'client' ? 'flex' : 'none';
        nameLabel.textContent = role === 'client' ? 'Contact Full Name' : 'Full Name';
    }
    roleFreelancerBtn.addEventListener('click', () => setRole('freelancer'));
    roleClientBtn.addEventListener('click', () => setRole('client'));

    function showError(msg) {
        formError.textContent = msg;
        formError.style.display = 'block';
    }

    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        formError.style.display = 'none';
        const fullName = document.getElementById('fullName').value.trim();
        const companyName = document.getElementById('companyName')?.value.trim() || '';
        const email = document.getElementById('email').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const refCode = document.getElementById('referralCodeInput')?.value.trim() || '';

        if (password !== confirmPassword) { showError('Passwords do not match.'); return; }
        if (password.length < 8) { showError('Password must be at least 8 characters.'); return; }

        try {
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            const freeMonthDueDate = new Date();
            freeMonthDueDate.setDate(freeMonthDueDate.getDate() + 30);

            await setDoc(doc(db, 'users', cred.user.uid), {
                role: selectedRole,
                isAdmin: false,
                fullName,
                companyName: selectedRole === 'client' ? companyName : null,
                email, phone,
                trustScore: selectedRole === 'freelancer' ? 100 : null,
                walletBalance: 0,
                rentCredit: 0,
                totalSpent: selectedRole === 'client' ? 0 : null,
                rentStatus: selectedRole === 'freelancer' ? {
                    plan: 'monthly', amountOwed: 0,
                    dueDate: freeMonthDueDate, freeMonthUsed: true,
                } : null,
                taxPass: selectedRole === 'client' ? {
                    tier: null, gigLimit: 0, gigsRemaining: 0,
                } : null,
                profileComplete: false,
                ninVerified: false,
                cacVerified: false,
                referralCount: 0,
                referralEarnings: 0,
                createdAt: serverTimestamp(),
            });

            // Generate referral code for freelancers
            if (selectedRole === 'freelancer') {
                await generateReferralCode(cred.user.uid);
            }

            // Apply ref code if provided (both roles can be referred, only freelancer earns)
            if (refCode) {
                await applyReferralOnSignup(cred.user.uid, refCode);
            }

            await initPushThenRedirect(cred.user.uid, selectedRole);
        } catch (err) {
            console.error(err);
            showError(err.message || 'Something went wrong. Please try again.');
        }
    });

    document.getElementById('googleSignupBtn').addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, googleProvider);
            const existing = await getDoc(doc(db, 'users', result.user.uid));
            const refCode = getRefCodeFromUrl();
            if (!existing.exists()) {
                const freeMonthDueDate = new Date();
                freeMonthDueDate.setDate(freeMonthDueDate.getDate() + 30);
                await setDoc(doc(db, 'users', result.user.uid), {
                    role: 'freelancer', isAdmin: false,
                    fullName: result.user.displayName || '',
                    email: result.user.email, phone: '',
                    trustScore: 100, walletBalance: 0, rentCredit: 0,
                    rentStatus: { plan: 'monthly', amountOwed: 0, dueDate: freeMonthDueDate, freeMonthUsed: true },
                    taxPass: null, profileComplete: false,
                    ninVerified: false, cacVerified: false,
                    referralCount: 0, referralEarnings: 0,
                    createdAt: serverTimestamp(),
                });
                await generateReferralCode(result.user.uid);
                if (refCode) await applyReferralOnSignup(result.user.uid, refCode);
                await initPushThenRedirect(result.user.uid, 'freelancer');
            } else {
                await initPushThenRedirect(result.user.uid, existing.data().role);
            }
        } catch (err) {
            console.error(err);
            showError(err.message || 'Google sign-up failed.');
        }
    });
}

// --------------------------------------------
// LOGIN PAGE
// --------------------------------------------
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    const formError = document.getElementById('formError');
    function showError(msg) {
        formError.textContent = msg;
        formError.style.display = 'block';
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        formError.style.display = 'none';
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        try {
            const cred = await signInWithEmailAndPassword(auth, email, password);
            const userSnap = await getDoc(doc(db, 'users', cred.user.uid));
            const data = userSnap.exists() ? userSnap.data() : {};
            const role = data.isAdmin ? 'admin' : data.role;
            await initPushThenRedirect(cred.user.uid, role);
        } catch (err) {
            console.error(err);
            showError('Invalid email or password.');
        }
    });

    document.getElementById('googleLoginBtn').addEventListener('click', async () => {
        try {
            const cred = await signInWithPopup(auth, googleProvider);
            const userSnap = await getDoc(doc(db, 'users', cred.user.uid));
            const data = userSnap.exists() ? userSnap.data() : {};
            const role = data.isAdmin ? 'admin' : (data.role || 'freelancer');
            await initPushThenRedirect(cred.user.uid, role);
        } catch (err) {
            console.error(err);
            showError(err.message || 'Google login failed.');
        }
    });

    document.getElementById('forgotPasswordLink').addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim() || prompt('Enter your account email:');
        if (!email) return;
        try {
            await sendPasswordResetEmail(auth, email);
            formError.style.display = 'block';
            formError.style.background = 'rgba(16, 185, 129, 0.1)';
            formError.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            formError.style.color = 'var(--accent-green)';
            formError.textContent = `Password reset email sent to ${email}.`;
        } catch (err) {
            console.error(err);
            showError('Could not send reset email. Check the address and try again.');
        }
    });
}