import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { CITY_LIST } from '../../constants/cities';

function EyeIcon({ open }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'rider',
    city: '',
    venmoHandle: '',
    paypalHandle: '',
    cartDescription: '',
  });
  const [venmoQrFile, setVenmoQrFile] = useState(null);
  const [venmoQrPreview, setVenmoQrPreview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const venmoQrInputRef = useRef(null);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function selectRole(role) {
    setForm(f => ({ ...f, role, city: '' }));
    setVenmoQrFile(null);
    setVenmoQrPreview(null);
  }

  function selectCity(cityId) {
    setForm(f => ({ ...f, city: cityId }));
  }

  function handleVenmoQrChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('QR image must be under 5 MB.');
      return;
    }
    setVenmoQrFile(file);
    setVenmoQrPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.password.length < 6) {
      return setError('Password must be at least 6 characters.');
    }
    if (form.role === 'driver' && !form.city) {
      return setError('Please select the city where you drive.');
    }
    if (form.role === 'driver' && !form.venmoHandle && !form.paypalHandle) {
      return setError('Please enter at least a Venmo or PayPal handle so riders can pay you.');
    }

    setLoading(true);
    try {
      await register({ ...form, venmoQrFile });
    } catch (err) {
      setError(getFriendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="logo-icon">🛺</span>
          <h1>CartRide</h1>
          <p>Golf Cart Rides · Daybreak &amp; Viera</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <h2>Create your account</h2>

          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label>Full name</label>
            <input
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              placeholder="Jane Smith"
              required
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@email.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <div className="password-wrapper">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange}
                placeholder="At least 6 characters"
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-peek-btn"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>I want to…</label>
            <div className="role-selector">
              <div
                className={`role-option ${form.role === 'rider' ? 'selected' : ''}`}
                onClick={() => selectRole('rider')}
              >
                <span className="role-icon">🙋</span>
                <span className="role-label">Request rides</span>
                <span className="role-desc">I need a ride</span>
              </div>
              <div
                className={`role-option ${form.role === 'driver' ? 'selected' : ''}`}
                onClick={() => selectRole('driver')}
              >
                <span className="role-icon">🛺</span>
                <span className="role-label">Drive neighbors</span>
                <span className="role-desc">I have a golf cart</span>
              </div>
            </div>
          </div>

          {form.role === 'driver' && (
            <div className="driver-fields">
              <div className="driver-fields-title">Driver details</div>

              {/* City selector */}
              <div className="form-group">
                <label>City you drive in</label>
                <div className="role-selector">
                  {CITY_LIST.map(city => (
                    <div
                      key={city.id}
                      className={`role-option ${form.city === city.id ? 'selected' : ''}`}
                      onClick={() => selectCity(city.id)}
                    >
                      <span className="role-icon">{city.id === 'daybreak' ? '🏔️' : '🌴'}</span>
                      <span className="role-label">{city.name}</span>
                      <span className="role-desc">{city.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Golf cart description</label>
                <textarea
                  name="cartDescription"
                  value={form.cartDescription}
                  onChange={handleChange}
                  placeholder="e.g. White EZGo, 4-seater, has a green stripe"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Venmo handle</label>
                  <input
                    name="venmoHandle"
                    type="text"
                    value={form.venmoHandle}
                    onChange={handleChange}
                    placeholder="@YourHandle"
                  />
                </div>
                <div className="form-group">
                  <label>PayPal handle</label>
                  <input
                    name="paypalHandle"
                    type="text"
                    value={form.paypalHandle}
                    onChange={handleChange}
                    placeholder="@YourHandle"
                  />
                </div>
              </div>

              {/* Venmo QR code upload */}
              <div className="form-group">
                <label>Venmo QR Code <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 12, color: 'var(--gray-400)' }}>(optional)</span></label>
                <p style={{ fontSize: 12, color: 'var(--gray-600)', marginBottom: 10 }}>
                  Riders will see this so they can scan to pay you.
                </p>
                {venmoQrPreview ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <img
                      src={venmoQrPreview}
                      alt="Venmo QR"
                      style={{ width: 100, height: 100, objectFit: 'contain', border: '1.5px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', background: '#fff' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => venmoQrInputRef.current?.click()}>
                        Replace
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => { setVenmoQrFile(null); setVenmoQrPreview(null); }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => venmoQrInputRef.current?.click()}>
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

              <p className="text-sm text-muted">
                ⚠️ Your account needs admin approval before you can drive. You'll be able to go online once approved.
              </p>
            </div>
          )}

          <button className="btn btn-primary btn-lg mt-16" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function getFriendlyError(code) {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    default:
      return 'Failed to create account. Please try again.';
  }
}
