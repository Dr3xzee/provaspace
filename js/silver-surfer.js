// ============================================
// PROVASPACE — "Silver Surfer" AI Support Widget
// Floating chat bubble on every logged-in page.
// - Answers questions using OpenRouter, with live context about the
//   logged-in user (role, profile, gigs/contracts) pulled from Firestore.
// - If it can't help (or the user asks for a human / to open a ticket),
//   it opens a support ticket and hands the conversation to the admin.
// - Once a ticket is open, the widget shows a live chat with the admin.
//   That chat window stays open (persisted in localStorage + Firestore)
//   until an ADMIN closes the ticket — the user cannot close it themselves.
// ============================================

import {
    auth, db, onAuthStateChanged,
    doc, getDoc, collection, addDoc, query, where, orderBy, limit,
    getDocs, onSnapshot, updateDoc, serverTimestamp,
} from './firebase.js';

// ---------- CONFIG ----------
// OpenRouter — swap this for a real key. NEVER ship a real secret key in
// client-side JS for production; route this call through a small server /
// Cloud Function instead so the key isn't exposed. Left client-side here
// for MVP speed.
const PUSH_SECRET = 'provaspace'; // must match Netlify PUSH_SECRET env var
const OPENROUTER_MODEL = 'openrouter/auto'; // pick any OpenRouter model
const OPENROUTER_URL = '/.netlify/functions/ai';

const HANDOFF_MARKER = '###CREATE_TICKET###';

const PLATFORM_KNOWLEDGE = `
Provaspace is a freelance marketplace platform ("The Space") connecting freelancers and clients.
Key concepts freelancers/clients ask about:
- Freelancers "rent" a spot on the platform (weekly/monthly/yearly plans set by admin) to be eligible to claim gigs.
- Freelancers need NIN verification + bank details + a trust score before they can claim gigs.
- Clients need CAC verification for their company profile.
- Clients post gigs with a price, deposit, and milestones. Freelancers claim open gigs.
- Payments/milestones are held in escrow and released as milestones are approved.
- Clients can optionally pay for insurance on a gig.
- Clients can buy a "Tax Pass" (tiered, limits how many gigs they can post).
- If a freelancer's rent goes overdue, there's a grace period, then an overdue fee, then suspension after 14 days.
- Disputes on a contract are raised and resolved by admin ("Space God") via the Disputes page.
- Withdrawals: freelancers withdraw earnings from their wallet, subject to admin-set minimum/maximum amounts and a withdrawal fee (percentage or flat amount).
- Users can be suspended or banned by admin for policy violations — this blocks dashboard access.
- Admin may occasionally put the whole platform into maintenance mode.
`.trim();

let widgetInjected = false;
let currentUser = null;
let currentUserData = null;
let activeTicketId = null;
let unsubTicket = null;
let unsubMessages = null;
let conversation = []; // {role:'user'|'assistant', content}

function ticketStorageKey(uid) { return `ss_ticket_${uid}`; }

