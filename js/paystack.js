// ============================================
// PAYSTACK — payment helper
// Drop your real public key below (starts with pk_test_ or pk_live_).
// Get it from Paystack Dashboard > Settings > API Keys & Webhooks
// ============================================

export const PAYSTACK_PUBLIC_KEY = "pk_live_68f761921ca9f3c8bed75895a63a22c0fb796068";

// Loads the Paystack inline script once, on demand
let paystackScriptLoaded = false;
function loadPaystackScript() {
  return new Promise((resolve, reject) => {
    if (paystackScriptLoaded || window.PaystackPop) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.onload = () => {
      paystackScriptLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Paystack script."));
    document.head.appendChild(script);
  });
}

/**
 * Opens the Paystack popup checkout.
 * @param {Object} opts
 * @param {string} opts.email - payer's email (required by Paystack)
 * @param {number} opts.amountNaira - amount in Naira (will be converted to kobo)
 * @param {string} [opts.reference] - unique transaction reference, auto-generated if omitted
 * @param {Object} [opts.metadata] - extra data to tag the transaction (e.g. gigId, purpose)
 * @returns {Promise<Object>} resolves with the Paystack transaction response on success
 *
 * Important: Paystack only verifies the CARD charge client-side here. Before this touches
 * real money in production, add a backend (Cloud Function) that calls Paystack's
 * /transaction/verify endpoint with your SECRET key and only then updates Firestore
 * (release deposit, mark rent paid, etc). A client-side "success" callback alone isn't
 * enough to trust for real payments.
 */
export async function payWithPaystack({ email, amountNaira, reference, metadata = {} }) {
  await loadPaystackScript();

  return new Promise((resolve, reject) => {
    if (!window.PaystackPop) {
      reject(new Error("Paystack script not available."));
      return;
    }

    const handler = window.PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email,
      amount: Math.round(amountNaira * 100), // kobo
      currency: "NGN",
      ref: reference || `provaspace_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      metadata,
      callback: (response) => {
        // response.reference should be sent to a backend for verification before crediting
        // anything in a production build — see the note above.
        resolve(response);
      },
      onClose: () => {
        reject(new Error("Payment window closed before completing payment."));
      },
    });

    handler.openIframe();
  });
}
