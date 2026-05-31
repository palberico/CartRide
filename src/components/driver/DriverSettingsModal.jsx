import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

export default function DriverSettingsModal({ onClose }) {
  const { user } = useAuth();
  const [driverDoc, setDriverDoc] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, 'drivers', user.uid), (snap) => {
      if (snap.exists()) setDriverDoc({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [user?.uid]);

  async function toggleOnline() {
    if (!driverDoc) return;
    const goingOnline = !driverDoc.online;
    try {
      await updateDoc(doc(db, 'drivers', user.uid), {
        online: goingOnline,
        ...(goingOnline ? {} : { location: null }),
      });
      toast(goingOnline ? '🟢 You are now online' : '⚫ You are now offline');
    } catch {
      toast.error('Could not update status.');
    }
  }

  async function toggleOfflineAccepting() {
    if (!driverDoc) return;
    try {
      await updateDoc(doc(db, 'drivers', user.uid), {
        acceptingOffline: !driverDoc.acceptingOffline,
      });
    } catch {
      toast.error('Could not update preference.');
    }
  }

  return (
    <div className="profile-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="profile-panel">
        <div className="profile-header">
          <h2>Settings</h2>
          <button className="profile-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="profile-body">
          {!driverDoc ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
              <div className="spinner" />
            </div>
          ) : (
            <>
              {/* Online toggle */}
              <div className="online-toggle">
                <div>
                  <div className="toggle-label">{driverDoc.online ? 'You are online' : 'Go online'}</div>
                  <div className="toggle-sublabel">
                    {driverDoc.online ? 'Riders can see you on the map' : 'Toggle to go active with GPS'}
                  </div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={!!driverDoc.online} onChange={toggleOnline} />
                  <span className="toggle-track" />
                </label>
              </div>

              {/* Offline accepting toggle */}
              <div className="online-toggle" style={{ background: driverDoc.acceptingOffline ? '#fff3e0' : undefined }}>
                <div>
                  <div className="toggle-label">Accept offline requests</div>
                  <div className="toggle-sublabel">
                    {driverDoc.acceptingOffline
                      ? "Riders can request you while you're offline"
                      : "Off — you won't get requests while offline"}
                  </div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={!!driverDoc.acceptingOffline} onChange={toggleOfflineAccepting} />
                  <span className="toggle-track" style={driverDoc.acceptingOffline ? { background: '#f4a261' } : {}} />
                </label>
              </div>

              <div className="divider" />

              {/* Payment info */}
              <div className="card card-tight text-sm">
                <div className="card-title" style={{ marginBottom: 6 }}>Your payment info</div>
                {driverDoc.venmoHandle && <div>Venmo: <strong>{driverDoc.venmoHandle}</strong></div>}
                {driverDoc.paypalHandle && <div>PayPal: <strong>{driverDoc.paypalHandle}</strong></div>}
                {!driverDoc.venmoHandle && !driverDoc.paypalHandle && (
                  <span className="text-muted">No payment handle set — riders won't know how to pay you.</span>
                )}
                <p style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-600)' }}>
                  To update payment info or your QR code, tap your name above.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
