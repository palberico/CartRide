import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, doc, updateDoc, addDoc, deleteDoc, query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import toast from 'react-hot-toast';

export default function AdminDashboard() {
  const [section, setSection] = useState('drivers');

  return (
    <div className="admin-page">
      <h1>CartRide Admin</h1>

      <div className="section-tabs" style={{ marginBottom: 28 }}>
        {[
          { key: 'drivers', label: '🛺 Drivers' },
          { key: 'locations', label: '📍 Common Locations' },
        ].map(t => (
          <button
            key={t.key}
            className={`section-tab ${section === t.key ? 'active' : ''}`}
            onClick={() => setSection(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === 'drivers' && <DriversSection />}
      {section === 'locations' && <LocationsSection />}
    </div>
  );
}

// ─── Drivers ──────────────────────────────────────────────────────────────────

function DriversSection() {
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

  const pending = drivers.filter(d => d.approved === false || d.approved == null);
  const approved = drivers.filter(d => d.approved === true);
  const displayList = tab === 'pending' ? pending : tab === 'approved' ? approved : drivers;

  return (
    <>
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
          { key: 'all', label: 'All' },
        ].map(t => (
          <button key={t.key} className={`section-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}

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
    </>
  );
}

function DriverCard({ driver, onApprove, onReject }) {
  const [loading, setLoading] = useState(false);
  async function handle(fn) { setLoading(true); await fn(); setLoading(false); }
  const statusLabel = driver.approved === true ? 'approved' : 'pending';

  return (
    <div className="driver-card">
      <div className="driver-avatar">🛺</div>
      <div className="driver-info">
        <div className="driver-name">{driver.name}</div>
        <div className="driver-meta">
          <span>{driver.email}</span>
          {driver.cartDescription && <span className="driver-meta-item">· {driver.cartDescription}</span>}
          {driver.venmoHandle && <span className="driver-meta-item">· Venmo: {driver.venmoHandle}</span>}
          {driver.paypalHandle && <span className="driver-meta-item">· PayPal: {driver.paypalHandle}</span>}
        </div>
        <div style={{ marginTop: 6 }}>
          <span className={`badge badge-${statusLabel}`}>{driver.approved === true ? 'Approved' : 'Pending review'}</span>
          {driver.online && (
            <span style={{ marginLeft: 8 }}>
              <span className="online-dot" style={{ marginRight: 4 }} />
              <span className="text-sm" style={{ color: '#166534' }}>Online now</span>
            </span>
          )}
        </div>
      </div>
      <div className="driver-card-actions">
        {driver.approved !== true && <button className="btn btn-success btn-sm" onClick={() => handle(onApprove)} disabled={loading}>✓ Approve</button>}
        {driver.approved === true && <button className="btn btn-danger btn-sm" onClick={() => handle(onReject)} disabled={loading}>Revoke</button>}
      </div>
    </div>
  );
}

// ─── Common Locations ──────────────────────────────────────────────────────────

function LocationsSection() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', address: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'commonLocations'), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      setLocations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function addLocation(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.address.trim()) return toast.error('Name and address are required.');
    setSaving(true);
    try {
      await addDoc(collection(db, 'commonLocations'), {
        name: form.name.trim(),
        address: form.address.trim(),
        createdAt: serverTimestamp(),
      });
      setForm({ name: '', address: '' });
      toast.success('Location added!');
    } catch {
      toast.error('Failed to add location.');
    } finally {
      setSaving(false);
    }
  }

  async function removeLocation(id) {
    try {
      await deleteDoc(doc(db, 'commonLocations', id));
      toast('Location removed.');
    } catch {
      toast.error('Failed to remove location.');
    }
  }

  return (
    <>
      <p className="subtitle">
        Add frequently-used destinations. Riders can select these from a dropdown instead of typing.
      </p>

      {/* Add form */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Add a location</div>
        <form onSubmit={addLocation} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Display name</label>
            <input
              type="text"
              placeholder="e.g. Bees Stadium"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Full address</label>
            <input
              type="text"
              placeholder="e.g. 77 W 1300 S, South Jordan, UT 84095"
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ alignSelf: 'flex-start' }}>
            {saving ? 'Saving…' : '+ Add location'}
          </button>
        </form>
      </div>

      {/* Location list */}
      {loading && <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}

      {!loading && locations.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">📍</span>
          No common locations yet. Add one above.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {locations.map(loc => (
          <div key={loc.id} className="driver-card">
            <div className="driver-avatar" style={{ fontSize: 20 }}>📍</div>
            <div className="driver-info">
              <div className="driver-name">{loc.name}</div>
              <div className="driver-meta">{loc.address}</div>
            </div>
            <div className="driver-card-actions">
              <button className="btn btn-danger btn-sm" onClick={() => removeLocation(loc.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
