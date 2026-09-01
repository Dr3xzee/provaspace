// ============================================
// PROVASPACE — Contract Detail
// Chat · Milestones · File uploads · Admin gate
// ============================================

import {
    auth, db, onAuthStateChanged,
    doc, getDoc, updateDoc,
    collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
} from './firebase.js';
import { notifyUser } from './notify-helper.js';
import { uploadToCloudinary } from './cloudinary.js';
import { checkAndPayReferral } from './referral-helper.js';

// ── CONFIG ──────────────────────────────────
const ALLOWED_TYPES = [
    'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
];
const MAX_FILE_MB = 10;

// ── STATE ────────────────────────────────────
let currentUser   = null;
let userData      = null;
let contractId    = null;
let contract      = null;
let unsubMessages = null;
let pendingFile   = null;
let lastMsgDate   = null;

// ── HELPERS ──────────────────────────────────
const $ = id => document.getElementById(id);

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
}

function fmt(n) {
    return '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 0 });
}

function fmtTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtBytes(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function initials(name) {
    if (!name) return '?';
    return name.trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function showToast(msg, duration = 2500) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), duration);
}

function isImg(type) { return type && type.startsWith('image/'); }
function isClient() { return currentUser?.uid === contract?.clientId; }
function isAdmin()  { return userData?.isAdmin === true; }

// ── MODAL ────────────────────────────────────
function modal(title, bodyHtml, { confirm = false, confirmText = 'Confirm', onConfirm } = {}) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = typeof bodyHtml === 'string' ? bodyHtml : '';
    if (typeof bodyHtml !== 'string') {
        $('modalBody').innerHTML = '';
        $('modalBody').appendChild(bodyHtml);
    }
    const cancelBtn = $('modalCancel');
    const actionBtn = $('modalAction');
    cancelBtn.style.display = confirm ? '' : 'none';
    actionBtn.textContent = confirm ? confirmText : 'Okay';
    actionBtn.className = confirm ? 'mini-btn' : 'mini-btn';
    cancelBtn.onclick = () => $('modalOverlay').classList.remove('active');
    actionBtn.onclick = () => {
        $('modalOverlay').classList.remove('active');
        if (onConfirm) onConfirm();
    };
    $('modalOverlay').classList.add('active');
}

// ── BOOT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    contractId = new URLSearchParams(window.location.search).get('id');

    // Sidebar toggle
    const sidebar  = $('sidebar');
    const overlay  = $('sidebarOverlay');
    function openSidebar()  { sidebar.classList.add('open'); overlay.classList.add('open'); }
    function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }
    $('hamburger').addEventListener('click', openSidebar);
    overlay.addEventListener('click', closeSidebar);

    // Modal close
    $('modalClose').addEventListener('click', () => $('modalOverlay').classList.remove('active'));
    $('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) $('modalOverlay').classList.remove('active'); });

    // File attach
    $('attachBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', onFileChosen);
    $('previewRemove').addEventListener('click', clearFile);

    // Input enable/disable send
    $('msgInput').addEventListener('input', syncSendBtn);
    $('msgInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    $('sendBtn').addEventListener('click', sendMessage);

    onAuthStateChanged(auth, async user => {
        if (!user) { window.location.href = 'login.html'; return; }
        currentUser = user;

        const snap = await getDoc(doc(db, 'users', user.uid));
        userData = snap.exists() ? snap.data() : {};
        $('backLink').href = userData.role === 'client' ? 'client-dashboard.html' : 'index.html';

        if (!contractId) { showLoadError('No contract ID provided.'); return; }
        await loadContract();
    });
});

// ── LOAD CONTRACT ─────────────────────────────
async function loadContract() {
    const snap = await getDoc(doc(db, 'contracts', contractId));
    if (!snap.exists()) { showLoadError('Contract not found.'); return; }
    contract = snap.data();
    renderSidebar();
    loadPeerInfo();
    subscribeMessages();
}

