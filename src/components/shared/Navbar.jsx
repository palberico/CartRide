import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import ProfileModal from '../driver/ProfileModal';
import toast from 'react-hot-toast';

const ROLE_LABELS = { rider: 'Rider', driver: 'Driver', admin: 'Admin' };

export default function Navbar() {
  const { userProfile, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const isDriver = userProfile?.role === 'driver';

  async function handleLogout() {
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
              <span className="navbar-role">{ROLE_LABELS[userProfile.role] || userProfile.role}</span>
            </>
          )}
          <button className="btn-logout" onClick={handleLogout}>Sign out</button>
        </div>
      </nav>

      {isDriver && profileOpen && (
        <ProfileModal onClose={() => setProfileOpen(false)} />
      )}
    </>
  );
}
