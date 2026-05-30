# Multi-City Support Design
**Date:** 2026-05-30  
**Status:** Approved

## Overview
Expand CartRide from a single Daybreak, UT service area to support multiple cities. Launch cities: Daybreak (South Jordan, UT) and Viera (Brevard County, FL). Drivers are locked to one city selected at sign-up. Riders are auto-detected via GPS.

---

## City Registry — `src/constants/cities.js`

Single source of truth for all city configs. Each city has:
- `id` — Firestore key value (e.g. `'daybreak'`, `'viera'`)
- `name` — Short display name
- `displayName` — Full display string shown in the UI
- `center` — Default map center `{ lat, lng }`
- `boundary` — Array of `{ lat, lng }` polygon vertices
- `geocodingContext` — String appended when geocoding typed destinations (e.g. `'South Jordan, Utah'`)

`src/constants/daybreak.js` re-exports `DAYBREAK_CENTER` and `DAYBREAK_BOUNDARY` from this file for backward compatibility with any future imports.

---

## Data Model Changes

| Document | New field | Set by | Value |
|---|---|---|---|
| `drivers/{uid}` | `city` | Registration | Driver's chosen city id |
| `users/{uid}` | `city` | Registration (drivers only) | Driver's chosen city id |
| `rides/{rideId}` | `city` | Ride creation | Detected from rider GPS |

Riders do **not** have a city stored on their user doc — it is detected live from GPS each session.

---

## Registration Changes (`Register.jsx`)

**Driver-only additions (shown when role = driver):**

1. **City selector** — Card-style selector (same UI pattern as the existing rider/driver role selector). Options: Daybreak · South Jordan, UT and Viera · Viera, FL. Required for drivers.

2. **Venmo QR upload** — Inline photo upload (same component logic as ProfileModal). File is uploaded to Firebase Storage at `venmo-qr/{uid}` immediately after the Auth account is created. The download URL is stored on the `drivers/{uid}` doc.

**Validation:** Driver sign-up requires a city to be selected. Existing validation (Venmo or PayPal required) is unchanged.

**`AuthContext.register()`** receives `city` and `venmoQrFile` from the form. After creating the Auth account, it uploads the QR (if provided), then writes both Firestore docs with the `city` field and `venmoQrUrl`.

---

## Rider Dashboard Changes (`RiderDashboard.jsx`)

**City detection:**  
When GPS resolves, the app runs `isInsideServiceArea(loc, city.boundary)` against each city in `CITY_LIST`. The first match sets `activeCity`. If no city matches, `activeCity` stays `null` and the rider sees a "CartRide isn't available at your location yet" message instead of the request form.

**City-aware rendering:**
- Map center and boundary polygon use `activeCity.center` / `activeCity.boundary`
- Destination geocoding context uses `activeCity.geocodingContext`
- Ride create sets `city: activeCity.id`
- Driver list query adds `where('city', '==', activeCity.id)`

**Sidebar header** shows `activeCity.displayName` once detected (e.g. "Viera, FL · Flat rate $6").

---

## Driver Dashboard Changes (`DriverDashboard.jsx`)

- Map center and boundary polygon use `CITIES[driverDoc.city]`
- Pending rides query adds `where('city', '==', driverDoc.city)`
- Sidebar header shows the driver's city name

---

## Firestore Rules

Ride `create` rule adds:
```
&& request.resource.data.city in ['daybreak', 'viera']
```

---

## Viera Boundary Coordinates (approximate)

Placeholder coordinates covering the Viera planned community in Brevard County, FL. To be updated with precise boundary once user confirms.

Center: `{ lat: 28.2740, lng: -80.7370 }`

Boundary polygon (approximate rectangle):
- NW: `{ lat: 28.310, lng: -80.773 }`
- NE: `{ lat: 28.310, lng: -80.700 }`
- SE: `{ lat: 28.237, lng: -80.700 }`
- SW: `{ lat: 28.237, lng: -80.773 }`

---

## Files Changed

| File | Change |
|---|---|
| `src/constants/cities.js` | **New** — city registry |
| `src/constants/daybreak.js` | Re-export from cities.js |
| `src/components/auth/Register.jsx` | City selector + Venmo QR upload for drivers |
| `src/contexts/AuthContext.jsx` | Accept city + venmoQrFile, upload QR, write city field |
| `src/components/rider/RiderDashboard.jsx` | GPS city detection, city-scoped queries and config |
| `src/components/driver/DriverDashboard.jsx` | City-scoped ride query, city map config |
| `firestore.rules` | Validate city field on ride create |

---

## Out of Scope
- Per-city pricing (both cities use $6 flat rate)
- Drivers serving multiple cities
- City-specific admin dashboards