function showLoadError(msg) {
    $('contractTitle').textContent = msg;
    $('chatMessages').innerHTML = `<div class="empty-chat"><i class="fa-solid fa-triangle-exclamation"></i><p>${msg}</p></div>`;
}

// ── SIDEBAR ───────────────────────────────────
function renderSidebar() {
    $('contractTitle').textContent = contract.title || 'Contract';

    const total    = (contract.milestones || []).length;
    const released = (contract.milestones || []).filter(m => m.released).length;
    $('contractStatusLine').innerHTML =
        `<strong>${esc(contract.status)}</strong> &middot; ${released}/${total} milestones released<br>
        Total: <strong>${fmt(contract.totalPrice)}</strong> &middot; Released: <strong>${fmt(contract.payoutsEarned || 0)}</strong>`;

    renderMilestones();
    renderActions();
}

function renderMilestones() {
    const list = $('milestonesList');
    list.innerHTML = '';
    (contract.milestones || []).forEach((m, idx) => {
        const amount = Math.round((contract.totalPrice || 0) * (m.percent / 100));
        const el = document.createElement('div');
        el.className = 'milestone-item' + (m.released ? ' done' : m.releaseRequested ? ' requested' : '');

        let badge = '';
        let action = '';

        if (m.released) {
            badge = '<span class="badge badge-green"><i class="fa-solid fa-check"></i> Paid</span>';
        } else if (isAdmin()) {
            badge = m.releaseRequested
                ? '<span class="badge badge-amber">Requested</span>'
                : m.submitted ? '<span class="badge badge-blue">Submitted</span>' : '<span class="badge" style="background:var(--bg-main);">Pending</span>';
            if (m.submitted) {
                action = `<button class="mini-btn" style="font-size:0.7rem;padding:6px 10px;" data-admin-release="${idx}">Release</button>`;
            }
        } else if (isClient()) {
            if (!m.submitted) {
                badge = '<span class="badge" style="background:var(--bg-main);color:var(--text-secondary);">Awaiting delivery</span>';
            } else if (m.releaseRequested) {
                badge = '<span class="badge badge-amber">Pending approval</span>';
            } else {
                badge = '<span class="badge badge-blue">Delivered</span>';
                action = `<button class="mini-btn" style="font-size:0.7rem;padding:6px 10px;" data-request-release="${idx}">Release</button>`;
            }
        } else {
            // freelancer
            if (!m.submitted) {
                action = `<button class="mini-btn outline" style="font-size:0.7rem;padding:6px 10px;" data-submit="${idx}">Mark Delivered</button>`;
            } else if (m.releaseRequested) {
                badge = '<span class="badge badge-amber">Awaiting admin</span>';
            } else {
                badge = '<span class="badge badge-blue">Submitted</span>';
            }
        }

        el.innerHTML = `
            <div style="flex:1;min-width:0;">
                <div class="m-name">${esc(m.name || 'Milestone ' + (idx + 1))}</div>
                <div class="m-sub">${m.percent}% · ${fmt(amount)} ${badge}</div>
            </div>
            ${action}
        `;
        list.appendChild(el);
    });

    list.querySelectorAll('[data-submit]').forEach(btn =>
        btn.addEventListener('click', () => submitMilestone(+btn.dataset.submit)));
    list.querySelectorAll('[data-request-release]').forEach(btn =>
        btn.addEventListener('click', () => requestRelease(+btn.dataset.requestRelease)));
    list.querySelectorAll('[data-admin-release]').forEach(btn =>
        btn.addEventListener('click', () => adminRelease(+btn.dataset.adminRelease)));
}

