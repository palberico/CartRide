const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

initializeApp();

/**
 * Callable function: deleteAccount
 * Deletes the authenticated user's Auth account, Firestore docs, and Storage files
 * in a single Admin SDK operation — no client-side auth token concerns.
 */
exports.deleteAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to delete account.');
  }

  const uid = request.auth.uid;
  const db = getFirestore();
  const bucket = getStorage().bucket();

  // Read role from Firestore to know whether to delete the drivers doc
  const userSnap = await db.collection('users').doc(uid).get();
  const role = userSnap.exists ? userSnap.data().role : null;

  // Delete Storage files (ignore errors — files may not exist)
  await Promise.allSettled([
    bucket.file(`avatars/${uid}`).delete(),
    bucket.file(`venmo-qr/${uid}`).delete(),
  ]);

  // Delete Firestore documents
  const deletions = [db.collection('users').doc(uid).delete()];
  if (role === 'driver') {
    deletions.push(db.collection('drivers').doc(uid).delete());
  }
  await Promise.all(deletions);

  // Delete the Firebase Auth account last
  await getAuth().deleteUser(uid);
});
