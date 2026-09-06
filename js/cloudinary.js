// ============================================
// CLOUDINARY — unsigned upload helper
// Uses the same Cloudinary cloud you're already running for LEXTO/Unicore-style uploads.
// (unsigned preset — signed uploads need a backend/secret, so that stays out of the browser)
// ============================================

const CLOUDINARY_CLOUD_NAME = "wl8rfdxr";
const CLOUDINARY_UPLOAD_PRESET = "provaspace";

/**
 * Uploads a file to Cloudinary and returns the hosted URL.
 * @param {File} file
 * @returns {Promise<string>} secure_url of the uploaded asset
 */
export async function uploadToCloudinary(file) {

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        throw new Error('Cloudinary upload failed.');
    }

    const data = await res.json();
    return data.secure_url;
}