function renderActions() {
    const row = $('contractActionsRow');
    row.innerHTML = '';
    if (contract.status !== 'active') {
        const b = document.createElement('span');
        b.className = 'badge ' + (contract.status === 'completed' ? 'badge-green' : 'badge-red');
        b.textContent = contract.status;
        row.appendChild(b);
        return;
    }
    const dispute = document.createElement('button');
    dispute.className = 'mini-btn outline';
    dispute.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Raise Dispute';
    dispute.onclick = () => window.location.href = 'disputes.html';
    row.appendChild(dispute);

    if (!isClient() && !isAdmin()) {
        const abandon = document.createElement('button');
        abandon.className = 'mini-btn danger';
        abandon.innerHTML = '<i class="fa-solid fa-xmark"></i> Abandon Job';
        abandon.onclick = abandonContract;
        row.appendChild(abandon);
    }
}

// ── PEER INFO ─────────────────────────────────
async function loadPeerInfo() {
    const peerId = isClient() ? contract.freelancerId : contract.clientId;
    if (!peerId) return;
    const snap = await getDoc(doc(db, 'users', peerId));
    const peer = snap.exists() ? snap.data() : {};
    const name = peer.fullName || peer.companyName || 'User';
    $('peerName').textContent = name;
    const av = $('peerAvatar');
    av.textContent = initials(name);
    if (peer.photoURL) {
        av.style.background = 'none';
        av.innerHTML = `<img src="${esc(peer.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    }
}

// ── MILESTONE ACTIONS ─────────────────────────
async function submitMilestone(idx) {
    const updated = [...contract.milestones];
    updated[idx] = { ...updated[idx], submitted: true };
    await updateDoc(doc(db, 'contracts', contractId), { milestones: updated });
    contract.milestones = updated;
    renderSidebar();
    notifyUser(contract.clientId, {
        title: '📦 Milestone delivered',
        message: `A milestone has been marked as delivered on "${contract.title}". Review and request release when satisfied.`,
        type: 'milestone_submitted',
        link: `contract-detail.html?id=${contractId}`,
    }).catch(() => {});
    showToast('Milestone marked as delivered ✓');
}

async function requestRelease(idx) {
    const m = contract.milestones[idx];
    const amount = Math.round((contract.totalPrice || 0) * (m.percent / 100));
    modal(
        'Request Payment Release',
        `<p>Request admin to release <strong>${fmt(amount)}</strong> for "<strong>${esc(m.name)}</strong>"?</p>
        <p style="margin-top:8px;font-size:0.8rem;color:var(--text-secondary);">Admin will review and approve. Both parties will be notified.</p>`,
        {
            confirm: true, confirmText: 'Yes, Request',
            onConfirm: async () => {
                const updated = [...contract.milestones];
                updated[idx] = { ...m, releaseRequested: true, releaseRequestedAt: new Date().toISOString() };
                await updateDoc(doc(db, 'contracts', contractId), { milestones: updated });
                contract.milestones = updated;
                renderSidebar();
                notifyUser(contract.freelancerId, {
                    title: '⏳ Release requested',
                    message: `The client requested payment release for "${m.name}" on "${contract.title}". Admin is reviewing.`,
                    type: 'release_requested',
                    link: `contract-detail.html?id=${contractId}`,
                }).catch(() => {});
                showToast('Release request sent to admin ✓');
            }
        }
    );
}

async function adminRelease(idx) {
    const m = contract.milestones[idx];
    const amount = Math.round((contract.totalPrice || 0) * (m.percent / 100));

    // ── ESCROW GATE ──────────────────────────────────────────
    // Only release if enough real money is held in escrow
    const escrow   = contract.escrowBalance || 0;
    const released = contract.payoutsEarned || 0;
    const available = escrow - released;   // unspent escrow
    if (amount > available) {
        const shortfall = amount - available;
        modal(
            '⚠️ Insufficient Escrow',
            `<p>Only <strong>${fmt(available)}</strong> is currently held in escrow, but this milestone requires <strong>${fmt(amount)}</strong>.</p>
            <p style="margin-top:8px;">The client needs to top up <strong>${fmt(shortfall)}</strong> before you can release this milestone.</p>
            <p style="margin-top:8px;font-size:0.8rem;color:var(--text-secondary);">The client will be notified to complete payment.</p>`,
            { confirm: false }
        );
        // Notify client to pay up
        notifyUser(contract.clientId, {
            title: '💳 Payment required to release milestone',
            message: `Admin tried to release "${m.name}" on "${contract.title}" but your escrow is short by ${fmt(shortfall)}. Please top up to continue.`,
            type: 'escrow_topup_required',
            link: `client-dashboard.html`,
        }).catch(() => {});
        return;
    }
    // ──────────────────────────────────────────────────────────

    modal(
        'Approve Milestone Release',
        `<p>Release <strong>${fmt(amount)}</strong> for "<strong>${esc(m.name)}</strong>"?</p>
        <p style="margin-top:8px;font-size:0.8rem;color:var(--accent-red);">This credits the freelancer's wallet immediately.</p>`,
        {
            confirm: true, confirmText: 'Approve & Release',
            onConfirm: async () => {
                const updated = [...contract.milestones];
                updated[idx] = { ...m, released: true, releaseRequested: false, releasedAt: new Date().toISOString(), releasedBy: currentUser.uid };
                const newEarned = (contract.payoutsEarned || 0) + amount;
                const allDone = updated.every(x => x.released);

                await updateDoc(doc(db, 'contracts', contractId), {
                    milestones: updated, payoutsEarned: newEarned,
                    ...(allDone && { status: 'completed' }),
                });

                const [flSnap, clSnap] = await Promise.all([
                    getDoc(doc(db, 'users', contract.freelancerId)),
                    getDoc(doc(db, 'users', contract.clientId)),
                ]);
                if (flSnap.exists()) await updateDoc(doc(db, 'users', contract.freelancerId), { walletBalance: (flSnap.data().walletBalance || 0) + amount });
                if (clSnap.exists()) await updateDoc(doc(db, 'users', contract.clientId), { totalSpent: (clSnap.data().totalSpent || 0) + amount });

                contract.milestones = updated;
                contract.payoutsEarned = newEarned;
                if (allDone) {
                    contract.status = 'completed';
                    checkAndPayReferral(contract.freelancerId).catch(() => {});
                }
                renderSidebar();

                await Promise.all([
                    notifyUser(contract.freelancerId, {
                        title: '💰 Payment released!',
                        message: `Admin released ${fmt(amount)} for "${m.name}" on "${contract.title}".`,
                        type: 'payment_released', link: `contract-detail.html?id=${contractId}`,
                    }),
                    notifyUser(contract.clientId, {
                        title: 'Payment released',
                        message: `${fmt(amount)} released to the freelancer for "${m.name}".`,
                        type: 'payment_released', link: `contract-detail.html?id=${contractId}`,
                    }),
                ]).catch(() => {});

                showToast(`${fmt(amount)} released ✓${allDone ? ' · Contract completed' : ''}`);
            }
        }
    );
}

