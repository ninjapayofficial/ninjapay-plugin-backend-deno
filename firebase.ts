// firebase.js

// Firebase Admin SDK for Deno
// import { initializeApp, cert, ServiceAccount } from "https://esm.sh/firebase-admin@11.5.0/app";
// import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
// import { getFirestore } from "https://www.gstatic.com/firebasejs/9.18.0/firebase-firestore.js";
// import { initializeApp, cert, getAuth, getFirestore } from "https://deno.land/x/firebase_adminsdk@v0.5.0/mod.ts";
// import firebase from "https://esm.sh/firebase@9.17.0/app";
import admin from "npm:firebase-admin@12.7.0";
import { config } from "npm:dotenv";
// Load environment variables from .env
config();
import { ServiceAccount } from "https://esm.sh/firebase-admin@11.5.0/app";
import serviceAccount from "./ninjapay-plugin-backend-dev-firebase-adminsdk-oiyn8-3f93833a6b.json" with {
  type: "json",
}; // Replace with the path to your service account key

// const serviceAccount = {
//   projectId: Deno.env.get("FIREBASE_PROJECT_ID"),
//   clientEmail: Deno.env.get("FIREBASE_CLIENT_EMAIL"),
//   privateKey: Deno.env.get("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
// };
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as ServiceAccount),
});

// // Export auth and firestore instances
// const auth = admin.auth();
// const db = admin.firestore();

export default admin;

// auth,
// firestore: db,
