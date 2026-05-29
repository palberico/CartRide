import { useState, useEffect, useRef } from 'react';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  InfoWindow,
} from '@react-google-maps/api';
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp,
  limit,
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
const RIDE_PRICE = 6;

export default function RiderDashboard() {
  const { userProfile } = useAuth();
  const [pickup, setPickup] = useState(null);
  const [pickupAddress, setPickupAddress] = useState(null);
  const [riderLocation, setRiderLocation] = useState(null);
  const [destination, setDestination] = useState('');
  const [activeRide, setActiveRide] = useState(null);
  const [onlineDrivers, setOnlineDrivers] = useState([]);
  const [offlineAcceptingDrivers, setOfflineAcceptingDrivers] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [mapCenter, setMapCenter] = useState(DAYBREAK_CENTER);
  const [mapInstance, setMapInstance] = useState(null);
  const mapRef = useRef(null);
  const activeRideRef = useRef(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: apiKey || '' });

  // Watch the rider's active ride (excludes 'archived' so Done is permanent)
  useEffect(() => {
    if (!userProfile?.uid) return;
    const q = query(
      collection(db, 'rides'),
      where('riderId', '==', userProfile.uid),
      where('status', 'in', ['pending', 'accepted', 'completed']),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const ride = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (ride.status === 'completed' && activeRide?.status !== 'completed') {
          toast.success('Your ride is complete! Please pay your driver.');
        }
        setActiveRide(ride);
      } else {
        setActiveRide(null);
      }
    });
    return unsub;
  }, [userProfile?.uid]);

  // Keep a stable ref so the map click handler never goes stale
  useEffect(() => { activeRideRef.current = activeRide; }, [activeRide]);

  // Center on GPS location once it resolves
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setRiderLocation(loc);
        setMapCenter(loc);
        mapRef.current?.panTo(loc);
      },
      () => {},
      { timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  // Pan to pickup when a driver accepts
  useEffect(() => {
    if (mapRef.current && activeRide?.pickupLocation) {
      mapRef.current.panTo(activeRide.pickupLocation);
    }
  }, [activeRide?.id]);

  // Watch all approved drivers, split into online vs offline-accepting
  useEffect(() => {
    const q = query(collection(db, 'drivers'), where('approved', '==', true));
    const unsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setOnlineDrivers(all.filter(d => d.online && d.location));
      setOfflineAcceptingDrivers(all.filter(d => !d.online && d.acceptingOffline));
    });
    return unsub;
  }, []);

  // Draw the Daybreak boundary polygon directly on the map instance
  useEffect(() => {
    if (!mapInstance) return;
    const polygon = new window.google.maps.Polygon({
      paths: DAYBREAK_BOUNDARY,
      strokeColor: '#2d6a4f',
      strokeOpacity: 0.85,
      strokeWeight: 2.5,
      fillColor: '#2d6a4f',
      fillOpacity: 0.07,
      clickable: false,
      map: mapInstance,
    });
    return () => polygon.setMap(null);
  }, [mapInstance]);


  async function useMyLocation() {
    if (!navigator.geolocation) return toast.error('Geolocation not supported by your browser.');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setRiderLocation(loc);
        setMapCenter(loc);
        mapRef.current?.panTo(loc);
        if (!isInsideServiceArea(loc, DAYBREAK_BOUNDARY)) {
          toast.error('Your current location is outside the Daybreak service area.');
          return;
        }
        setPickup(loc);
        setPickupAddress(null);
        const addr = await reverseGeocode(loc);
        setPickupAddress(addr);
      },
      () => toast.error('Could not get your location. Please allow location access.'),
      { timeout: 10000 }
    );
  }

  async function requestRide() {
    if (!pickup) return toast.error('Click the map to set your pickup location.');
    if (!destination.trim()) return toast.error('Please enter your destination.');
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'rides'), {
        riderId: userProfile.uid,
        riderName: userProfile.name,
        driverId: null,
        driverName: null,
        status: 'pending',
        pickupLocation: pickup,
        pickupAddress: pickupAddress || null,
        dropoffAddress: destination.trim(),
        price: RIDE_PRICE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success('Ride requested! Looking for a driver…');
      setDestination('');
      setPickupAddress(null);
    } catch {
      toast.error('Failed to request ride. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelRide() {
    if (!activeRide) return;
    try {
      await updateDoc(doc(db, 'rides', activeRide.id), {
        status: 'cancelled',
        updatedAt: serverTimestamp(),
      });
      toast('Ride cancelled.');
    } catch {
      toast.error('Could not cancel. Try again.');
    }
  }

  // Permanently archive the completed ride so it doesn't reappear on refresh
  async function dismissRide() {
    if (!activeRide) return;
    try {
      await updateDoc(doc(db, 'rides', activeRide.id), {
        status: 'archived',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Fail silently — the query will exclude it once status updates
    }
  }

  const hasActiveRide = activeRide && activeRide.status !== 'completed';
  const showRequestForm = !hasActiveRide && activeRide?.status !== 'completed';

  return (
    <div className="dashboard has-sidebar">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Request a Ride</h2>
          <p>Daybreak, UT · Flat rate ${RIDE_PRICE}</p>
        </div>

        <div className="sidebar-body">
          {hasActiveRide && <ActiveRidePanel ride={activeRide} onCancel={cancelRide} />}

          {activeRide?.status === 'completed' && (
            <CompletedRidePanel ride={activeRide} onDone={dismissRide} />
          )}

          {showRequestForm && (
            <>
              <div>
                {pickup ? (
                  <div className="pickup-display">
                    <span>📍 {pickupAddress || `${pickup.lat.toFixed(5)}, ${pickup.lng.toFixed(5)}`}</span>
                    <button onClick={() => { setPickup(null); setPickupAddress(null); }} title="Clear pickup">✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="map-hint">
                      👆 Click the map to set your pickup spot
                    </div>
                    {/* OR badge — negative margin pulls it to overlap both elements */}
                    <div style={{
                      display: 'flex', justifyContent: 'center',
                      margin: '-10px 0', position: 'relative', zIndex: 1,
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'var(--white)',
                        border: '2px solid var(--gray-200)',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: 'var(--gray-600)',
                        userSelect: 'none',
                      }}>or</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={useMyLocation}>
                      📍 Use my location
                    </button>
                  </div>
                )}
              </div>

              <div className="form-group mb-8">
                <label>Destination</label>
                <input
                  type="text"
                  placeholder="e.g. Daybreak Lake, Bees stadium…"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                />
              </div>

              <button
                className="btn btn-primary btn-lg"
                onClick={requestRide}
                disabled={submitting || !pickup || !destination.trim()}
              >
                {submitting ? 'Requesting…' : `Request Ride · $${RIDE_PRICE}`}
              </button>

              <div className="divider" />

              <div className="text-sm text-muted" style={{ marginBottom: 10 }}>
                <strong>{onlineDrivers.length + offlineAcceptingDrivers.length}</strong> driver{onlineDrivers.length + offlineAcceptingDrivers.length !== 1 ? 's' : ''} available in Daybreak
              </div>

              {(onlineDrivers.length > 0 || offlineAcceptingDrivers.length > 0) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {onlineDrivers.map(driver => (
                    <div key={driver.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: 'var(--gray-100)', borderRadius: 'var(--radius-sm)',
                      padding: '8px 12px',
                    }}>
                      <span style={{ fontSize: 22, lineHeight: 1 }}>🛺</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--gray-800)' }}>{driver.name}</div>
                        {driver.cartDescription && (
                          <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{driver.cartDescription}</div>
                        )}
                      </div>
                      <span className="online-dot" style={{ marginLeft: 'auto' }} title="Online" />
                    </div>
                  ))}

                  {offlineAcceptingDrivers.map(driver => (
                    <div key={driver.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: '#fff8f0', borderRadius: 'var(--radius-sm)',
                      padding: '8px 12px', border: '1px solid #ffe0b2',
                    }}>
                      <span style={{ fontSize: 22, lineHeight: 1 }}>🛺</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--gray-800)' }}>{driver.name}</div>
                        <div style={{ fontSize: 12, color: '#b45309' }}>Offline — may take longer to respond</div>
                      </div>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f4a261', flexShrink: 0, marginLeft: 'auto' }} title="Offline, accepting requests" />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

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
            center={mapCenter}
            zoom={14}
            options={MAP_OPTIONS}
            onLoad={(map) => {
              mapRef.current = map;
              setMapInstance(map);
              // Attach click directly to the map instance — bypasses the React wrapper
              map.addListener('click', (e) => {
                const ride = activeRideRef.current;
                if (ride && ride.status !== 'completed') return;
                const loc = { lat: e.latLng.lat(), lng: e.latLng.lng() };
                if (!isInsideServiceArea(loc, DAYBREAK_BOUNDARY)) {
                  toast.error('That spot is outside the Daybreak service area.');
                  return;
                }
                setPickup(loc);
                setPickupAddress(null);
                reverseGeocode(loc).then(addr => setPickupAddress(addr)).catch(() => {});
              });
            }}
          >
            {/* Pickup pin */}
            {pickup && (
              <Marker
                position={pickup}
                title="Your pickup"
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pickupSvg),
                  scaledSize: { width: 36, height: 36 },
                  anchor: { x: 18, y: 36 },
                }}
              />
            )}

            {/* Active ride pickup pin (no local pickup state yet) */}
            {hasActiveRide && activeRide.pickupLocation && !pickup && (
              <Marker
                position={activeRide.pickupLocation}
                title="Your pickup"
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pickupSvg),
                  scaledSize: { width: 36, height: 36 },
                  anchor: { x: 18, y: 36 },
                }}
              />
            )}

            {onlineDrivers.map(driver => driver.location && (
              <Marker
                key={driver.id}
                position={driver.location}
                title={driver.name}
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(cartSvg),
                  scaledSize: { width: 40, height: 40 },
                  anchor: { x: 20, y: 20 },
                }}
                onClick={() => setSelectedDriver(selectedDriver?.id === driver.id ? null : driver)}
              />
            ))}

            {selectedDriver && selectedDriver.location && (
              <InfoWindow
                position={selectedDriver.location}
                onCloseClick={() => setSelectedDriver(null)}
              >
                <div style={{ padding: '4px 8px', minWidth: 120 }}>
                  <strong>{selectedDriver.name}</strong>
                  <p style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                    {selectedDriver.cartDescription || 'Golf cart'}
                  </p>
                  <p style={{ fontSize: 12, color: '#2d6a4f', marginTop: 2 }}>🟢 Available</p>
                </div>
              </InfoWindow>
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

function ActiveRidePanel({ ride, onCancel }) {
  const statusConfig = {
    pending: {
      icon: '🔍',
      title: 'Looking for a driver…',
      desc: 'Hang tight, a neighbor will accept your ride shortly.',
      showCancel: true,
    },
    accepted: {
      icon: '🛺',
      title: 'Driver on the way!',
      desc: `${ride.driverName || 'Your driver'} is heading to your pickup spot.`,
      showCancel: false,
    },
  };
  const config = statusConfig[ride.status] || {};

  return (
    <div className="ride-request-card">
      <h3>{config.icon} {config.title}</h3>
      <div className="ride-detail-row">
        <strong>Pickup:</strong>
        <span>{ride.pickupAddress || `${ride.pickupLocation?.lat?.toFixed(5)}, ${ride.pickupLocation?.lng?.toFixed(5)}`}</span>
      </div>
      <div className="ride-detail-row">
        <strong>Destination:</strong>
        <span>{ride.dropoffAddress}</span>
      </div>
      <div className="ride-detail-row">
        <strong>Price:</strong>
        <span>${ride.price} cash / Venmo / PayPal</span>
      </div>
      {ride.driverName && (
        <div className="ride-detail-row">
          <strong>Driver:</strong>
          <span>{ride.driverName}</span>
        </div>
      )}
      <p className="text-sm text-muted mt-8">{config.desc}</p>
      {config.showCancel && (
        <div className="ride-actions">
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel ride</button>
        </div>
      )}
    </div>
  );
}

function CompletedRidePanel({ ride, onDone }) {
  const [loading, setLoading] = useState(false);

  async function handleDone() {
    setLoading(true);
    await onDone();
    setLoading(false);
  }

  return (
    <div>
      <div className="payment-card">
        <p className="payment-label">Pay your driver</p>
        <p className="amount">${ride.price}</p>
        {ride.driverVenmo && (
          <div>
            <p className="payment-label" style={{ marginTop: 12 }}>Venmo</p>
            <span className="venmo-handle">{ride.driverVenmo}</span>
          </div>
        )}
        {ride.driverPaypal && (
          <div>
            <p className="payment-label" style={{ marginTop: 8 }}>PayPal</p>
            <span className="venmo-handle">{ride.driverPaypal}</span>
          </div>
        )}
        {!ride.driverVenmo && !ride.driverPaypal && (
          <p style={{ marginTop: 12, fontSize: 14, opacity: 0.9 }}>
            Ask your driver for their payment handle.
          </p>
        )}
      </div>
      <button className="btn btn-primary w-full mt-12" onClick={handleDone} disabled={loading}>
        {loading ? 'Closing…' : 'Done — Request another ride'}
      </button>
    </div>
  );
}

async function reverseGeocode(latLng) {
  if (!window.google?.maps?.Geocoder) return null;
  const geocoder = new window.google.maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ location: latLng }, (results, status) => {
      resolve(status === 'OK' && results[0] ? results[0].formatted_address : null);
    });
  });
}

// Ray casting — returns true if point {lat,lng} is inside the polygon array
function isInsideServiceArea(point, polygon) {
  const { lat: px, lng: py } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { lat: xi, lng: yi } = polygon[i];
    const { lat: xj, lng: yj } = polygon[j];
    const intersects = (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const pickupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="36" height="44"><path d="M18 0C8.059 0 0 8.059 0 18c0 12.255 16.122 24.66 17.04 25.356a1.5 1.5 0 0 0 1.92 0C19.878 42.66 36 30.255 36 18 36 8.059 27.941 0 18 0z" fill="#2d6a4f"/><circle cx="18" cy="18" r="7" fill="white"/></svg>`;

const cartSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#40916c" stroke="white" stroke-width="2"/><text x="20" y="26" font-size="18" text-anchor="middle" fill="white">🛺</text></svg>`;
