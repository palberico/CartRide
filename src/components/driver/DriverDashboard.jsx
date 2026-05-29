import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
} from '@react-google-maps/api';
import {
  doc,
  onSnapshot,
  updateDoc,
  collection,
  query,
  where,
  limit,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

const DAYBREAK_CENTER = { lat: 40.5515, lng: -112.0245 };

const DAYBREAK_BOUNDARY = [
  { lat: 40.565944, lng: -112.015250 },
  { lat: 40.566000, lng: -111.994889 },
  { lat: 40.561083, lng: -111.991250 },
  { lat: 40.556194, lng: -111.989250 },
  { lat: 40.551222, lng: -111.986111 },
  { lat: 40.549361, lng: -111.987806 },
  { lat: 40.547778, lng: -111.991333 },
  { lat: 40.544333, lng: -111.991194 },
  { lat: 40.544139, lng: -111.988528 },
  { lat: 40.536972, lng: -111.992639 },
  { lat: 40.537028, lng: -112.059750 },
  { lat: 40.550750, lng: -112.062861 },
  { lat: 40.562167, lng: -112.024722 },
];


const MAP_OPTIONS = {
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
};

export default function DriverDashboard() {
  const { userProfile } = useAuth();
  const [driverDoc, setDriverDoc] = useState(null);
  const [pendingRides, setPendingRides] = useState([]);
  const [activeRide, setActiveRide] = useState(null);
  const [myLocation, setMyLocation] = useState(null);
  const watchIdRef = useRef(null);
  const mapRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: apiKey || '' });

  // Subscribe to own driver doc
  useEffect(() => {
    if (!userProfile?.uid) return;
    const unsub = onSnapshot(doc(db, 'drivers', userProfile.uid), (snap) => {
      if (snap.exists()) setDriverDoc({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [userProfile?.uid]);

  // Subscribe to pending ride requests (online OR acceptingOffline, and approved)
  useEffect(() => {
    if (!driverDoc?.approved || (!driverDoc?.online && !driverDoc?.acceptingOffline)) {
      setPendingRides([]);
      return;
    }
    const q = query(
      collection(db, 'rides'),
      where('status', '==', 'pending'),
      limit(10)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort oldest-first client-side (no composite index needed)
      rides.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setPendingRides(rides);
    });
    return unsub;
  }, [driverDoc?.online, driverDoc?.approved, driverDoc?.acceptingOffline]);

  // Subscribe to the driver's active ride
  useEffect(() => {
    if (!userProfile?.uid) return;
    const q = query(
      collection(db, 'rides'),
      where('driverId', '==', userProfile.uid),
      where('status', 'in', ['accepted']),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      setActiveRide(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() });
    });
    return unsub;
  }, [userProfile?.uid]);

  // Start/stop geolocation based on online status
  useEffect(() => {
    if (driverDoc?.online) {
      startTracking();
    } else {
      stopTracking();
    }
    return stopTracking;
  }, [driverDoc?.online]);

  function startTracking() {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported by your browser.');
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLocation(location);
        if (userProfile?.uid) {
          updateDoc(doc(db, 'drivers', userProfile.uid), { location, lastSeen: serverTimestamp() }).catch(() => {});
        }
      },
      (err) => {
        console.warn('Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 10000 }
    );
  }

  function stopTracking() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }

  async function toggleOnline() {
    if (!driverDoc) return;
    const goingOnline = !driverDoc.online;
    try {
      await updateDoc(doc(db, 'drivers', userProfile.uid), {
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
      await updateDoc(doc(db, 'drivers', userProfile.uid), {
        acceptingOffline: !driverDoc.acceptingOffline,
      });
    } catch {
      toast.error('Could not update preference.');
    }
  }

  async function acceptRide(ride) {
    try {
      const driverSnap = await getDoc(doc(db, 'drivers', userProfile.uid));
      const driverData = driverSnap.data();
      await updateDoc(doc(db, 'rides', ride.id), {
        driverId: userProfile.uid,
        driverName: userProfile.name,
        driverVenmo: driverData.venmoHandle || '',
        driverPaypal: driverData.paypalHandle || '',
        status: 'accepted',
        updatedAt: serverTimestamp(),
      });
      toast.success(`Accepted ride for ${ride.riderName}!`);
    } catch {
      toast.error('Could not accept this ride. It may have been taken.');
    }
  }

  async function completeRide() {
    if (!activeRide) return;
    try {
      await updateDoc(doc(db, 'rides', activeRide.id), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      });
      toast.success('Ride completed! Collect your $6.');
      setActiveRide(null);
    } catch {
      toast.error('Could not mark ride as complete.');
    }
  }

  const onMapLoad = useCallback((map) => { mapRef.current = map; setMapInstance(map); }, []);

  useEffect(() => {
    if (!mapInstance) return;
    const polygon = new window.google.maps.Polygon({
      paths: DAYBREAK_BOUNDARY,
      strokeColor: '#2d6a4f',
      strokeOpacity: 0.85,
      strokeWeight: 2.5,
      fillColor: '#2d6a4f',
      fillOpacity: 0.07,
      map: mapInstance,
    });
    return () => polygon.setMap(null);
  }, [mapInstance]);

  if (!driverDoc) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 60px)' }}>
        <div className="spinner" />
      </div>
    );
  }

  // Pending approval
  if (!driverDoc.approved) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 60px)' }}>
        <div className="status-screen">
          <span className="status-icon">⏳</span>
          <h2 className="status-title">Pending approval</h2>
          <p className="status-desc">
            Your driver account is awaiting approval from the CartRide admin.
            You'll be able to go online once approved.
          </p>
          <p className="text-sm text-muted" style={{ marginTop: 8 }}>
            Cart: {driverDoc.cartDescription || 'Not specified'}
          </p>
        </div>
      </div>
    );
  }

  const incomingRides = pendingRides.filter(r => r.driverId == null);

  return (
    <div className="dashboard has-sidebar">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Driver Dashboard</h2>
          <p>
            {driverDoc.online
              ? <><span className="online-dot" style={{ marginRight: 6 }} />Online — accepting rides</>
              : driverDoc.acceptingOffline
              ? <><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f4a261', display: 'inline-block', marginRight: 6 }} />Offline — accepting requests</>
              : <><span className="offline-dot" style={{ marginRight: 6 }} />Offline</>
            }
          </p>
        </div>

        <div className="sidebar-body">
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
                  ? 'Riders can request you while you\'re offline'
                  : 'Off — you won\'t get requests while offline'}
              </div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={!!driverDoc.acceptingOffline} onChange={toggleOfflineAccepting} />
              <span className="toggle-track" style={driverDoc.acceptingOffline ? { background: '#f4a261' } : {}} />
            </label>
          </div>

          {/* Payment info reminder */}
          <div className="card card-tight text-sm">
            <div className="card-title" style={{ marginBottom: 6 }}>Your payment info</div>
            {driverDoc.venmoHandle && <div>Venmo: <strong>{driverDoc.venmoHandle}</strong></div>}
            {driverDoc.paypalHandle && <div>PayPal: <strong>{driverDoc.paypalHandle}</strong></div>}
            {!driverDoc.venmoHandle && !driverDoc.paypalHandle && (
              <span className="text-muted">No payment handle set — riders won't know how to pay you.</span>
            )}
          </div>

          <div className="divider" />

          {/* Active ride */}
          {activeRide && (
            <div>
              <div className="card-title">Active ride</div>
              <div className="ride-request-card">
                <h3>🛺 Ride in progress</h3>
                <div className="ride-detail-row">
                  <strong>Rider:</strong>
                  <span>{activeRide.riderName}</span>
                </div>
                <div className="ride-detail-row">
                  <strong>Pickup:</strong>
                  <span>
                    {activeRide.pickupLocation?.lat?.toFixed(5)},{' '}
                    {activeRide.pickupLocation?.lng?.toFixed(5)}
                  </span>
                </div>
                <div className="ride-detail-row">
                  <strong>Destination:</strong>
                  <span>{activeRide.dropoffAddress}</span>
                </div>
                <div className="ride-detail-row">
                  <strong>Collect:</strong>
                  <span>${activeRide.price} via Venmo/PayPal/cash</span>
                </div>
                <div className="ride-actions">
                  <button className="btn btn-success" onClick={completeRide}>
                    ✓ Mark as complete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pending ride requests */}
          {!activeRide && (driverDoc.online || driverDoc.acceptingOffline) && (
            <div>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Incoming requests
                {incomingRides.length > 0 && (
                  <span className="notification-pill">{incomingRides.length}</span>
                )}
              </div>

              {incomingRides.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">🔇</span>
                  No ride requests yet.<br />
                  {driverDoc.acceptingOffline && !driverDoc.online
                    ? 'You\'ll be notified when a rider requests you.'
                    : 'Sit tight — one will come in soon.'}
                </div>
              ) : (
                incomingRides.map(ride => (
                  <RideRequestCard key={ride.id} ride={ride} onAccept={() => acceptRide(ride)} />
                ))
              )}
            </div>
          )}

          {!driverDoc.online && !driverDoc.acceptingOffline && !activeRide && (
            <div className="empty-state">
              <span className="empty-icon">💤</span>
              You're offline. Go online or enable offline requests above.
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="map-container" style={{ position: 'relative' }}>
        {!apiKey || apiKey === 'your_google_maps_api_key' ? (
          <div className="map-no-key">
            <span style={{ fontSize: 40 }}>🗺️</span>
            <strong>Google Maps API key not set</strong>
            <span>Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file.</span>
          </div>
        ) : isLoaded ? (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={myLocation || DAYBREAK_CENTER}
            zoom={15}
            options={MAP_OPTIONS}
            onLoad={onMapLoad}
          >
            {/* Driver's own location */}
            {myLocation && (
              <Marker
                position={myLocation}
                title="You"
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(youSvg),
                  scaledSize: { width: 40, height: 40 },
                  anchor: { x: 20, y: 20 },
                }}
              />
            )}

            {/* Rider pickup location for active ride */}
            {activeRide?.pickupLocation && (
              <Marker
                position={activeRide.pickupLocation}
                title={`${activeRide.riderName}'s pickup`}
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pickupSvg),
                  scaledSize: { width: 36, height: 36 },
                  anchor: { x: 18, y: 36 },
                }}
              />
            )}

          </GoogleMap>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div className="spinner" />
          </div>
        )}
      </div>
    </div>
  );
}

