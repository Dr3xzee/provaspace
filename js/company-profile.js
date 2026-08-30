// ============================================
// PROVASPACE — Client/Company Profile form logic
// ============================================

import { auth, db, onAuthStateChanged, doc, getDoc, updateDoc } from './firebase.js';
import { uploadToCloudinary } from './cloudinary.js';

let currentUser = null;
let currentUserData = null;
let uploadedLogoUrl = null;
let clientType = 'individual';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('companyProfileForm');
    const avatarInput = document.getElementById('avatarInput');
    const avatarPreview = document.getElementById('avatarPreview');
    const cacStatusBadge = document.getElementById('cacStatusBadge');

    const companyNameGroup = document.getElementById('companyNameGroup');
    const nameLabel = document.getElementById('nameLabel');
    const industryGroup = document.getElementById('industryGroup');
    const websiteGroup = document.getElementById('websiteGroup');
    const cacSectionLabel = document.getElementById('cacSectionLabel');
    const cacStatusBox = document.getElementById('cacStatusBox');
    const cacNumberGroup = document.getElementById('cacNumberGroup');
    const cacHelperText = document.getElementById('cacHelperText');

    const typeToggleBtns = document.querySelectorAll('#clientTypeToggle button');

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

    function setClientType(type) {
        clientType = type;
        typeToggleBtns.forEach(b => b.classList.toggle('active', b.dataset.type === type));
        const isCompany = type === 'company';
        companyNameGroup.style.display = isCompany ? 'flex' : 'none';
        industryGroup.style.display = isCompany ? 'flex' : 'none';
        websiteGroup.style.display = isCompany ? 'flex' : 'none';
        cacSectionLabel.style.display = isCompany ? 'block' : 'none';
        cacStatusBox.style.display = isCompany ? 'block' : 'none';
        cacNumberGroup.style.display = isCompany ? 'flex' : 'none';
        cacHelperText.style.display = isCompany ? 'block' : 'none';
        nameLabel.textContent = isCompany ? 'Contact Full Name' : 'Full Name';
        document.getElementById('avatarUploadLabel').innerHTML = isCompany
            ? '<i class="fa-solid fa-camera"></i> Upload Logo'
            : '<i class="fa-solid fa-camera"></i> Upload Photo';
    }

    typeToggleBtns.forEach(btn => btn.addEventListener('click', () => setClientType(btn.dataset.type)));

    // ---------- AUTH GUARD + PREFILL ----------
    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = 'login.html'; return; }
        currentUser = user;

        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { window.location.href = 'signup.html'; return; }
        currentUserData = snap.data();

        if (currentUserData.role !== 'client') { window.location.href = 'index.html'; return; }

        prefillForm();
    });

    function prefillForm() {
        setClientType(currentUserData.companyName ? 'company' : 'individual');

        document.getElementById('companyName').value = currentUserData.companyName || '';
        document.getElementById('fullName').value = currentUserData.fullName || '';
        document.getElementById('email').value = currentUserData.email || '';
        document.getElementById('phone').value = currentUserData.phone || '';
        document.getElementById('location').value = currentUserData.location || '';
        document.getElementById('industry').value = currentUserData.industry || '';
        document.getElementById('website').value = currentUserData.website || '';
        document.getElementById('cacNumber').value = currentUserData.cacNumber || '';

        const initial = (currentUserData.companyName || currentUserData.fullName || '?').trim().charAt(0).toUpperCase();
        if (currentUserData.avatarUrl) {
            avatarPreview.innerHTML = `<img src="${currentUserData.avatarUrl}" alt="Logo/photo">`;
            uploadedLogoUrl = currentUserData.avatarUrl;
        } else {
            avatarPreview.textContent = initial;
        }

        if (currentUserData.cacVerified) {
            cacStatusBadge.textContent = 'Verified';
            cacStatusBadge.className = 'verify-status-badge verify-approved';
        } else if (currentUserData.cacNumber) {
            cacStatusBadge.textContent = 'Pending admin review';
            cacStatusBadge.className = 'verify-status-badge verify-pending';
        } else {
            cacStatusBadge.textContent = 'Not submitted';
            cacStatusBadge.className = 'verify-status-badge verify-none';
        }
    }

    // ---------- LOGO/AVATAR UPLOAD ----------
    avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => { avatarPreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`; };
        reader.readAsDataURL(file);

        try {
            // Uploads go through js/cloudinary.js — set your cloud name + unsigned preset there
            uploadedLogoUrl = await uploadToCloudinary(file);
        } catch (err) {
            console.error(err);
            showModal('Upload Failed', 'Cloudinary is not configured yet — check js/cloudinary.js for your cloud name and upload preset. Your image preview shows locally but was not saved.', null);
        }
    });

    // ---------- SUBMIT ----------
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const cacNumber = document.getElementById('cacNumber').value.trim();
        const submittedNewCac = clientType === 'company' && cacNumber && cacNumber !== currentUserData.cacNumber;

        const updates = {
            companyName: clientType === 'company' ? document.getElementById('companyName').value.trim() : null,
            fullName: document.getElementById('fullName').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            location: document.getElementById('location').value.trim(),
            industry: clientType === 'company' ? document.getElementById('industry').value.trim() : null,
            website: clientType === 'company' ? document.getElementById('website').value.trim() : null,
            cacNumber: clientType === 'company' ? cacNumber : null,
            avatarUrl: uploadedLogoUrl || currentUserData.avatarUrl || null,
        };

        // Individuals don't need CAC verification — auto-mark not-applicable so they aren't
        // stuck forever in the admin's pending-verification queue
        if (clientType === 'individual') {
            updates.cacVerified = true; // Individuals don't need CAC review, so mark as cleared automatically
        } else if (submittedNewCac) {
            updates.cacVerified = false;
        }

        try {
            await updateDoc(doc(db, 'users', currentUser.uid), updates);
            showModal('Profile Saved', submittedNewCac
                ? 'Your profile has been updated. Your CAC number has been sent to the admin queue for verification.'
                : 'Your profile has been updated.', () => window.location.href = 'client-dashboard.html');
        } catch (err) {
            console.error(err);
            showModal('Error', 'Could not save your profile. Please try again.', null);
        }
    });
});
