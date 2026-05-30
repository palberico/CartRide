import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import ProfileModal from '../driver/ProfileModal';
import toast from 'react-hot-toast';

export default function Navbar() {
  const { userProfile, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const isDriver = userProfile?.role === 'driver';
  const isRider  = userProfile?.role === 'rider';

  // Close menu when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleLogout() {
    setMenuOpen(false);
    try {
      await logout();
    } catch {
      toast.error('Failed to log out');
    }
  }

  return (
    <>
      <nav className="navbar">
        <span className="navbar-brand">
          <span className="emoji">🛺</span>
          CartRide
        </span>

        <div className="navbar-right">
          {/* Desktop layout */}
          <div className="navbar-desktop">
            {userProfile && (
              <>
                {isDriver ? (
                  <button
                    className="navbar-name-btn"
                    onClick={() => setProfileOpen(true)}
                    title="Edit profile"
                  >
                    {userProfile.avatarUrl ? (
                      <img src={userProfile.avatarUrl} alt="" className="navbar-avatar" />
                    ) : (
                      <div className="navbar-avatar-initials">
                        {userProfile.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {userProfile.name}
                  </button>
                ) : (
                  <span className="navbar-user">{userProfile.name}</span>
                )}
                {/* Show role badge for driver and admin, not for rider */}
                {!isRider && (
                  <span className="navbar-role">
                    {userProfile.role === 'driver' ? 'Driver' : 'Admin'}
                  </span>
                )}
              </>
            )}
            <button className="btn-logout" onClick={handleLogout}>Sign out</button>
          </div>

          {/* Mobile hamburger */}
          <div className="navbar-mobile" ref={menuRef}>
            <button
              className="hamburger-btn"
              onClick={() => setMenuOpen(v => !v)}
              aria-label="Menu"
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect y="4"  width="22" height="2.2" rx="1.1" fill="white"/>
                <rect y="10" width="22" height="2.2" rx="1.1" fill="white"/>
                <rect y="16" width="22" height="2.2" rx="1.1" fill="white"/>
              </svg>
            </button>

            {menuOpen && (
              <div className="nav-dropdown">
                {userProfile && (
                  <div className="nav-dropdown-user">
                    {isDriver ? (
                      <button
                        className="nav-dropdown-profile"
                        onClick={() => { setMenuOpen(false); setProfileOpen(true); }}
                      >
                        {userProfile.avatarUrl ? (
                          <img src={userProfile.avatarUrl} alt="" className="navbar-avatar" />
                        ) : (
                          <div className="navbar-avatar-initials" style={{ width: 32, height: 32, fontSize: 13 }}>
                            {userProfile.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span>{userProfile.name}</span>
                      </button>
                    ) : (
                      <span className="nav-dropdown-name">{userProfile.name}</span>
                    )}
                  </div>
                )}
                <button className="nav-dropdown-signout" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {isDriver && profileOpen && (
        <ProfileModal onClose={() => setProfileOpen(false)} />
      )}
    </>
  );
}