async function abandonContract() {
    modal(
        'Abandon This Job?',
        `<p>This marks the job as abandoned and deducts 15 points from your trust score.</p>
        <p style="margin-top:8px;font-size:0.8rem;color:var(--accent-red);">This cannot be undone.</p>`,
        {
            confirm: true, confirmText: 'Yes, Abandon',
            onConfirm: async () => {
                await updateDoc(doc(db, 'contracts', contractId), { status: 'abandoned' });
                const flSnap = await getDoc(doc(db, 'users', currentUser.uid));
                if (flSnap.exists()) {
                    await updateDoc(doc(db, 'users', currentUser.uid), {
                        trustScore: Math.max(0, (flSnap.data().trustScore || 100) - 15),
                    });
                }
                contract.status = 'abandoned';
                renderSidebar();
                showToast('Job abandoned.');
            }
        }
    );
}

// ── MESSAGES ─────────────────────────────────
function subscribeMessages() {
    const q = query(collection(db, 'contracts', contractId, 'messages'), orderBy('sentAt', 'asc'));
    unsubMessages = onSnapshot(q, snap => {
        const msgs = $('chatMessages');
        if (snap.empty) {
            msgs.innerHTML = `<div class="empty-chat"><i class="fa-solid fa-comment-dots"></i><p>No messages yet. Say hello!</p></div>`;
            return;
        }
        msgs.innerHTML = '';
        lastMsgDate = null;

        snap.forEach(d => {
            const msg = { id: d.id, ...d.data() };
            const mine = msg.senderId === currentUser.uid;

            // Date divider
            if (msg.sentAt) {
                const dateStr = fmtDate(msg.sentAt);
                if (dateStr !== lastMsgDate) {
                    lastMsgDate = dateStr;
                    const div = document.createElement('div');
                    div.className = 'date-divider';
                    div.innerHTML = `<span>${esc(dateStr)}</span>`;
                    msgs.appendChild(div);
                }
            }

            const wrap = document.createElement('div');
            wrap.className = `bubble-wrap ${mine ? 'mine' : 'theirs'}`;

            const bubble = document.createElement('div');
            bubble.className = `bubble ${mine ? 'mine' : 'theirs'}`;

            if (msg.fileUrl) {
                if (isImg(msg.fileType)) {
                    bubble.innerHTML = `
                        <img class="chat-img" src="${esc(msg.fileUrl)}" alt="${esc(msg.fileName || 'image')}"
                            onclick="window.open('${esc(msg.fileUrl)}','_blank')">
                        ${msg.text ? `<span style="display:block;margin-top:6px;font-size:0.85rem;">${esc(msg.text)}</span>` : ''}
                    `;
                } else {
                    const iconClass = getFileIcon(msg.fileType);
                    bubble.innerHTML = `
                        <div class="file-bubble ${mine ? 'mine' : 'theirs'}">
                            <div class="file-icon"><i class="${iconClass}"></i></div>
                            <div style="flex:1;min-width:0;">
                                <div class="file-name">${esc(msg.fileName || 'Attachment')}</div>
                                ${msg.fileSize ? `<div class="file-size">${fmtBytes(msg.fileSize)}</div>` : ''}
                            </div>
                            <a href="${esc(msg.fileUrl)}" target="_blank" rel="noopener"
                                style="color:${mine ? 'rgba(255,255,255,.8)' : 'var(--accent-blue)'};font-size:0.85rem;">
                                <i class="fa-solid fa-download"></i>
                            </a>
                        </div>
                        ${msg.text ? `<span style="display:block;margin-top:6px;font-size:0.85rem;">${esc(msg.text)}</span>` : ''}
                    `;
                }
            } else {
                bubble.textContent = msg.text;
            }

            wrap.appendChild(bubble);

            const time = document.createElement('div');
            time.className = 'bubble-time';
            time.textContent = fmtTime(msg.sentAt);
            wrap.appendChild(time);

            msgs.appendChild(wrap);
        });

        // scroll to bottom
        msgs.scrollTop = msgs.scrollHeight;
    }, err => {
        console.error(err);
        $('chatMessages').innerHTML = `<div class="empty-chat"><i class="fa-solid fa-triangle-exclamation"></i><p>Could not load messages.</p></div>`;
    });
}

