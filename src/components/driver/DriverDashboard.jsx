import { useState, useEffect, useCallback, useRef } from 'react';
import { CITIES } from '../../constants/cities';
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
  runTransaction,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';



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
  const [sheetOpen, setSheetOpen] = useState(true);
  const watchIdRef = useRef(null);
  const mapRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const directionsRendererRef = useRef(null);
  const pickupRouteRendererRef = useRef(null);
  const touchStartY = useRef(null);

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
    const driverCity = driverDoc.city || 'daybreak';
    const q = query(
      collection(db, 'rides'),
      where('status', '==', 'pending'),
      limit(20)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter by city client-side — handles legacy rides without a city field
      const cityRides = rides.filter(r => (r.city || 'daybreak') === driverCity);
      cityRides.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setPendingRides(cityRides);
    });
    return unsub;
  }, [driverDoc?.online, driverDoc?.approved, driverDoc?.acceptingOffline, driverDoc?.city]);

  // Subscribe to the driver's active ride
  useEffect(() => {
    if (!userProfile?.uid) return;
    const q = query(
      collection(db, 'rides'),
      where('driverId', '==', userProfile.uid),
      where('status', 'in', ['accepted', 'active', 'ending']),
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
      const rideRef = doc(db, 'rides', ride.id);

      await runTransaction(db, async (transaction) => {
        const rideSnap = await transaction.get(rideRef);
        if (!rideSnap.exists()) throw new Error('gone');
        const data = rideSnap.data();
        if (data.status !== 'pending' || data.driverId !== null) throw new Error('taken');

        transaction.update(rideRef, {
          driverId: userProfile.uid,
          driverName: userProfile.name,
          driverVenmo: driverData.venmoHandle || '',
          driverPaypal: driverData.paypalHandle || '',
          driverVenmoQrUrl: driverData.venmoQrUrl || '',
          status: 'accepted',
          updatedAt: serverTimestamp(),
        });
      });

      toast.success(`Accepted ride for ${ride.riderName}!`);
    } catch (err) {
      toast.error(
        err.message === 'taken' ? 'This ride was just accepted by another driver.' :
        err.message === 'gone'  ? 'This ride no longer exists.' :
        'Could not accept this ride. Try again.'
      );
    }
  }

  async function startRide() {
    if (!activeRide) return;
    try {
      await updateDoc(doc(db, 'rides', activeRide.id), {
        status: 'active',
        updatedAt: serverTimestamp(),
      });
    } catch {
      toast.error('Could not start the ride.');
    }
  }

  async function endRide() {
    if (!activeRide) return;
    try {
      await updateDoc(doc(db, 'rides', activeRide.id), {
        status: 'ending',
        updatedAt: serverTimestamp(),
      });
    } catch {
      toast.error('Could not end the ride.');
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

  // Auto-open sheet when a new ride request arrives
  useEffect(() => {
    if (pendingRides.length > 0) setSheetOpen(true);
  }, [pendingRides.length]);

  // Auto-open sheet when driver accepts a ride or ride ends (needs action)
  useEffect(() => {
    if (activeRide?.status === 'accepted' || activeRide?.status === 'ending') {
      setSheetOpen(true);
    }
  }, [activeRide?.status]);

  function handleSheetTouchStart(e) {
    touchStartY.current = e.touches[0].clientY;
  }

  function handleSheetTouchEnd(e) {
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta > 40)  setSheetOpen(false);
    if (delta < -40) setSheetOpen(true);
    touchStartY.current = null;
  }

  const onMapLoad = useCallback((map) => { mapRef.current = map; setMapInstance(map); }, []);

  useEffect(() => {
    if (!mapInstance) return;
    const polygon = new window.google.maps.Polygon({
      paths: (CITIES[driverDoc?.city] || CITIES.daybreak).boundary,
      strokeColor: '#2d6a4f',
      strokeOpacity: 0.85,
      strokeWeight: 2.5,
      fillColor: '#2d6a4f',
      fillOpacity: 0.07,
      clickable: false,
      map: mapInstance,
    });
    // Green renderer: pickup → destination (shown during active ride)
    directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#2d6a4f', strokeWeight: 5, strokeOpacity: 0.75 },
      map: mapInstance,
    });
    // Red renderer: driver location → pickup (shown while approaching, accepted status only)
    pickupRouteRendererRef.current = new window.google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#e63946', strokeWeight: 4, strokeOpacity: 0.85 },
      map: mapInstance,
    });
    return () => { polygon.setMap(null); };
  }, [mapInstance]);

  // Red approach route: driver location → pickup, only while status is 'accepted'
  useEffect(() => {
    const renderer = pickupRouteRendererRef.current;
    if (!renderer) return;
    if (activeRide?.status !== 'accepted' || !myLocation || !activeRide?.pickupLocation) {
      renderer.setDirections({ routes: [] });
      return;
    }
    new window.google.maps.DirectionsService().route({
      origin: myLocation,
      destination: activeRide.pickupLocation,
      travelMode: window.google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (status === 'OK') renderer.setDirections(result);
      else renderer.setDirections({ routes: [] });
    });
  }, [activeRide?.status, activeRide?.pickupLocation, myLocation]);

  // Draw route and fit bounds when an active ride is present
  useEffect(() => {
    const renderer = directionsRendererRef.current;
    if (!renderer) return;
    if (!activeRide?.pickupLocation) {
      renderer.setDirections({ routes: [] });
      return;
    }
    const destination = activeRide.dropoffLocation || activeRide.dropoffAddress;
    if (!destination) return;
    new window.google.maps.DirectionsService().route({
      origin: activeRide.pickupLocation,
      destination,
      travelMode: window.google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (status === 'OK') {
        renderer.setDirections(result);
        // Fit map to show full route
        const bounds = new window.google.maps.LatLngBounds();
        result.routes[0].overview_path.forEach(p => bounds.extend(p));
        if (myLocation) bounds.extend(myLocation);
        mapRef.current?.fitBounds(bounds, 60);
      } else {
        renderer.setDirections({ routes: [] });
      }
    });
  }, [activeRide?.id, mapInstance]);

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
      <div className={`sidebar${sheetOpen ? '' : ' sheet-collapsed'}`}>
        <div
          className="sidebar-header"
          onClick={() => setSheetOpen(v => !v)}
          onTouchStart={handleSheetTouchStart}
          onTouchEnd={handleSheetTouchEnd}
        >
          <div className="sheet-handle" />
          <div className="sidebar-header-row">
            <div>
              <h2>Driver Dashboard</h2>
              <p>
                {driverDoc.online
                  ? <><span className="online-dot" style={{ marginRight: 6 }} />Online</>
                  : driverDoc.acceptingOffline
                  ? <><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f4a261', display: 'inline-block', marginRight: 6 }} />Offline — accepting</>
                  : <><span className="offline-dot" style={{ marginRight: 6 }} />Offline</>
                }
              </p>
            </div>
            {/* Quick-action button visible in collapsed header */}
            {!sheetOpen && activeRide && (
              activeRide.status === 'accepted' ? (
                <button className="btn btn-primary sheet-request-btn"
                  onClick={e => { e.stopPropagation(); startRide(); }}>
                  ▶ Start
                </button>
              ) : activeRide.status === 'active' ? (
                <button className="btn sheet-request-btn"
                  style={{ background: '#f4a261', color: '#fff' }}
                  onClick={e => { e.stopPropagation(); endRide(); }}>
                  🏁 End
                </button>
              ) : activeRide.status === 'ending' ? (
                <button className="btn btn-success sheet-request-btn"
                  onClick={e => { e.stopPropagation(); completeRide(); }}>
                  ✓ Done
                </button>
              ) : null
            )}
            {/* New ride badge in collapsed header */}
            {!sheetOpen && !activeRide && incomingRides.length > 0 && (
              <span className="notification-pill" style={{ fontSize: 13, padding: '4px 10px' }}>
                {incomingRides.length} new
              </span>
            )}
          </div>
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
                  <span>{activeRide.pickupAddress || `${activeRide.pickupLocation?.lat?.toFixed(5)}, ${activeRide.pickupLocation?.lng?.toFixed(5)}`}</span>
                </div>
                <div className="ride-detail-row">
                  <strong>Destination:</strong>
                  <span>{activeRide.dropoffAddress}</span>
                </div>
                <div className="ride-detail-row">
                  <strong>Collect:</strong>
                  <span>${activeRide.price} via Venmo/PayPal/cash</span>
                </div>
                {activeRide.status === 'ending' && (
                  <div style={{ margin: '12px 0 8px', textAlign: 'center' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 8 }}>
                      Show your rider to pay
                    </p>
                    {driverDoc.venmoQrUrl ? (
                      <img
                        src={driverDoc.venmoQrUrl}
                        alt="Venmo QR"
                        style={{
                          width: '100%', maxWidth: 220, aspectRatio: '1',
                          objectFit: 'contain', borderRadius: 10,
                          border: '1.5px solid var(--gray-200)', background: '#fff',
                          padding: 8, display: 'block', margin: '0 auto',
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 13, color: 'var(--gray-600)', padding: '8px 0' }}>
                        {driverDoc.venmoHandle && <div>Venmo: <strong>{driverDoc.venmoHandle}</strong></div>}
                        {driverDoc.paypalHandle && <div>PayPal: <strong>{driverDoc.paypalHandle}</strong></div>}
                      </div>
                    )}
                  </div>
                )}
                <div className="ride-actions">
                  {activeRide.status === 'accepted' && (
                    <button className="btn btn-primary" onClick={startRide}>
                      ▶ Start ride
                    </button>
                  )}
                  {activeRide.status === 'active' && (
                    <button className="btn btn-warning" onClick={endRide} style={{ background: '#f4a261', color: '#fff' }}>
                      🏁 End ride
                    </button>
                  )}
                  {activeRide.status === 'ending' && (
                    <button className="btn btn-success" onClick={completeRide}>
                      ✓ Mark as complete
                    </button>
                  )}
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
      <div className="map-container">
        {!apiKey || apiKey === 'your_google_maps_api_key' ? (
          <div className="map-no-key">
            <span style={{ fontSize: 40 }}>🗺️</span>
            <strong>Google Maps API key not set</strong>
            <span>Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file.</span>
          </div>
        ) : isLoaded ? (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={myLocation || (CITIES[driverDoc?.city] || CITIES.daybreak).center}
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

            {/* Rider pickup pin */}
            {activeRide?.pickupLocation && (
              <Marker
                position={activeRide.pickupLocation}
                title={`${activeRide.riderName}'s pickup`}
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pickupSvg),
                  scaledSize: { width: 36, height: 44 },
                  anchor: { x: 18, y: 44 },
                }}
              />
            )}

            {/* Destination pin */}
            {activeRide?.dropoffLocation && (
              <Marker
                position={activeRide.dropoffLocation}
                title={activeRide.dropoffAddress || 'Destination'}
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(destSvg),
                  scaledSize: { width: 36, height: 44 },
                  anchor: { x: 18, y: 44 },
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
        <span>{ride.pickupAddress || `${ride.pickupLocation?.lat?.toFixed(5)}, ${ride.pickupLocation?.lng?.toFixed(5)}`}</span>
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

// Green teardrop — rider pickup
const pickupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="36" height="44"><path d="M18 0C8.059 0 0 8.059 0 18c0 12.255 16.122 24.66 17.04 25.356a1.5 1.5 0 0 0 1.92 0C19.878 42.66 36 30.255 36 18 36 8.059 27.941 0 18 0z" fill="#2d6a4f"/><circle cx="18" cy="18" r="7" fill="white"/></svg>`;

// Red teardrop — destination
const destSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="36" height="44"><path d="M18 0C8.059 0 0 8.059 0 18c0 12.255 16.122 24.66 17.04 25.356a1.5 1.5 0 0 0 1.92 0C19.878 42.66 36 30.255 36 18 36 8.059 27.941 0 18 0z" fill="#e63946"/><circle cx="18" cy="18" r="7" fill="white"/></svg>`;
