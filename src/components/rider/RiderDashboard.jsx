import { useState, useEffect, useRef, useCallback } from 'react';
import { CITIES, CITY_LIST } from '../../constants/cities';
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
  const [driverLocation, setDriverLocation] = useState(null);
  const [activeCity, setActiveCity] = useState(CITIES.daybreak); // default until GPS resolves
  const [mapCenter, setMapCenter] = useState(CITIES.daybreak.center);
  const [mapInstance, setMapInstance] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const mapRef = useRef(null);
  const activeRideRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const mapModeRef = useRef('pickup');
  const activeCityRef = useRef(CITIES.daybreak);
  const arrivedAlertShownRef = useRef(false);
  const touchStartY = useRef(null);

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
  useEffect(() => { activeCityRef.current = activeCity; }, [activeCity]);

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

  // Center on GPS location and detect city once it resolves
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setRiderLocation(loc);
        setMapCenter(loc);
        mapRef.current?.panTo(loc);
        // Detect which city the rider is in
        const detected = CITY_LIST.find(c => isInsideServiceArea(loc, c.boundary));
        if (detected) setActiveCity(detected);
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

  // Watch approved drivers, filter by city client-side so legacy drivers
  // without a city field (defaulting to 'daybreak') are included
  useEffect(() => {
    const q = query(collection(db, 'drivers'), where('approved', '==', true));
    const unsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const cityDrivers = all.filter(d => (d.city || 'daybreak') === activeCity.id);
      setOnlineDrivers(cityDrivers.filter(d => d.online && d.location));
      setOfflineAcceptingDrivers(cityDrivers.filter(d => !d.online && d.acceptingOffline));
    });
    return unsub;
  }, [activeCity.id]);

  // Subscribe directly to the accepted driver's doc for live location updates
  useEffect(() => {
    if (!activeRide?.driverId || activeRide.status === 'pending') {
      setDriverLocation(null);
      return;
    }
    const unsub = onSnapshot(doc(db, 'drivers', activeRide.driverId), (snap) => {
      setDriverLocation(snap.exists() ? (snap.data().location || null) : null);
    });
    return unsub;
  }, [activeRide?.driverId, activeRide?.status]);

  // Recalculate ETA whenever driver location updates (accepted status only)
  useEffect(() => {
    if (activeRide?.status !== 'accepted' || !activeRide?.pickupLocation || !driverLocation) {
      setDriverEta(null);
      return;
    }
    if (!window.google?.maps?.DistanceMatrixService) return;
    const service = new window.google.maps.DistanceMatrixService();
    service.getDistanceMatrix({
      origins: [driverLocation],
      destinations: [activeRide.pickupLocation],
      travelMode: window.google.maps.TravelMode.DRIVING,
    }, (response, status) => {
      if (status === 'OK') {
        const el = response.rows[0]?.elements[0];
        if (el?.status === 'OK') setDriverEta(el.duration.text);
      }
    });
  }, [activeRide?.status, activeRide?.pickupLocation, driverLocation]);


  // Open the sheet when the driver ends the ride so payment info is immediately visible
  useEffect(() => {
    if (activeRide?.status === 'ending') setSheetOpen(true);
  }, [activeRide?.status]);

  // Reset arrived flag whenever a new ride starts
  useEffect(() => { arrivedAlertShownRef.current = false; }, [activeRide?.id]);

  // Request Web Notification permission as soon as a driver accepts
  useEffect(() => {
    if (activeRide?.status === 'accepted' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [activeRide?.status]);

  // Fire arrival alert when driver is within 500 ft (~152 m) of pickup
  useEffect(() => {
    if (
      activeRide?.status !== 'accepted' ||
      !driverLocation ||
      !activeRide?.pickupLocation ||
      arrivedAlertShownRef.current
    ) return;

    const meters = haversineDistance(driverLocation, activeRide.pickupLocation);
    if (meters > 152) return;

    arrivedAlertShownRef.current = true;

    toast('🛺 Your driver has arrived!', {
      duration: 10000,
      style: {
        background: '#1b4332',
        color: '#fff',
        fontWeight: 700,
        fontSize: 16,
        padding: '16px 20px',
      },
    });

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Your driver has arrived! 🛺', {
        body: `${activeRide.driverName || 'Your driver'} is at your pickup location.`,
        icon: '/CartRide/cart-icon.svg',
      });
    }
  }, [driverLocation, activeRide?.status, activeRide?.pickupLocation, activeRide?.id]);

  // Draw city boundary polygon — redraws when city changes
  useEffect(() => {
    if (!mapInstance) return;
    const polygon = new window.google.maps.Polygon({
      paths: activeCity.boundary,
      strokeColor: '#2d6a4f',
      strokeOpacity: 0.85,
      strokeWeight: 2.5,
      fillColor: '#2d6a4f',
      fillOpacity: 0.07,
      clickable: false,
      map: mapInstance,
    });
    return () => polygon.setMap(null);
  }, [mapInstance, activeCity.id]);


  async function geocodeDestination(value) {
    if (!value.trim()) return;
    const q = `${value.trim()}, ${activeCity.geocodingContext}`;
    const latLng = await reverseGeocodeAddress(q);
    if (latLng) {
      setDestinationPin(latLng);
      if (window.innerWidth <= 768) setSheetOpen(false);
    }
  }

  async function useMyLocation() {
    if (!navigator.geolocation) return toast.error('Geolocation not supported by your browser.');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setRiderLocation(loc);
        setMapCenter(loc);
        mapRef.current?.panTo(loc);
        // Detect city from new location
        const detected = CITY_LIST.find(c => isInsideServiceArea(loc, c.boundary));
        if (!detected) {
          toast.error('Your current location is outside all CartRide service areas.');
          return;
        }
        setActiveCity(detected);
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
        city: activeCity.id,
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

  const handleSheetTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleSheetTouchEnd = useCallback((e) => {
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta > 40)  setSheetOpen(false); // swipe down → collapse
    if (delta < -40) setSheetOpen(true);  // swipe up → expand
    touchStartY.current = null;
  }, []);

  const isPaymentStatus = ['ending', 'completed'].includes(activeRide?.status);
  const hasActiveRide = activeRide && !isPaymentStatus;
  const showRequestForm = !hasActiveRide && !isPaymentStatus;

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
              <h2>Request a Ride</h2>
              <p>{activeCity.displayName} · Flat rate ${RIDE_PRICE}</p>
            </div>
            {/* Inline action button in collapsed header */}
            {!sheetOpen && (
              hasActiveRide && activeRide?.status === 'pending' ? (
                <button
                  className="btn btn-secondary sheet-request-btn"
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  onClick={e => { e.stopPropagation(); cancelRide(); }}
                >
                  Cancel ride
                </button>
              ) : pickup && destination.trim() && showRequestForm ? (
                <button
                  className="btn btn-primary sheet-request-btn"
                  onClick={e => { e.stopPropagation(); requestRide(); }}
                  disabled={submitting}
                >
                  {submitting ? '…' : `Ride · $${RIDE_PRICE}`}
                </button>
              ) : null
            )}
          </div>
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
                    <div
                      className="map-hint"
                      style={{
                        background: mapMode === 'destination' ? '#fff3e0' : undefined,
                        color: mapMode === 'destination' ? '#b45309' : undefined,
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        if (window.innerWidth <= 768) setSheetOpen(false);
                      }}
                    >
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
                      reverseGeocodeAddress(loc.address).then(latLng => {
                        if (latLng) {
                          setDestinationPin(latLng);
                          if (window.innerWidth <= 768) setSheetOpen(false);
                        }
                      });
                    }}
                  >
                    <option value="">📍 Quick pick a location…</option>
                    {commonLocations.map(loc => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                )}

                {/* Map tap button — always green, no toggle */}
                {!destinationPin && (
                  <>
                    <div
                      className="map-hint"
                      style={{ cursor: 'pointer', marginBottom: 0 }}
                      onClick={() => {
                        setMapMode('destination');
                        if (window.innerWidth <= 768) setSheetOpen(false);
                      }}
                    >
                      🗺 Click the map to set destination
                    </div>

                    {/* "or" divider */}
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '-10px 0', position: 'relative', zIndex: 1 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'var(--white)', border: '2px solid var(--gray-200)',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: 'var(--gray-600)', userSelect: 'none',
                      }}>or</div>
                    </div>
                  </>
                )}

                {/* Destination display or text input */}
                {destinationPin ? (
                  <div className="pickup-display">
                    <span>🏁 {destination || `${destinationPin.lat.toFixed(5)}, ${destinationPin.lng.toFixed(5)}`}</span>
                    <button onClick={() => { setDestinationPin(null); setDestination(''); setMapMode('pickup'); }} title="Clear destination">✕</button>
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="Street or place in South Jordan…"
                    value={destination}
                    onChange={e => { setDestination(e.target.value); setDestinationPin(null); }}
                    onBlur={e => geocodeDestination(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') geocodeDestination(e.target.value); }}
                  />
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
                const city = activeCityRef.current;
                if (!isInsideServiceArea(loc, city.boundary)) {
                  toast.error(`That spot is outside the ${city.name} service area.`);
                  return;
                }
                const mode = mapModeRef.current;
                if (mode === 'destination') {
                  setDestinationPin(loc);
                  setDestination('');
                  reverseGeocode(loc).then(addr => { if (addr) setDestination(addr); }).catch(() => {});
                  setMapMode('pickup');
                  // Destination set on mobile — close sheet, show Request button in header
                  if (window.innerWidth <= 768) setSheetOpen(false);
                } else {
                  setPickup(loc);
                  setPickupAddress(null);
                  reverseGeocode(loc).then(addr => setPickupAddress(addr)).catch(() => {});
                  setMapMode('destination');
                  // Pickup set on mobile — open sheet so rider can enter destination
                  if (window.innerWidth <= 768) setSheetOpen(true);
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

            {/* Driver cart icon — visible while driver is approaching (accepted status) */}
            {activeRide?.status === 'accepted' && driverLocation && (
              <Marker
                position={driverLocation}
                title={activeRide.driverName || 'Your driver'}
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(cartSvg),
                  scaledSize: { width: 44, height: 44 },
                  anchor: { x: 22, y: 22 },
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
      desc: `${ride.driverName || 'Your driver'} is heading to your pickup spot.`,
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
      {ride.status === 'accepted' && (
        <div className="ride-detail-row">
          <strong>ETA:</strong>
          <span style={{ color: 'var(--green-mid)', fontWeight: 600 }}>
            {eta ? `~${eta}` : 'Calculating…'}
          </span>
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

// Haversine distance between two {lat,lng} points, returns meters
function haversineDistance(a, b) {
  const R = 6371000;
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

const cartSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="44" height="44"><circle cx="22" cy="22" r="20" fill="#40916c" stroke="white" stroke-width="2"/><text x="22" y="29" font-size="20" text-anchor="middle" fill="white">🛺</text></svg>`;

// Red destination pin
const destSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="36" height="44"><path d="M18 0C8.059 0 0 8.059 0 18c0 12.255 16.122 24.66 17.04 25.356a1.5 1.5 0 0 0 1.92 0C19.878 42.66 36 30.255 36 18 36 8.059 27.941 0 18 0z" fill="#e63946"/><circle cx="18" cy="18" r="7" fill="white"/></svg>`;

