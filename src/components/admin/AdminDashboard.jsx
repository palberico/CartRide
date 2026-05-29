import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/config';
import toast from 'react-hot-toast';

const STATUS_TABS = ['all', 'pending', 'approved', 'rejected'];

export default function AdminDashboard() {
  const [drivers, setDrivers] = useState([]);
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'drivers'), orderBy('approved'));
    const unsub = onSnapshot(q, (snap) => {
      setDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function setApproval(driverId, approved) {
    try {
      await updateDoc(doc(db, 'drivers', driverId), { approved });
      toast.success(approved ? 'Driver approved!' : 'Driver rejected.');
    } catch {
      toast.error('Failed to update driver status.');
    }
  }

  const filtered = drivers.filter(d => {
    if (tab === 'all') return true;
    if (tab === 'pending') return !d.approved && d.approved !== false;
    if (tab === 'approved') return d.approved === true;
    if (tab === 'rejected') return d.approved === false;
    return true;
  });

  // Pending = approved is falsy but not explicitly false (i.e., just never set / default false from register)
  // Actually since we set approved: false on register, pending = approved === false and not yet reviewed
  // Let's simplify: pending = !approved, approved = approved === true
  const pending = drivers.filter(d => d.approved === false || d.approved == null);
  const approved = drivers.filter(d => d.approved === true);

  const displayList = tab === 'all'
    ? drivers
    : tab === 'pending'
    ? pending
    : tab === 'approved'
    ? approved
    : [];

  return (
    <div className="admin-page">
      <h1>Driver Management</h1>
      <p className="subtitle">
        Review and approve golf cart drivers in Daybreak.
        {pending.length > 0 && (
          <span style={{ color: '#b45309', fontWeight: 600, marginLeft: 8 }}>
            {pending.length} pending approval
          </span>
        )}
      </p>

      <div className="section-tabs">
        {[
          { key: 'pending', label: `Pending (${pending.length})` },
          { key: 'approved', label: `Approved (${approved.length})` },
          { key: 'all', label: 'All drivers' },
        ].map(t => (
          <button
            key={t.key}
            className={`section-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      )}

      {!loading && displayList.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">👍</span>
          {tab === 'pending' ? 'No drivers waiting for approval.' : 'No drivers here.'}
        </div>
      )}

      <div className="driver-list">
        {displayList.map(driver => (
          <DriverCard
            key={driver.id}
            driver={driver}
            onApprove={() => setApproval(driver.id, true)}
            onReject={() => setApproval(driver.id, false)}
          />
        ))}
      </div>
    </div>
  );
}

function DriverCard({ driver, onApprove, onReject }) {
  const [loading, setLoading] = useState(false);

  async function handle(fn) {
    setLoading(true);
    await fn();
    setLoading(false);
  }

  const statusLabel = driver.approved === true ? 'approved' : 'pending';

  return (
    <div className="driver-card">
      <div className="driver-avatar">🛺</div>

      <div className="driver-info">
        <div className="driver-name">{driver.name}</div>
        <div className="driver-meta">
          <span>{driver.email}</span>
          {driver.cartDescription && (
            <span className="driver-meta-item">· {driver.cartDescription}</span>
          )}
          {driver.venmoHandle && (
            <span className="driver-meta-item">· Venmo: {driver.venmoHandle}</span>
          )}
          {driver.paypalHandle && (
            <span className="driver-meta-item">· PayPal: {driver.paypalHandle}</span>
          )}
        </div>
        <div style={{ marginTop: 6 }}>
          <span className={`badge badge-${statusLabel}`}>
            {driver.approved === true ? 'Approved' : 'Pending review'}
          </span>
          {driver.online && (
            <span style={{ marginLeft: 8 }}>
              <span className="online-dot" style={{ marginRight: 4 }} />
              <span className="text-sm" style={{ color: '#166534' }}>Online now</span>
            </span>
          )}
        </div>
      </div>

      <div className="driver-card-actions">
        {driver.approved !== true && (
          <button
            className="btn btn-success btn-sm"
            onClick={() => handle(onApprove)}
            disabled={loading}
          >
            ✓ Approve
          </button>
        )}
        {driver.approved === true && (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => handle(onReject)}
            disabled={loading}
          >
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}