function injectStyles() {
    if (document.getElementById('ss-styles')) return;
    const style = document.createElement('style');
    style.id = 'ss-styles';
    style.textContent = `
    #ssLauncher{position:fixed;bottom:22px;right:22px;width:58px;height:58px;border-radius:50%;
      background:var(--accent-gradient,linear-gradient(135deg,#4169E1,#5b82f0));border:none;cursor:pointer;
      box-shadow:0 8px 24px rgba(65,105,225,0.4);z-index:9998;display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:22px;transition:transform .2s ease;}
    #ssLauncher:hover{transform:scale(1.08);}
    #ssLauncher .ss-dot{position:absolute;top:2px;right:2px;width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none;}
    #ssPanel{position:fixed;bottom:92px;right:22px;width:360px;max-width:92vw;height:520px;max-height:75vh;
      background:var(--bg-card,#fff);border:1px solid var(--border-color,rgba(65,105,225,0.14));border-radius:18px;
      box-shadow:0 20px 50px rgba(0,0,0,0.25);z-index:9999;display:none;flex-direction:column;overflow:hidden;
      font-family:'Plus Jakarta Sans',sans-serif;}
    #ssPanel.open{display:flex;}
    #ssHead{background:var(--accent-gradient,linear-gradient(135deg,#4169E1,#5b82f0));color:#fff;padding:14px 16px;
      display:flex;align-items:center;justify-content:space-between;}
    #ssHead .ss-title{display:flex;align-items:center;gap:8px;font-weight:700;font-size:0.95rem;}
    #ssHead .ss-sub{font-size:0.7rem;opacity:.85;font-weight:400;margin-top:2px;}
    #ssClose{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;}
    #ssBody{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--bg-main,#f4f6fd);}
    .ss-bubble{max-width:82%;padding:9px 13px;border-radius:14px;font-size:0.84rem;line-height:1.4;white-space:pre-wrap;word-break:break-word;}
    .ss-bubble.bot{align-self:flex-start;background:var(--bg-card,#fff);color:var(--text-primary,#16213e);border:1px solid var(--border-color,rgba(65,105,225,.14));border-bottom-left-radius:4px;}
    .ss-bubble.me{align-self:flex-end;background:var(--accent-blue,#4169E1);color:#fff;border-bottom-right-radius:4px;}
    .ss-bubble.sys{align-self:center;background:transparent;color:var(--text-secondary,#64748b);font-size:0.72rem;text-align:center;}
    .ss-bubble.admin{align-self:flex-start;background:#eef1fc;color:var(--text-primary,#16213e);border:1px solid rgba(65,105,225,.25);border-bottom-left-radius:4px;}
    #ssQuick{display:flex;gap:6px;padding:0 14px 8px;flex-wrap:wrap;}
    .ss-quick-btn{font-size:0.72rem;padding:6px 10px;border-radius:20px;border:1px solid var(--border-color,rgba(65,105,225,.14));
      background:var(--bg-card,#fff);color:var(--accent-blue,#4169E1);cursor:pointer;}
    #ssInputRow{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border-color,rgba(65,105,225,.14));background:var(--bg-card,#fff);}
    #ssInput{flex:1;border:1px solid var(--border-color,rgba(65,105,225,.14));border-radius:12px;padding:10px 12px;
      background:var(--bg-main,#f4f6fd);color:var(--text-primary,#16213e);font-family:inherit;font-size:0.84rem;resize:none;}
    #ssSend{background:var(--accent-blue,#4169E1);border:none;color:#fff;width:38px;border-radius:10px;cursor:pointer;font-size:15px;}
    #ssSend:disabled{opacity:.5;cursor:default;}
    .ss-status-pill{font-size:0.68rem;padding:3px 9px;border-radius:20px;background:rgba(16,185,129,.15);color:#10b981;font-weight:600;}
    .ss-status-pill.closed{background:rgba(239,68,68,.15);color:#ef4444;}
    .ss-typing{align-self:flex-start;font-size:0.75rem;color:var(--text-secondary,#64748b);font-style:italic;}
    `;
    document.head.appendChild(style);
}

function injectWidget() {
    if (widgetInjected) return;
    widgetInjected = true;
    injectStyles();

    const launcher = document.createElement('button');
    launcher.id = 'ssLauncher';
    launcher.title = 'Silver Surfer — Support';
    launcher.innerHTML = `<i class="fa-solid fa-comment-dots"></i><span class="ss-dot" id="ssDot"></span>`;
    document.body.appendChild(launcher);

    const panel = document.createElement('div');
    panel.id = 'ssPanel';
    panel.innerHTML = `
        <div id="ssHead">
            <div>
                <div class="ss-title"><i class="fa-solid fa-water"></i> Silver Surfer</div>
                <div class="ss-sub" id="ssSubtitle">Ask me anything about Provaspace</div>
            </div>
            <button id="ssClose">&times;</button>
        </div>
        <div id="ssBody"></div>
        <div id="ssQuick">
            <button class="ss-quick-btn" data-quick="ticket"><i class="fa-solid fa-headset"></i> Talk to support</button>
        </div>
        <div id="ssInputRow">
            <textarea id="ssInput" rows="1" placeholder="Type a message..."></textarea>
            <button id="ssSend"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
    `;
    document.body.appendChild(panel);

    launcher.addEventListener('click', () => {
        panel.classList.toggle('open');
        document.getElementById('ssDot').style.display = 'none';
        if (panel.classList.contains('open') && document.getElementById('ssBody').children.length === 0) {
            bootConversation();
        }
    });
    document.getElementById('ssClose').addEventListener('click', () => panel.classList.remove('open'));
    document.getElementById('ssSend').addEventListener('click', handleSend);
    document.getElementById('ssInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    panel.querySelector('[data-quick="ticket"]').addEventListener('click', () => {
        if (activeTicketId) return;
        addBubble('sys', 'Connecting you to support...');
        createTicket('User requested to speak with support.', collectRecentBotHistoryText());
    });
}

