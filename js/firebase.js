// ============================================
// FIREBASE CONFIG — live project credentials for provaspace-4b8c4
// ============================================

// Loaded via CDN (no bundler needed) — swap for npm imports if you move this into a build step later.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  increment,
  arrayUnion,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD1HbZeZU4WEcYcIeSyd_iZzApiaJ6YDSI",
  authDomain: "provaspace-4b8c4.firebaseapp.com",
  projectId: "provaspace-4b8c4",
  storageBucket: "provaspace-4b8c4.firebasestorage.app",
  messagingSenderId: "664218621918",
  appId: "1:664218621918:web:903dd6f770233b0ea4ef4f",
  measurementId: "G-K19F16P3NR"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  increment,
  arrayUnion,
  Timestamp,
};

// ============================================
// FIRESTORE COLLECTION STRUCTURE (reference — build these as you go)
// ============================================
// users/{uid}            -> { role: "freelancer"|"client", name, email, phone,
//                              trustScore, rentStatus: {...}, ... }
// gigs/{gigId}            -> { title, description, price, deposit, milestones: [...],
//                              postedBy, status: "open"|"claimed"|"completed",
//                              claimedBy, timerStart, timerDuration, insuranceOpted }
// contracts/{contractId}  -> { gigId, clientId, freelancerId, milestones: [...],
//                              status, chatThreadId }
// settings/prices          -> { rentWeekly, rentMonthly, rentYearly, taxPassFee,
//                              overdueFee, gracePeriodDays } (admin-editable via admin.html)
// disputes/{disputeId}    -> { contractId, raisedBy, reason, status, resolution }
