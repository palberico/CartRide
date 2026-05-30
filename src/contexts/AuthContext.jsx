import { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase/config';

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
    if (!auth.currentUser) return;
    // Cloud Function handles Auth + Firestore + Storage deletion atomically
    // using the Admin SDK — no client-side auth token concerns.
    const deleteAccountFn = httpsCallable(functions, 'deleteAccount');
    await deleteAccountFn();
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
