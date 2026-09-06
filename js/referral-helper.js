// ============================================
// PROVASPACE — Referral Helper
// Freelancers refer others via a unique code.
// Reward: rent credit set by admin, paid when:
//   1. Referred user has NIN verified
//   2. Referred user completes their first task (contract status = completed)
// ============================================

import {
    db,
    doc, getDoc, updateDoc, setDoc,
    collection, query, where, getDocs, addDoc, serverTimestamp,
} from './firebase.js';
import { notifyUser } from './notify-helper.js';

/**
 * Generate a referral code for a user (call on signup).
 * Stores it in users/{uid}.referralCode and referralCodes/{code} → uid
 */
export async function generateReferralCode(uid) {
    const code = 'PV-' + uid.slice(0, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
    await updateDoc(doc(db, 'users', uid), { referralCode: code, referralCount: 0, referralEarnings: 0 });
    await setDoc(doc(db, 'referralCodes', code), { uid, createdAt: serverTimestamp() });
    return code;
}

/**
 * On signup: if a referral code was used, record it on the new user
 * and store a pending referral doc.
 */
export async function applyReferralOnSignup(newUid, referralCode) {
    if (!referralCode) return;
    const codeSnap = await getDoc(doc(db, 'referralCodes', referralCode));
    if (!codeSnap.exists()) return;
    const referrerId = codeSnap.data().uid;
    if (referrerId === newUid) return; // can't refer yourself

    // Mark new user as referred
    await updateDoc(doc(db, 'users', newUid), { referredBy: referrerId, referralCode: referralCode });

    // Create pending referral record
    await setDoc(doc(db, 'referrals', newUid), {
        referrerId,
        referredId: newUid,
        ninVerified: false,
        firstTaskDone: false,
        rewarded: false,
        createdAt: serverTimestamp(),
    });
}

/**
 * Called whenever NIN gets verified or a contract completes.
 * Checks if both conditions are met and pays out the rent credit.
 */
export async function checkAndPayReferral(userId) {
    const referralSnap = await getDoc(doc(db, 'referrals', userId));
    if (!referralSnap.exists()) return;
    const referral = referralSnap.data();
    if (referral.rewarded) return;

    // Fetch latest user data to check NIN
    const userSnap = await getDoc(doc(db, 'users', userId));
    const userData = userSnap.data();
    const ninVerified = userData?.ninVerified === true;

    // Check if they have at least 1 completed contract
    const contractsSnap = await getDocs(
        query(collection(db, 'contracts'),
            where('freelancerId', '==', userId),
            where('status', '==', 'completed')
        )
    );
    const firstTaskDone = contractsSnap.size >= 1;

    // Update referral doc with latest state
    await updateDoc(doc(db, 'referrals', userId), { ninVerified, firstTaskDone });

    if (!ninVerified || !firstTaskDone) return;

    // Both conditions met — fetch reward (in days) from admin settings
    const settingsSnap = await getDoc(doc(db, 'settings', 'referral'));
    const rewardDays = settingsSnap.exists() ? (settingsSnap.data().rentDays || settingsSnap.data().rentCredit || 0) : 0;
    if (rewardDays <= 0) return;

    // Credit rent days to referrer
    const referrerSnap = await getDoc(doc(db, 'users', referral.referrerId));
    if (!referrerSnap.exists()) return;
    const referrerData = referrerSnap.data();

    // Extend referrer's rent due date by rewardDays
    const existingDue = referrerData.rentStatus?.dueDate?.toDate
        ? referrerData.rentStatus.dueDate.toDate()
        : (referrerData.rentStatus?.dueDate ? new Date(referrerData.rentStatus.dueDate) : new Date());
    const newDue = new Date(Math.max(existingDue.getTime(), Date.now())); // don't extend from the past
    newDue.setDate(newDue.getDate() + rewardDays);

    await updateDoc(doc(db, 'users', referral.referrerId), {
        'rentStatus.dueDate': newDue,
        'rentStatus.plan': referrerData.rentStatus?.plan || 'weekly', // keep existing plan
        'rentStatus.amountOwed': 0,
        rentCredit: (referrerData.rentCredit || 0) + rewardDays, // track total days credited
        referralCount: (referrerData.referralCount || 0) + 1,
        referralEarnings: (referrerData.referralEarnings || 0) + rewardDays,
    });

    // Mark referral as rewarded
    await updateDoc(doc(db, 'referrals', userId), { rewarded: true, rewardedAt: serverTimestamp(), rewardDays });

    // Log it
    await addDoc(collection(db, 'referralLogs'), {
        referrerId: referral.referrerId,
        referredId: userId,
        rewardDays,
        createdAt: serverTimestamp(),
    });

    // Notify referrer
    await notifyUser(referral.referrerId, {
        title: '🎉 Referral reward earned!',
        message: `Someone you referred just completed their first task! You've earned ${rewardDays} day(s) of free rent credit.`,
        type: 'referral_reward',
        link: 'index.html',
    });
}