function getFileIcon(type) {
    if (!type) return 'fa-solid fa-file';
    if (type.includes('pdf')) return 'fa-solid fa-file-pdf';
    if (type.includes('word') || type.includes('document')) return 'fa-solid fa-file-word';
    if (type.includes('excel') || type.includes('sheet')) return 'fa-solid fa-file-excel';
    if (type.includes('text')) return 'fa-solid fa-file-lines';
    return 'fa-solid fa-file';
}

// ── FILE HANDLING ─────────────────────────────
function onFileChosen() {
    const file = $('fileInput').files[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
        showToast('File type not allowed. Use images, PDF, Word, Excel or text.');
        $('fileInput').value = '';
        return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
        showToast(`File too large. Max ${MAX_FILE_MB}MB.`);
        $('fileInput').value = '';
        return;
    }

    pendingFile = file;
    const preview = $('uploadPreview');
    $('previewName').textContent = file.name;
    $('previewSize').textContent = fmtBytes(file.size);

    if (isImg(file.type)) {
        const reader = new FileReader();
        reader.onload = e => {
            $('previewThumb').src = e.target.result;
            $('previewThumb').style.display = '';
            $('previewIcon').style.display = 'none';
        };
        reader.readAsDataURL(file);
    } else {
        $('previewThumb').style.display = 'none';
        $('previewIcon').style.display = '';
        $('previewIcon').innerHTML = `<i class="${getFileIcon(file.type)}"></i>`;
    }

    preview.classList.add('visible');
    syncSendBtn();
}

