import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './components/auth/Login';
import Register from './components/auth/Register';
import RiderDashboard from './components/rider/RiderDashboard';
import DriverDashboard from './components/driver/DriverDashboard';
import AdminDashboard from './components/admin/AdminDashboard';
import Navbar from './components/shared/Navbar';

function ProtectedRoute({ children, allowedRoles }) {
  const { userProfile } = useAuth();
  if (!userProfile) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(userProfile.role)) {
    return <Navigate to={`/${userProfile.role}`} replace />;
  }
  return children;
}

function RoleRedirect() {
  const { userProfile } = useAuth();
  if (!userProfile) return <Navigate to="/login" replace />;
  return <Navigate to={`/${userProfile.role}`} replace />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <>
      {user && <Navbar />}
      <Routes>
        <Route path="/login" element={user ? <RoleRedirect /> : <Login />} />
        <Route path="/register" element={user ? <RoleRedirect /> : <Register />} />
        <Route
          path="/rider"
          element={
            <ProtectedRoute allowedRoles={['rider']}>
              <RiderDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver"
          element={
            <ProtectedRoute allowedRoles={['driver']}>
              <DriverDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={user ? <RoleRedirect /> : <Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}
