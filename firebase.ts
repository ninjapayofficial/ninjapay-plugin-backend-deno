// firebase.js
import admin from 'firebase-admin';
import { config } from "dotenv";
// Load environment variables from .env
config();
import { ServiceAccount } from "https://esm.sh/firebase-admin@11.5.0/app";
import serviceAccount from './ninjapay-plugin-backend-dev-firebase-adminsdk-oiyn8-3f93833a6b.json' with { type: "json" }; // Replace with the path to your service account key

// const serviceAccount = {
//   projectId: Deno.env.get("FIREBASE_PROJECT_ID"),
//   clientEmail: Deno.env.get("FIREBASE_CLIENT_EMAIL"),
//   privateKey: Deno.env.get("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
// };
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as ServiceAccount),
});

export default admin;