function clearFile() {
    pendingFile = null;
    $('fileInput').value = '';
    $('uploadPreview').classList.remove('visible');
    $('previewThumb').src = '';
    $('previewThumb').style.display = 'none';
    $('previewIcon').style.display = '';
    syncSendBtn();
}

function syncSendBtn() {
    const hasText = $('msgInput').value.trim().length > 0;
    $('sendBtn').disabled = !hasText && !pendingFile;
}

// ── SEND MESSAGE ──────────────────────────────
async function sendMessage() {
    const text = $('msgInput').value.trim();
    if (!text && !pendingFile) return;
    if (!contractId) return;

    const sendBtn = $('sendBtn');
    const bar = $('inputBar');
    sendBtn.disabled = true;
    $('msgInput').value = '';

    let fileUrl = null, fileName = null, fileType = null, fileSize = null;

    if (pendingFile) {
        bar.classList.add('uploading');
        const progress = $('uploadProgress');
        const bar2 = $('uploadProgressBar');
        progress.classList.add('active');

        // Fake progress animation while uploading
        let pct = 0;
        const ticker = setInterval(() => {
            pct = Math.min(pct + Math.random() * 15, 85);
            bar2.style.width = pct + '%';
        }, 200);

        try {
            fileUrl  = await uploadToCloudinary(pendingFile);
            fileName = pendingFile.name;
            fileType = pendingFile.type;
            fileSize = pendingFile.size;
        } catch (err) {
            clearInterval(ticker);
            progress.classList.remove('active');
            bar.classList.remove('uploading');
            showToast('Upload failed. Try again.');
            syncSendBtn();
            return;
        }

        clearInterval(ticker);
        bar2.style.width = '100%';
        setTimeout(() => { progress.classList.remove('active'); bar2.style.width = '0%'; }, 400);
        bar.classList.remove('uploading');
        clearFile();
    }

    syncSendBtn();

    try {
        await addDoc(collection(db, 'contracts', contractId, 'messages'), {
            senderId: currentUser.uid,
            text: text || '',
            fileUrl: fileUrl || null,
            fileName: fileName || null,
            fileType: fileType || null,
            fileSize: fileSize || null,
            sentAt: serverTimestamp(),
        });

        const peerId = isClient() ? contract?.freelancerId : contract?.clientId;
        if (peerId) {
            const senderName = userData?.fullName || userData?.companyName || 'Someone';
            notifyUser(peerId, {
                title: fileUrl ? `📎 ${senderName} shared a file` : `💬 ${senderName}`,
                message: fileUrl ? (text || fileName || 'File attachment') : text,
                type: 'contract_chat',
                link: `contract-detail.html?id=${contractId}`,
            }).catch(() => {});
        }
    } catch (err) {
        console.error(err);
        showToast('Message failed to send. Try again.');
        $('msgInput').value = text; // restore
        syncSendBtn();
    }
}

// ── CLEANUP ───────────────────────────────────
window.addEventListener('beforeunload', () => { if (unsubMessages) unsubMessages(); });