function addBubble(kind, text) {
    const body = document.getElementById('ssBody');
    const b = document.createElement('div');
    b.className = `ss-bubble ${kind}`;
    b.textContent = text;
    body.appendChild(b);
    body.scrollTop = body.scrollHeight;
    return b;
}

function setTyping(on) {
    const body = document.getElementById('ssBody');
    let el = document.getElementById('ssTyping');
    if (on) {
        if (!el) {
            el = document.createElement('div');
            el.id = 'ssTyping';
            el.className = 'ss-typing';
            el.textContent = 'Silver Surfer is typing...';
            body.appendChild(el);
        }
    } else if (el) {
        el.remove();
    }
    body.scrollTop = body.scrollHeight;
}

function collectRecentBotHistoryText() {
    return conversation.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Silver Surfer'}: ${m.content}`).join('\n');
}

function bootConversation() {
    const saved = currentUser ? localStorage.getItem(ticketStorageKey(currentUser.uid)) : null;
    if (saved) {
        activeTicketId = saved;
        watchTicket(saved);
        return;
    }
    addBubble('bot', `Hey${currentUserData?.fullName ? ' ' + currentUserData.fullName.split(' ')[0] : ''}! I'm Silver Surfer 🏄, your Provaspace assistant. Ask me anything about gigs, rent, withdrawals, disputes — or tap "Talk to support" any time.`);
}

// ---------- BOT MODE ----------
async function handleSend() {
    const input = document.getElementById('ssInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    if (activeTicketId) {
        await sendTicketMessage(text);
        return;
    }

    addBubble('me', text);
    conversation.push({ role: 'user', content: text });
    setTyping(true);
    document.getElementById('ssSend').disabled = true;

    try {
        const reply = await askOpenRouter(text);
        setTyping(false);

        if (reply.startsWith(HANDOFF_MARKER)) {
            const subject = reply.replace(HANDOFF_MARKER, '').trim() || 'Support requested';
            addBubble('bot', "I'm not fully sure on that one — let me get a human from the Provaspace team into this chat for you.");
            await createTicket(subject, collectRecentBotHistoryText());
        } else {
            addBubble('bot', reply);
            conversation.push({ role: 'assistant', content: reply });
        }
    } catch (err) {
        console.error(err);
        setTyping(false);
        addBubble('bot', "I couldn't reach my brain just now (check the OpenRouter API key in js/silver-surfer.js). Want me to open a support ticket instead?");
    } finally {
        document.getElementById('ssSend').disabled = false;
    }
}

async function buildUserContext() {
    if (!currentUser) return 'Not logged in.';
    const parts = [];
    parts.push(`User: ${currentUserData?.fullName || currentUserData?.companyName || 'Unknown'} | role: ${currentUserData?.role || 'unknown'} | verified: ${currentUserData?.ninVerified || currentUserData?.cacVerified ? 'yes' : 'no'} | trustScore: ${currentUserData?.trustScore ?? 'n/a'} | suspended: ${!!currentUserData?.suspended} | banned: ${!!currentUserData?.banned}`);
    try {
        if (currentUserData?.role === 'freelancer') {
            const contractsSnap = await getDocs(query(collection(db, 'contracts'), where('freelancerId', '==', currentUser.uid), limit(5)));
            const list = [];
            contractsSnap.forEach(d => { const c = d.data(); list.push(`${c.title || d.id} (${c.status})`); });
            parts.push(`Recent contracts: ${list.join('; ') || 'none'}`);
        } else if (currentUserData?.role === 'client') {
            const gigsSnap = await getDocs(query(collection(db, 'gigs'), where('postedBy', '==', currentUser.uid), limit(5)));
            const list = [];
            gigsSnap.forEach(d => { const g = d.data(); list.push(`${g.title || d.id} (${g.status})`); });
            parts.push(`Recent gigs posted: ${list.join('; ') || 'none'}`);
        }
    } catch (err) {
        // non-fatal — context is best-effort
    }
    return parts.join('\n');
}

