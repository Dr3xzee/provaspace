// ============================================
// PROVASPACE — Auth logic (signup.html + login.html)
// ============================================

import {
    auth,
    db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    googleProvider,
    doc,
    setDoc,
    getDoc,
    serverTimestamp,
    sendPasswordResetEmail,
} from './firebase.js';

function redirectForRole(role) {
    if (role === 'client') window.location.href = 'client-dashboard.html';
    else if (role === 'admin') window.location.href = 'admin.html';
    else window.location.href = 'index.html';
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

        if (password !== confirmPassword) { showError('Passwords do not match.'); return; }
        if (password.length < 8) { showError('Password must be at least 8 characters.'); return; }

        try {
            // Each Provaspace signup creates its own Firebase Auth user. If you later want to
            // share login with an existing OG/LEXTO account, this is where you'd check for a
            // matching email and link accounts instead of creating a fresh one.
            const cred = await createUserWithEmailAndPassword(auth, email, password);

            const freeMonthDueDate = new Date();
            freeMonthDueDate.setDate(freeMonthDueDate.getDate() + 30);

            await setDoc(doc(db, 'users', cred.user.uid), {
                role: selectedRole, // 'freelancer' | 'client'
                isAdmin: false,
                fullName,
                companyName: selectedRole === 'client' ? companyName : null,
                email,
                phone,
                trustScore: selectedRole === 'freelancer' ? 100 : null,
                walletBalance: 0,
                totalSpent: selectedRole === 'client' ? 0 : null,
                rentStatus: selectedRole === 'freelancer' ? {
                    plan: 'monthly',
                    amountOwed: 0,
                    dueDate: freeMonthDueDate, // free first month
                    freeMonthUsed: true,
                } : null,
                taxPass: selectedRole === 'client' ? {
                    tier: null,
                    gigLimit: 0,
                    gigsRemaining: 0,
                } : null,
                profileComplete: false, // recalculated by profile.js/company-profile.js as fields get filled
                ninVerified: false,
                cacVerified: false,
                createdAt: serverTimestamp(),
            });

            redirectForRole(selectedRole);
        } catch (err) {
            console.error(err);
            showError(err.message || 'Something went wrong. Please try again.');
        }
    });

    document.getElementById('googleSignupBtn').addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, googleProvider);
            const existing = await getDoc(doc(db, 'users', result.user.uid));
            if (!existing.exists()) {
                // Google signup skips the role toggle above and defaults to freelancer.
                // Add a "select role" step right after first Google sign-in if you want clients
                // to be able to use Google too.
                const freeMonthDueDate = new Date();
                freeMonthDueDate.setDate(freeMonthDueDate.getDate() + 30);
                await setDoc(doc(db, 'users', result.user.uid), {
                    role: 'freelancer',
                    isAdmin: false,
                    fullName: result.user.displayName || '',
                    email: result.user.email,
                    phone: '',
                    trustScore: 100,
                    walletBalance: 0,
                    rentStatus: { plan: 'monthly', amountOwed: 0, dueDate: freeMonthDueDate, freeMonthUsed: true },
                    taxPass: null,
                    profileComplete: false,
                    ninVerified: false,
                    cacVerified: false,
                    createdAt: serverTimestamp(),
                });
                redirectForRole('freelancer');
            } else {
                redirectForRole(existing.data().role);
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
            redirectForRole(data.isAdmin ? 'admin' : data.role);
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
            redirectForRole(data.isAdmin ? 'admin' : (data.role || 'freelancer'));
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
            showError('');
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