function RideRequestCard({ ride, onAccept }) {
  const [accepting, setAccepting] = useState(false);

  async function handle() {
    setAccepting(true);
    await onAccept();
    setAccepting(false);
  }

  return (
    <div className="ride-request-card" style={{ marginBottom: 10 }}>
      <h3>🙋 {ride.riderName}</h3>
      <div className="ride-detail-row">
        <strong>Pickup:</strong>
        <span>
          {ride.pickupLocation?.lat?.toFixed(5)},{' '}
          {ride.pickupLocation?.lng?.toFixed(5)}
        </span>
      </div>
      <div className="ride-detail-row">
        <strong>To:</strong>
        <span>{ride.dropoffAddress}</span>
      </div>
      <div className="ride-detail-row">
        <strong>Fare:</strong>
        <span>${ride.price}</span>
      </div>
      <div className="ride-actions">
        <button className="btn btn-primary" onClick={handle} disabled={accepting}>
          {accepting ? 'Accepting…' : 'Accept ride'}
        </button>
      </div>
    </div>
  );
}

const youSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#1b4332" stroke="white" stroke-width="2"/><text x="20" y="26" font-size="18" text-anchor="middle" fill="white">🛺</text></svg>`;

const pickupSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="10" fill="#e63946" stroke="white" stroke-width="3"/><circle cx="18" cy="18" r="4" fill="white"/></svg>`;
