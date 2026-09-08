// ============================================
// PROVASPACE — Freelancer Profile form logic
// ============================================
// @ts-nocheck
import { auth, db, onAuthStateChanged, doc, getDoc, updateDoc } from './firebase.js';
import { uploadToCloudinary } from './cloudinary.js';

let currentUser = null;
let currentUserData = null;
let uploadedAvatarUrl = null;
let uploadedNinImageUrl = null;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('profileForm');
    const avatarInput = document.getElementById('avatarInput');
    const avatarPreview = document.getElementById('avatarPreview');
    const ninStatusBadge = document.getElementById('ninStatusBadge');
    const ninImageInput = document.getElementById('ninImageInput');

    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const closeModal = document.getElementById('closeModal');
    const modalActionBtn = document.getElementById('modalActionBtn');

    function showModal(title, msg, onAction) {
        modalTitle.textContent = title;
        modalBody.innerHTML = `<p>${msg}</p>`;
        modalOverlay.classList.add('active');
        modalActionBtn.textContent = 'Okay';
        modalActionBtn.onclick = () => { modalOverlay.classList.remove('active'); if (onAction) onAction(); };
    }
    closeModal.addEventListener('click', () => modalOverlay.classList.remove('active'));
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('active'); });

    // ---------- AUTH GUARD + PREFILL ----------
    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = 'login.html'; return; }
        currentUser = user;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { window.location.href = 'signup.html'; return; }
        currentUserData = snap.data();
        if (currentUserData.role !== 'freelancer') { window.location.href = 'client-dashboard.html'; return; }
        prefillForm();
    });

    function prefillForm() {
        document.getElementById('fullName').value = currentUserData.fullName || '';
        document.getElementById('email').value = currentUserData.email || '';
        document.getElementById('phone').value = currentUserData.phone || '';
        document.getElementById('location').value = currentUserData.location || '';
        document.getElementById('experience').value = currentUserData.experience || '';
        document.getElementById('portfolioLink').value = currentUserData.portfolioLink || '';
        document.getElementById('skills').value = (currentUserData.skills || []).join(', ') || currentUserData.skills || '';
        document.getElementById('bankName').value = currentUserData.bankName || '';
        document.getElementById('bankAccountNumber').value = currentUserData.bankAccountNumber || '';
        document.getElementById('bankAccountName').value = currentUserData.bankAccountName || '';
        document.getElementById('ninNumber').value = currentUserData.ninNumber || '';

        // Restore NIN image preview
        if (currentUserData.ninImageUrl) {
            uploadedNinImageUrl = currentUserData.ninImageUrl;
            document.getElementById('ninImagePreview').src = currentUserData.ninImageUrl;
            document.getElementById('ninImagePreviewWrap').style.display = 'block';
            document.getElementById('ninImageLabel').textContent = 'Change NIN image';
        }

        // Avatar
        if (currentUserData.avatarUrl) {
            avatarPreview.innerHTML = `<img src="${currentUserData.avatarUrl}" alt="Profile photo">`;
            uploadedAvatarUrl = currentUserData.avatarUrl;
        } else {
            avatarPreview.textContent = (currentUserData.fullName || '?').trim().charAt(0).toUpperCase();
        }

        // NIN status badge
        if (currentUserData.ninVerified) {
            ninStatusBadge.textContent = 'Verified';
            ninStatusBadge.className = 'verify-status-badge verify-approved';
        } else if (currentUserData.ninRejected) {
            ninStatusBadge.textContent = `Rejected — ${currentUserData.ninRejectionReason || 'see notification'}`;
            ninStatusBadge.className = 'verify-status-badge verify-none';
        } else if (currentUserData.ninNumber) {
            ninStatusBadge.textContent = 'Pending admin review';
            ninStatusBadge.className = 'verify-status-badge verify-pending';
        } else {
            ninStatusBadge.textContent = 'Not submitted';
            ninStatusBadge.className = 'verify-status-badge verify-none';
        }
    }

    // ---------- AVATAR UPLOAD ----------
    avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => { avatarPreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`; };
        reader.readAsDataURL(file);
        try {
            uploadedAvatarUrl = await uploadToCloudinary(file);
        } catch (err) {
            console.error(err);
            showModal('Upload Failed', 'Cloudinary is not configured. Check js/cloudinary.js. Your preview shows locally but was not saved.', null);
        }
    });

    // ---------- NIN IMAGE UPLOAD ----------
    ninImageInput?.addEventListener('change', async () => {
        const file = ninImageInput.files[0];
        if (!file) return;
        document.getElementById('ninImageLabel').textContent = 'Uploading…';
        try {
            const url = await uploadToCloudinary(file);
            uploadedNinImageUrl = url;
            document.getElementById('ninImagePreview').src = url;
            document.getElementById('ninImagePreviewWrap').style.display = 'block';
            document.getElementById('ninImageLabel').textContent = 'Change NIN image';
        } catch (e) {
            document.getElementById('ninImageLabel').textContent = 'Upload failed — try again';
            console.error(e);
        }
    });

    // ---------- SUBMIT ----------
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const ninNumber = document.getElementById('ninNumber').value.trim();
        const submittedNewNin = ninNumber && ninNumber !== currentUserData.ninNumber;

        const updates = {
            fullName: document.getElementById('fullName').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            location: document.getElementById('location').value.trim(),
            experience: parseInt(document.getElementById('experience').value, 10) || 0,
            portfolioLink: document.getElementById('portfolioLink').value.trim(),
            skills: document.getElementById('skills').value.split(',').map(s => s.trim()).filter(Boolean),
            bankName: document.getElementById('bankName').value.trim(),
            bankAccountNumber: document.getElementById('bankAccountNumber').value.trim(),
            bankAccountName: document.getElementById('bankAccountName').value.trim(),
            ninNumber,
            ninImageUrl: uploadedNinImageUrl || currentUserData.ninImageUrl || null,
            avatarUrl: uploadedAvatarUrl || currentUserData.avatarUrl || null,
        };

        if (submittedNewNin) {
            updates.ninVerified = false;
            updates.ninRejected = false;
            updates.ninRejectionReason = null;
        }

        const requiredFields = ['fullName', 'email', 'phone', 'location', 'skills', 'bankAccountNumber', 'ninVerified'];
        const merged = { ...currentUserData, ...updates };
        const filled = requiredFields.filter(f => {
            const v = merged[f];
            return v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0);
        }).length;
        updates.profileComplete = filled === requiredFields.length;

        try {
            await updateDoc(doc(db, 'users', currentUser.uid), updates);
            showModal('Profile Saved', submittedNewNin
                ? 'Your profile has been updated. Your NIN has been sent to the admin queue for verification.'
                : 'Your profile has been updated.', () => window.location.href = 'index.html');
        } catch (err) {
            console.error(err);
            showModal('Error', 'Could not save your profile. Please try again.', null);
        }
    });
});