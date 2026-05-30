import { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  deleteUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { auth, db, storage } from '../firebase/config';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function register({ name, email, password, role, venmoHandle, paypalHandle, cartDescription }) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    await setDoc(doc(db, 'users', uid), {
      name,
      email,
      role,
      createdAt: serverTimestamp(),
    });

    if (role === 'driver') {
      await setDoc(doc(db, 'drivers', uid), {
        uid,
        name,
        email,
        venmoHandle: venmoHandle || '',
        paypalHandle: paypalHandle || '',
        cartDescription: cartDescription || '',
        approved: false,
        online: false,
        location: null,
      });
    }

    // Set profile immediately so App.jsx never sees user=logged-in + userProfile=null
    setUserProfile({ uid, name, email, role });

    return cred;
  }

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    return signOut(auth);
  }

  async function refreshProfile() {
    if (!auth.currentUser) return;
    const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
    if (snap.exists()) {
      setUserProfile({ uid: auth.currentUser.uid, ...snap.data() });
    }
  }

  async function deleteAccount() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const uid = currentUser.uid;
    const role = userProfile?.role;

    // Delete app data first while the auth token is still valid.
    // If deleteUser below fails with auth/requires-recent-login, the UI
    // catches that and tells the user to re-login — the orphaned Firestore/
    // Storage data will be cleaned up on their next deletion attempt.
    await Promise.allSettled([
      deleteObject(ref(storage, `avatars/${uid}`)),
      deleteObject(ref(storage, `venmo-qr/${uid}`)),
    ]);

    if (role === 'driver') await deleteDoc(doc(db, 'drivers', uid));
    await deleteDoc(doc(db, 'users', uid));

    // Delete the Auth account last. Throws auth/requires-recent-login if the
    // session is stale — the caller surfaces this as a re-login prompt.
    await deleteUser(currentUser);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (snap.exists()) {
          setUserProfile({ uid: firebaseUser.uid, ...snap.data() });
        }
        setUser(firebaseUser);
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = { user, userProfile, loading, register, login, logout, refreshProfile, deleteAccount };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
