import { useState, useEffect, useRef } from 'react';
import { DAYBREAK_CENTER, DAYBREAK_BOUNDARY } from '../../constants/daybreak';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
} from '@react-google-maps/api';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';


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
  const [destinationPin, setDestinationPin] = useState(null);
  const [destination, setDestination] = useState('');
  const [mapMode, setMapMode] = useState('pickup'); // 'pickup' | 'destination'
  const [commonLocations, setCommonLocations] = useState([]);
  const [riderLocation, setRiderLocation] = useState(null);
  const [activeRide, setActiveRide] = useState(null);
  const [onlineDrivers, setOnlineDrivers] = useState([]);
  const [offlineAcceptingDrivers, setOfflineAcceptingDrivers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [driverEta, setDriverEta] = useState(null);
  const [mapCenter, setMapCenter] = useState(DAYBREAK_CENTER);
  const [mapInstance, setMapInstance] = useState(null);
  const mapRef = useRef(null);
  const activeRideRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const mapModeRef = useRef('pickup');

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: apiKey || '' });

  // Watch the rider's active ride (excludes 'archived' so Done is permanent)
  useEffect(() => {
    if (!userProfile?.uid) return;
    const q = query(
      collection(db, 'rides'),
      where('riderId', '==', userProfile.uid),
      where('status', 'in', ['pending', 'accepted', 'active', 'ending', 'completed']),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const ride = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (ride.status === 'ending' && activeRide?.status === 'active') {
          toast.success('Ride ended! Please pay your driver.');
        }
        if (ride.status === 'completed' && activeRide?.status !== 'completed') {
          toast.success('Thanks for riding with CartRide!');
        }
        setActiveRide(ride);
      } else {
        setActiveRide(null);
      }
    });
    return unsub;
  }, [userProfile?.uid]);

  // Keep stable refs so map click handler never goes stale
  useEffect(() => { activeRideRef.current = activeRide; }, [activeRide]);
  useEffect(() => { mapModeRef.current = mapMode; }, [mapMode]);

  // Fetch common locations for the destination dropdown
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'commonLocations'), orderBy('name')),
      (snap) => setCommonLocations(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  // Draw / clear route whenever pickup + destinationPin both exist
  useEffect(() => {
    const renderer = directionsRendererRef.current;
    if (!renderer) return;
    if (!pickup || !destinationPin) {
      renderer.setDirections({ routes: [] });
      return;
    }
    const service = new window.google.maps.DirectionsService();
    service.route({
      origin: pickup,
      destination: destinationPin,
      travelMode: window.google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (status === 'OK') {
        renderer.setDirections(result);
      } else {
        renderer.setDirections({ routes: [] });
      }
    });
  }, [pickup, destinationPin]);

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

  // Calculate driver ETA when ride is accepted and driver has a live location
  useEffect(() => {
    if (activeRide?.status !== 'accepted' || !activeRide?.pickupLocation) {
      setDriverEta(null);
      return;
    }
    const driver = onlineDrivers.find(d => d.id === activeRide.driverId);
    if (!driver?.location || !window.google?.maps?.DistanceMatrixService) return;

    const service = new window.google.maps.DistanceMatrixService();
    service.getDistanceMatrix({
      origins: [driver.location],
      destinations: [activeRide.pickupLocation],
      travelMode: window.google.maps.TravelMode.DRIVING,
    }, (response, status) => {
      if (status === 'OK') {
        const el = response.rows[0]?.elements[0];
        if (el?.status === 'OK') setDriverEta(el.duration.text);
      }
    });
  }, [activeRide?.status, activeRide?.driverId, activeRide?.pickupLocation, onlineDrivers]);

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


  async function geocodeDestination(value) {
    if (!value.trim()) return;
    const query = `${value.trim()}, South Jordan, Utah`;
    const latLng = await reverseGeocodeAddress(query);
    if (latLng) setDestinationPin(latLng);
  }

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
        dropoffLocation: destinationPin || null,
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

  // Permanently archive the completed ride and reset all local state
  async function dismissRide() {
    if (!activeRide) return;
    try {
      await updateDoc(doc(db, 'rides', activeRide.id), {
        status: 'archived',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Ignore write errors — still reset local state below
    }
    setActiveRide(null);
    setPickup(null);
    setPickupAddress(null);
    setDestination('');
    setDestinationPin(null);
    setMapMode('pickup');
  }

  const isPaymentStatus = ['ending', 'completed'].includes(activeRide?.status);
  const hasActiveRide = activeRide && !isPaymentStatus;
  const showRequestForm = !hasActiveRide && !isPaymentStatus;

  return (
    <div className="dashboard has-sidebar">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Request a Ride</h2>
          <p>Daybreak, UT · Flat rate ${RIDE_PRICE}</p>
        </div>

        <div className="sidebar-body">
          {hasActiveRide && <ActiveRidePanel ride={activeRide} onCancel={cancelRide} eta={driverEta} />}

          {isPaymentStatus && (
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
                    <div className={`map-hint ${mapMode === 'pickup' ? '' : ''}`}
                      style={{ background: mapMode === 'destination' ? '#fff3e0' : undefined, color: mapMode === 'destination' ? '#b45309' : undefined }}>
                      {mapMode === 'destination' ? '👇 Now click the map to set your destination' : '👆 Click the map to set your pickup spot'}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '-10px 0', position: 'relative', zIndex: 1 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'var(--white)', border: '2px solid var(--gray-200)',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: 'var(--gray-600)', userSelect: 'none',
                      }}>or</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={useMyLocation}>
                      📍 Use my location
                    </button>
                  </div>
                )}
              </div>

              {/* Destination */}
              <div className="form-group mb-8">
                <label>Destination</label>

                {/* Common locations dropdown */}
                {commonLocations.length > 0 && (
                  <select
                    style={{ width: '100%', marginBottom: 8, padding: '11px 14px', border: '1.5px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 15, background: 'white', color: 'var(--gray-800)' }}
                    value=""
                    onChange={e => {
                      const loc = commonLocations.find(l => l.id === e.target.value);
                      if (!loc) return;
                      setDestination(loc.name);
                      setDestinationPin(null);
                      // Geocode the address to get a pin + enable routing
                      reverseGeocodeAddress(loc.address).then(latLng => {
                        if (latLng) setDestinationPin(latLng);
                      });
                    }}
                  >
                    <option value="">📍 Quick pick a location…</option>
                    {commonLocations.map(loc => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                )}

                {/* Destination pin display or text input */}
                {destinationPin ? (
                  <div className="pickup-display">
                    <span>🏁 {destination || `${destinationPin.lat.toFixed(5)}, ${destinationPin.lng.toFixed(5)}`}</span>
                    <button onClick={() => { setDestinationPin(null); setDestination(''); setMapMode('destination'); }} title="Clear destination">✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Street or place in South Jordan…"
                      value={destination}
                      onChange={e => { setDestination(e.target.value); setDestinationPin(null); }}
                      onBlur={e => geocodeDestination(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') geocodeDestination(e.target.value); }}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                      onClick={() => setMapMode(mapMode === 'destination' ? 'pickup' : 'destination')}
                      title="Click map to set destination"
                    >
                      {mapMode === 'destination' ? '✕ Cancel' : '🗺 Pin'}
                    </button>
                  </div>
                )}
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
              directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
                suppressMarkers: true,
                polylineOptions: { strokeColor: '#2d6a4f', strokeWeight: 5, strokeOpacity: 0.75 },
                map,
              });
              // Attach click directly — reads mode + ride from refs so listener is never stale
              map.addListener('click', (e) => {
                const ride = activeRideRef.current;
                if (ride && !['ending', 'completed', 'archived'].includes(ride.status)) return;
                const loc = { lat: e.latLng.lat(), lng: e.latLng.lng() };
                if (!isInsideServiceArea(loc, DAYBREAK_BOUNDARY)) {
                  toast.error('That spot is outside the Daybreak service area.');
                  return;
                }
                const mode = mapModeRef.current;
                if (mode === 'destination') {
                  setDestinationPin(loc);
                  setDestination('');
                  reverseGeocode(loc).then(addr => { if (addr) setDestination(addr); }).catch(() => {});
                  setMapMode('pickup');
                } else {
                  setPickup(loc);
                  setPickupAddress(null);
                  reverseGeocode(loc).then(addr => setPickupAddress(addr)).catch(() => {});
                  setMapMode('destination');
                }
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

            {/* Destination pin */}
            {destinationPin && (
              <Marker
                position={destinationPin}
                title="Destination"
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(destSvg),
                  scaledSize: { width: 36, height: 44 },
                  anchor: { x: 18, y: 44 },
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

function ActiveRidePanel({ ride, onCancel, eta }) {
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
      desc: eta
        ? `${ride.driverName || 'Your driver'} is about ${eta} away.`
        : `${ride.driverName || 'Your driver'} is heading to your pickup spot.`,
      showCancel: false,
    },
    active: {
      icon: '🟢',
      title: 'Ride in progress!',
      desc: `You're on your way to ${ride.dropoffAddress || 'your destination'}.`,
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

        {/* Venmo QR code — scan to pay */}
        {ride.driverVenmoQrUrl && (
          <div style={{ marginTop: 16 }}>
            <p className="payment-label" style={{ marginBottom: 10 }}>Scan to pay with Venmo</p>
            <img
              src={ride.driverVenmoQrUrl}
              alt="Venmo QR code"
              style={{
                width: 160, height: 160, objectFit: 'contain',
                background: '#fff', borderRadius: 10, padding: 8, display: 'block', margin: '0 auto',
              }}
            />
          </div>
        )}

        {ride.driverVenmo && (
          <div style={{ marginTop: 12 }}>
            <p className="payment-label">Venmo handle</p>
            <span className="venmo-handle">{ride.driverVenmo}</span>
          </div>
        )}
        {ride.driverPaypal && (
          <div style={{ marginTop: 8 }}>
            <p className="payment-label">PayPal</p>
            <span className="venmo-handle">{ride.driverPaypal}</span>
          </div>
        )}
        {!ride.driverVenmo && !ride.driverPaypal && !ride.driverVenmoQrUrl && (
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

// Lat/lng → address string
async function reverseGeocode(latLng) {
  if (!window.google?.maps?.Geocoder) return null;
  const geocoder = new window.google.maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ location: latLng }, (results, status) => {
      resolve(status === 'OK' && results[0] ? results[0].formatted_address : null);
    });
  });
}

// Address string → {lat, lng}
async function reverseGeocodeAddress(address) {
  if (!window.google?.maps?.Geocoder) return null;
  const geocoder = new window.google.maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng() });
      } else {
        resolve(null);
      }
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

// Red destination pin
const destSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="36" height="44"><path d="M18 0C8.059 0 0 8.059 0 18c0 12.255 16.122 24.66 17.04 25.356a1.5 1.5 0 0 0 1.92 0C19.878 42.66 36 30.255 36 18 36 8.059 27.941 0 18 0z" fill="#e63946"/><circle cx="18" cy="18" r="7" fill="white"/></svg>`;

