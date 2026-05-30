import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

export default function ProfileModal({ onClose }) {
  const { user, userProfile, refreshProfile, deleteAccount } = useAuth();
  const [form, setForm] = useState({
    name: userProfile?.name || '',
    cartDescription: '',
    venmoHandle: '',
    paypalHandle: '',
  });
  const [driverData, setDriverData] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(userProfile?.avatarUrl || null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [venmoQrPreview, setVenmoQrPreview] = useState(null);
  const [venmoQrFile, setVenmoQrFile] = useState(null);
  const [removeVenmoQr, setRemoveVenmoQr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);
  const venmoQrInputRef = useRef(null);

  // Load driver-specific fields once on mount
  useEffect(() => {
    if (userProfile?.role !== 'driver') return;
    getDoc(doc(db, 'drivers', user.uid)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setDriverData(data);
        setForm(f => ({
          ...f,
          cartDescription: data.cartDescription || '',
          venmoHandle: data.venmoHandle || '',
          paypalHandle: data.paypalHandle || '',
        }));
        if (data.avatarUrl) setAvatarPreview(data.avatarUrl);
        if (data.venmoQrUrl) setVenmoQrPreview(data.venmoQrUrl);
      }
    });
  }, []);

  function handleAvatarChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB.');
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  function handleVenmoQrChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB.');
    setVenmoQrFile(file);
    setVenmoQrPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Name is required.');
    setSaving(true);
    try {
      let avatarUrl = driverData?.avatarUrl || userProfile?.avatarUrl || null;
      let venmoQrUrl = driverData?.venmoQrUrl || null;

      if (avatarFile) {
        const storageRef = ref(storage, `avatars/${user.uid}`);
        await uploadBytes(storageRef, avatarFile);
        avatarUrl = await getDownloadURL(storageRef);
      }

      if (removeVenmoQr) {
        try { await deleteObject(ref(storage, `venmo-qr/${user.uid}`)); } catch {}
        venmoQrUrl = null;
      } else if (venmoQrFile) {
        const qrRef = ref(storage, `venmo-qr/${user.uid}`);
        await uploadBytes(qrRef, venmoQrFile);
        venmoQrUrl = await getDownloadURL(qrRef);
      }

      await updateDoc(doc(db, 'users', user.uid), {
        name: form.name.trim(),
        ...(avatarUrl !== null && { avatarUrl }),
      });

      if (userProfile?.role === 'driver') {
        await updateDoc(doc(db, 'drivers', user.uid), {
          name: form.name.trim(),
          cartDescription: form.cartDescription.trim(),
          venmoHandle: form.venmoHandle.trim(),
          paypalHandle: form.paypalHandle.trim(),
          ...(avatarUrl !== null && { avatarUrl }),
          ...(removeVenmoQr ? { venmoQrUrl: deleteField() } : venmoQrUrl !== null ? { venmoQrUrl } : {}),
        });
      }

      await refreshProfile();
      toast.success('Profile updated!');
      onClose();
    } catch (err) {
      toast.error('Failed to save changes.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAccount();
      toast.success('Account deleted.');
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        toast.error('Your session is too old. Sign out, sign back in, then delete your account.');
      } else {
        toast.error('Failed to delete account. Please try again.');
      }
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const initials = form.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="profile-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="profile-panel">
        {/* Header */}
        <div className="profile-header">
          <h2>Edit Profile</h2>
          <button className="profile-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="profile-body">
          {/* Avatar */}
          <div className="avatar-section">
            <button className="avatar-upload-btn" onClick={() => fileInputRef.current?.click()} title="Change photo">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="avatar-img" />
              ) : (
                <div className="avatar-initials">{initials}</div>
              )}
              <div className="avatar-overlay">
                <span>📷</span>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
            />
            <p className="avatar-hint">Tap to change photo</p>
          </div>

          {/* Name */}
          <div className="form-group">
            <label>Full name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Your name"
            />
          </div>

          {/* Driver-only fields */}
          {userProfile?.role === 'driver' && (
            <>
              <div className="form-group">
                <label>Golf cart description</label>
                <textarea
                  value={form.cartDescription}
                  onChange={e => setForm(f => ({ ...f, cartDescription: e.target.value }))}
                  placeholder="e.g. White EZGo, 4-seater"
                  rows={2}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Venmo</label>
                  <input
                    type="text"
                    value={form.venmoHandle}
                    onChange={e => setForm(f => ({ ...f, venmoHandle: e.target.value }))}
                    placeholder="@Handle"
                  />
                </div>
                <div className="form-group">
                  <label>PayPal</label>
                  <input
                    type="text"
                    value={form.paypalHandle}
                    onChange={e => setForm(f => ({ ...f, paypalHandle: e.target.value }))}
                    placeholder="@Handle"
                  />
                </div>
              </div>

              {/* Venmo QR code */}
              <div className="form-group">
                <label>Venmo QR Code</label>
                <p style={{ fontSize: 12, color: 'var(--gray-600)', marginBottom: 10 }}>
                  Riders will see this on the payment screen so they can scan to pay.
                </p>
                {venmoQrPreview ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <img
                      src={venmoQrPreview}
                      alt="Venmo QR"
                      style={{ width: 120, height: 120, objectFit: 'contain', border: '1.5px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', background: '#fff' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => venmoQrInputRef.current?.click()}>
                        Replace image
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => { setVenmoQrPreview(null); setVenmoQrFile(null); setRemoveVenmoQr(true); }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => venmoQrInputRef.current?.click()}>
                    📷 Upload QR code
                  </button>
                )}
                <input
                  ref={venmoQrInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleVenmoQrChange}
                />
              </div>
            </>
          )}

          {/* Save */}
          <button className="btn btn-primary w-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>

          {/* Danger zone */}
          <div className="danger-zone">
            <div className="danger-zone-title">Danger zone</div>
            {!confirmDelete ? (
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
                Delete my account
              </button>
            ) : (
              <div className="delete-confirm">
                <p>This permanently deletes your account and all your data. This cannot be undone.</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Deleting…' : 'Yes, delete my account'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
