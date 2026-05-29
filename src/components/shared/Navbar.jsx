import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

const ROLE_LABELS = { rider: 'Rider', driver: 'Driver', admin: 'Admin' };

export default function Navbar() {
  const { userProfile, logout } = useAuth();

  async function handleLogout() {
    try {
      await logout();
    } catch {
      toast.error('Failed to log out');
    }
  }

  return (
    <nav className="navbar">
      <span className="navbar-brand">
        <span className="emoji">🛺</span>
        CartRide
      </span>
      <div className="navbar-right">
        {userProfile && (
          <>
            <span className="navbar-user">{userProfile.name}</span>
            <span className="navbar-role">{ROLE_LABELS[userProfile.role] || userProfile.role}</span>
          </>
        )}
        <button className="btn-logout" onClick={handleLogout}>Sign out</button>
      </div>
    </nav>
  );
}