async function askOpenRouter(latestMessage) {
    const userContext = await buildUserContext();
    const systemPrompt = `You are "Silver Surfer", the friendly in-app support assistant for Provaspace, a freelance marketplace.
Answer clearly and briefly using the platform knowledge and the current user's context below. Only answer things you can actually know from this info.
If you don't know the answer, if the question needs an admin/human (billing dispute, account issue, bug, refund, anything account-specific you can't verify), or the user asks for support/a human/a ticket, reply with EXACTLY this and nothing else: "${HANDOFF_MARKER} <short subject line summarizing their issue>".

PLATFORM KNOWLEDGE:
${PLATFORM_KNOWLEDGE}

CURRENT USER CONTEXT:
${userContext}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversation.slice(-8),
        { role: 'user', content: latestMessage },
    ];

    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-push-secret': PUSH_SECRET,
        },
        body: JSON.stringify({ model: OPENROUTER_MODEL, messages, temperature: 0.4 }),
    });
    if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || `${HANDOFF_MARKER} Could not get an AI response`;
}

// ---------- TICKET / HUMAN HANDOFF ----------
async function createTicket(subject, historyText) {
    if (!currentUser) return;
    try {
        const ticketRef = await addDoc(collection(db, 'supportTickets'), {
            userId: currentUser.uid,
            userName: currentUserData?.fullName || currentUserData?.companyName || currentUser.email,
            userRole: currentUserData?.role || 'unknown',
            subject,
            status: 'open',
            needsApproval: true,
            createdAt: serverTimestamp(),
            lastMessageAt: serverTimestamp(),
        });
        if (historyText) {
            await addDoc(collection(db, 'supportTickets', ticketRef.id, 'messages'), {
                senderRole: 'ai', senderId: 'silver-surfer', text: `Conversation so far:\n${historyText}`, sentAt: serverTimestamp(),
            });
        }
        await addDoc(collection(db, 'supportTickets', ticketRef.id, 'messages'), {
            senderRole: 'ai', senderId: 'silver-surfer',
            text: `Ticket opened: "${subject}". An admin will join this chat shortly — you can keep typing here.`,
            sentAt: serverTimestamp(),
        });
        activeTicketId = ticketRef.id;
        localStorage.setItem(ticketStorageKey(currentUser.uid), ticketRef.id);
        watchTicket(ticketRef.id);
    } catch (err) {
        console.error(err);
        addBubble('bot', "Couldn't open a support ticket right now — please try again in a moment.");
    }
}

function watchTicket(ticketId) {
    document.getElementById('ssBody').innerHTML = '';
    document.getElementById('ssQuick').style.display = 'none';
    document.getElementById('ssSubtitle').innerHTML = `Support ticket <span class="ss-status-pill" id="ssStatusPill">open</span>`;

    if (unsubTicket) unsubTicket();
    if (unsubMessages) unsubMessages();

    unsubTicket = onSnapshot(doc(db, 'supportTickets', ticketId), (snap) => {
        if (!snap.exists()) return;
        const t = snap.data();
        const pill = document.getElementById('ssStatusPill');
        if (pill) {
            pill.textContent = t.status;
            pill.classList.toggle('closed', t.status === 'closed');
        }
        if (t.status === 'closed') {
            addBubble('sys', 'This ticket was closed by an admin. Start a new message any time to open a new one.');
            document.getElementById('ssQuick').style.display = 'flex';
            localStorage.removeItem(ticketStorageKey(currentUser.uid));
            activeTicketId = null;
            if (unsubMessages) unsubMessages();
        }
    });

    const q = query(collection(db, 'supportTickets', ticketId, 'messages'), orderBy('sentAt', 'asc'));
    unsubMessages = onSnapshot(q, (snap) => {
        const body = document.getElementById('ssBody');
        body.innerHTML = '';
        snap.forEach(d => {
            const m = d.data();
            let kind = 'bot';
            if (m.senderRole === 'user') kind = m.senderId === currentUser?.uid ? 'me' : 'admin';
            else if (m.senderRole === 'admin') kind = 'admin';
            else if (m.senderRole === 'ai') kind = 'sys';
            addBubble(kind, m.text);
        });
        body.scrollTop = body.scrollHeight;
    });
}

async function sendTicketMessage(text) {
    if (!activeTicketId || !currentUser) return;
    await addDoc(collection(db, 'supportTickets', activeTicketId, 'messages'), {
        senderRole: 'user', senderId: currentUser.uid, text, sentAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'supportTickets', activeTicketId), {
        lastMessageAt: serverTimestamp(), needsApproval: true,
    });
}

// ---------- BOOT ----------
onAuthStateChanged(auth, async (user) => {
    if (!user) return; // widget only shows for logged-in users
    currentUser = user;
    try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        currentUserData = snap.exists() ? snap.data() : {};
        if (currentUserData.isAdmin) return; // admin has their own ticket console, not this widget
    } catch (err) {
        currentUserData = {};
    }
    injectWidget();
});