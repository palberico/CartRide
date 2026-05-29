# CartRide Setup Guide

Golf cart ride-sharing for Daybreak, UT.

---

## 1. Create a Firebase project

1. Go to [firebase.google.com](https://firebase.google.com) → **Add project** → name it `cartride`
2. In the project, enable **Authentication** → **Email/Password**
3. Enable **Firestore Database** → start in **test mode** (we'll apply real rules below)

## 2. Get your Firebase config

In Firebase console → Project Settings → **Your apps** → Add a Web app → copy the config object.

## 3. Get a Google Maps API key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Maps JavaScript API**
3. Create an API key (restrict it to your domain in production)

## 4. Create your .env file

Copy `.env.example` to `.env` and fill in your values:

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=cartride-xxxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=cartride-xxxx
VITE_FIREBASE_STORAGE_BUCKET=cartride-xxxx.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123...:web:abc...
VITE_GOOGLE_MAPS_API_KEY=AIzaSy...
```

## 5. Deploy Firestore security rules

Install Firebase CLI if you haven't:
```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # choose your project, accept defaults
```

Then deploy:
```bash
firebase deploy --only firestore:rules
```

## 6. Create your admin account

1. Run the app: `npm run dev`
2. Register with your email — choose **"Request rides"** (Rider) for now
3. In the Firebase console → Firestore → `users` collection → find your document
4. **Manually change `role` to `"admin"`**

That's it — you're now the admin. The Firestore security rules prevent role changes through the app UI.

## 7. Run the app

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## User flows

### Rider
1. Register → choose "Request rides"
2. Click the map to drop a pickup pin
3. Type a destination (e.g. "Daybreak Lake")
4. Hit **Request Ride · $6**
5. Wait for a driver to accept
6. When the ride completes, pay the driver $6 via Venmo/PayPal

### Driver
1. Register → choose "Drive neighbors" → enter cart description + Venmo/PayPal handle
2. Wait for admin approval (you'll see a pending screen until approved)
3. Toggle **Online** to start accepting rides
4. Accept incoming ride requests — rider's pickup appears on your map
5. Drive there, complete the ride, collect $6

### Admin (you)
1. Go to `/admin` — you'll see the Driver Management page
2. Approve or reject driver applications as they come in
3. Approved drivers can immediately go online

---

## Deploying to production

```bash
npm run build
firebase deploy --only hosting   # or deploy dist/ to Vercel/Netlify
```


The polygone is visible, but it is around Herriman again. Use the streets I sent you to draw the boundary. 

NW	Bingham Rim Rd & Bacchus Hwy
NE	Bingham Rim Rd & 4000 W
SE	11800 S & 4000 W
SW	11800 S & Bacchus Hwy
