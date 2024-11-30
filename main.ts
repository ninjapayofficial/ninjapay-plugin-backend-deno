// main.ts
const _encoder = new TextEncoder();
const decoder = new TextDecoder();

import { serve } from "https://deno.land/std@0.185.0/http/server.ts";
import { renderFileToString } from "https://deno.land/x/dejs@0.10.3/mod.ts";
import { exists } from "https://deno.land/std@0.185.0/fs/mod.ts";
import { config } from "npm:dotenv@16.3.1";
import {
  deleteCookie,
  getCookies,
  setCookie,
} from "https://deno.land/std@0.224.0/http/cookie.ts";

import admin from "./firebase.ts";
// import auth from "./firebase.ts";
// import db from "./firebase.ts";
import { LNbitsPaymentService } from "./services/lnbitsPaymentService.ts";
import { OpenNodePaymentService } from "./services/opennodePaymentService.ts";

// Load environment variables from .env
config();

const auth = admin.auth();
const db = admin.firestore();

// Helper function to extract repository name from Git URL
function getRepoName(gitUrl: string): string {
  const match = gitUrl.match(/\/([^\/]+?)(?:\.git)?$/);
  if (match) {
    return match[1];
  } else {
    throw new Error("Invalid Git URL");
  }
}

// Generate provider keys
function generateProviderKey(prefix: string): string {
  const randomString = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `${prefix}${randomString}`;
}

// Verify Firebase ID Token
async function verifyIdToken(token: string): Promise<{ uid: string }> {
  const decodedToken = await auth.verifyIdToken(token);
  return { uid: decodedToken.uid };
}

// Function to handle HTTP requests
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Parse cookies from the request
  const cookies = getCookies(req.headers);
  const token = cookies.token;

  // Define protected routes
  const protectedRoutes = [
    "/",
    "/install",
    "/funding",
    "/add-funding",
    "/add-funding/lnbits",
    "/add-funding/opennode",
    "/set-default-provider",
    "/createPayLink",
    "/balance",
    "/payInvoice",
    "/transactions",
    "/checkStatus",
  ];

  // Initialize UID
  let uid = "";

  if (protectedRoutes.includes(pathname)) {
    // Check if the user is authenticated
    if (!token) {
      // Redirect to login page
      const redirectUrl = new URL("/login", req.url).toString();
      return Response.redirect(redirectUrl, 302);
    } else {
      // Verify token and get UID
      try {
        const decoded = await verifyIdToken(token);
        uid = decoded.uid;
      } catch (e) {
        console.error("Error verifying token:", e);
        // Redirect to login page
        const redirectUrl = new URL("/login", req.url).toString();
        return Response.redirect(redirectUrl, 302);
      }
    }
  }

  // Routing
  if (req.method === "GET" && pathname === "/") {
    // Serve the main page with plugins
    const pluginsDir = "./plugins";
    const plugins: string[] = [];

    try {
      for await (const dirEntry of Deno.readDir(pluginsDir)) {
        if (dirEntry.isDirectory) {
          plugins.push(dirEntry.name);
        }
      }
    } catch (e: unknown) {
      if (e instanceof Deno.errors.NotFound) {
        await Deno.mkdir(pluginsDir);
      } else {
        console.error("Error reading plugins directory:", e);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    const body = await renderFileToString(`${Deno.cwd()}/views/index.ejs`, {
      plugins,
    });

    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/install") {
    // Handle plugin installation
    const formData = await req.formData();
    const gitUrl = formData.get("gitUrl")?.toString();

    if (!gitUrl) {
      return new Response("Git URL is required", { status: 400 });
    }

    let repoName;
    try {
      repoName = getRepoName(gitUrl);
    } catch (e: unknown) {
      return new Response(`Invalid Git URL: ${e}`, { status: 400 });
    }

    const pluginsDir = "./plugins";
    const pluginPath = `${pluginsDir}/${repoName}`;

    try {
      // Check if the plugin directory already exists
      if (await exists(pluginPath)) {
        // Remove the existing directory
        await Deno.remove(pluginPath, { recursive: true });
      }

      // Use Deno.Command to clone the repository
      const gitCloneCommand = new Deno.Command("git", {
        args: ["clone", gitUrl, pluginPath],
        stdout: "null",
        stderr: "piped",
      });

      const { code, stderr } = await gitCloneCommand.output();
      const errorString = decoder.decode(stderr);

      if (code !== 0) {
        return new Response(`Failed to clone repository: ${errorString}`, {
          status: 500,
        });
      }

      // Run migrations if migrate.ts exists
      const migrateFile = `${pluginPath}/migrate.ts`;
      if (await exists(migrateFile)) {
        // Use Deno.Command to run the migration script
        const denoRunCommand = new Deno.Command("deno", {
          args: ["run", "--allow-read", "--allow-write", migrateFile],
          stdout: "null",
          stderr: "piped",
        });

        const { code: denoRunCode, stderr: denoRunStderr } =
          await denoRunCommand.output();
        const denoRunErrorString = decoder.decode(denoRunStderr);

        if (denoRunCode !== 0) {
          console.error("Error running migrations:", denoRunErrorString);
          // Optionally, you can return a response indicating the migration failed
        }
      } else {
        console.warn(`Migration file not found at ${migrateFile}`);
      }

      // Redirect back to the main page
      const redirectUrl = new URL("/", req.url).toString();
      return Response.redirect(redirectUrl, 303);
    } catch (e: unknown) {
      console.error("Error installing plugin:", e);
      return new Response(`Failed to install plugin: ${e}`, {
        status: 500,
      });
    }
  } else if (req.method === "GET" && pathname === "/signup") {
    // Serve the signup page
    const body = await renderFileToString(`${Deno.cwd()}/views/signup.ejs`, {});
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/signup") {
    // Handle user signup
    const formData = await req.formData();
    const email = formData.get("email")?.toString();
    const password = formData.get("password")?.toString();

    if (!email || !password) {
      return new Response("Email and password are required", { status: 400 });
    }

    // Firebase Signup API Endpoint
    const apiKey = Deno.env.get("API_KEY");
    const signUpUrl =
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;

    try {
      const response = await fetch(signUpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return new Response(`Signup failed: ${data.error.message}`, {
          status: 400,
        });
      }

      // Set auth token in cookies
      const headers = new Headers();
      setCookie(headers, {
        name: "token",
        value: data.idToken,
        httpOnly: true,
        sameSite: "Lax",
      });

      // Redirect to main page
      const redirectUrl = new URL("/", req.url).toString();
      headers.set("Location", redirectUrl);
      return new Response(null, {
        status: 302,
        headers,
      });
    } catch (e: unknown) {
      console.error("Error during signup:", e);
      return new Response(`Failed to signup: ${e}`, { status: 500 });
    }
  } else if (req.method === "GET" && pathname === "/login") {
    // Serve the login page
    const body = await renderFileToString(`${Deno.cwd()}/views/login.ejs`, {});
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/login") {
    // Handle user login
    const formData = await req.formData();
    const email = formData.get("email")?.toString();
    const password = formData.get("password")?.toString();

    if (!email || !password) {
      return new Response("Email and password are required", { status: 400 });
    }

    // Firebase Login API Endpoint
    const apiKey = Deno.env.get("API_KEY");
    const signInUrl =
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

    try {
      const response = await fetch(signInUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return new Response(`Login failed: ${data.error.message}`, {
          status: 400,
        });
      }

      // Set auth token in cookies
      const headers = new Headers();
      setCookie(headers, {
        name: "token",
        value: data.idToken,
        httpOnly: true,
        sameSite: "Lax",
      });

      // Redirect to main page
      const redirectUrl = new URL("/", req.url).toString();
      headers.set("Location", redirectUrl);
      return new Response(null, {
        status: 302,
        headers,
      });
    } catch (e: unknown) {
      console.error("Error during login:", e);
      return new Response(`Failed to login: ${e}`, { status: 500 });
    }
  } else if (req.method === "GET" && pathname === "/logout") {
    // Handle user logout
    const headers = new Headers();
    deleteCookie(headers, "token");
    const redirectUrl = new URL("/login", req.url).toString();
    headers.set("Location", redirectUrl);
    return new Response(null, {
      status: 302,
      headers,
    });
  } else if (req.method === "GET" && pathname === "/funding") {
    // Serve the funding page
    try {
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const fundingProviders = userData?.fundingProviders || [];
      const defaultProvider = userData?.defaultProvider || "";

      const body = await renderFileToString(`${Deno.cwd()}/views/funding.ejs`, {
        fundingProviders,
        defaultProvider,
      });

      return new Response(body, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e: unknown) {
      console.error("Error fetching funding providers:", e);
      return new Response("Internal Server Error", { status: 500 });
    }
  } else if (req.method === "GET" && pathname === "/add-funding") {
    // Show options to select a provider
    const body = await renderFileToString(
      `${Deno.cwd()}/views/add_funding.ejs`,
      {},
    );
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/add-funding") {
    // Handle selection of provider
    const formData = await req.formData();
    const provider = formData.get("provider")?.toString();

    if (provider === "lnbits") {
      // Redirect to LNbits setup
      const redirectUrl = new URL("/add-funding/lnbits", req.url).toString();
      return Response.redirect(redirectUrl, 302);
    } else if (provider === "opennode") {
      // Redirect to OpenNode setup
      const redirectUrl = new URL("/add-funding/opennode", req.url).toString();
      return Response.redirect(redirectUrl, 302);
    } else {
      return new Response("Invalid provider selected", { status: 400 });
    }
  } else if (req.method === "GET" && pathname === "/add-funding/lnbits") {
    // Show LNbits setup form
    const body = await renderFileToString(
      `${Deno.cwd()}/views/add_lnbits.ejs`,
      {},
    );
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/add-funding/lnbits") {
    // Handle LNbits provider data submission
    const formData = await req.formData();
    const instanceUrl = formData.get("instanceUrl")?.toString();
    const invoiceKey = formData.get("invoiceKey")?.toString();
    const adminKey = formData.get("adminKey")?.toString();

    if (!instanceUrl || !invoiceKey || !adminKey) {
      return new Response("All fields are required", { status: 400 });
    }

    // Generate provider keys
    const providerInvoiceKey = generateProviderKey("p_ik_");
    const providerAdminKey = generateProviderKey("p_ak_");

    // Save to Firestore by appending to fundingProviders array
    try {
      const userDocRef = db.collection("users").doc(uid);
      const userDoc = await userDocRef.get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const fundingProviders = userData?.fundingProviders || [];

      // Append new provider
      fundingProviders.push({
        provider: "lnbits",
        instanceUrl,
        invoiceKey,
        adminKey,
        providerInvoiceKey,
        providerAdminKey,
      });

      // Update Firestore
      await userDocRef.set({
        fundingProviders,
      }, { merge: true });

      // If this is the first provider, set as default
      if (fundingProviders.length === 1) {
        await userDocRef.set({
          defaultProvider: "lnbits",
        }, { merge: true });
      }

      // Redirect to funding page
      const redirectUrl = new URL("/funding", req.url).toString();
      return Response.redirect(redirectUrl, 302);
    } catch (e: unknown) {
      console.error("Error saving LNbits provider:", e);
      return new Response("Failed to add LNbits provider", { status: 500 });
    }
  } else if (req.method === "GET" && pathname === "/add-funding/opennode") {
    // Show OpenNode setup form
    const body = await renderFileToString(
      `${Deno.cwd()}/views/add_opennode.ejs`,
      {},
    );
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/add-funding/opennode") {
    // Handle OpenNode provider data submission
    const formData = await req.formData();
    const invoiceKey = formData.get("invoiceKey")?.toString();
    const readApiKey = formData.get("readApiKey")?.toString();

    if (!invoiceKey || !readApiKey) {
      return new Response("All fields are required", { status: 400 });
    }

    // Generate provider keys
    const providerInvoiceKey = generateProviderKey("p_ik_");
    const providerAdminKey = generateProviderKey("p_ak_");

    // Save to Firestore by appending to fundingProviders array
    try {
      const userDocRef = db.collection("users").doc(uid);
      const userDoc = await userDocRef.get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const fundingProviders = userData?.fundingProviders || [];

      // Append new provider
      fundingProviders.push({
        provider: "opennode",
        invoiceKey,
        readApiKey,
        providerInvoiceKey,
        providerAdminKey,
      });

      // Update Firestore
      await userDocRef.set({
        fundingProviders,
      }, { merge: true });

      // If this is the first provider, set as default
      if (fundingProviders.length === 1) {
        await userDocRef.set({
          defaultProvider: "opennode",
        }, { merge: true });
      }

      // Redirect to funding page
      const redirectUrl = new URL("/funding", req.url).toString();
      return Response.redirect(redirectUrl, 302);
    } catch (e: unknown) {
      console.error("Error saving OpenNode provider:", e);
      return new Response("Failed to add OpenNode provider", { status: 500 });
    }
  } else if (req.method === "POST" && pathname === "/set-default-provider") {
    // Handle setting a default provider
    const formData = await req.formData();
    const providerIndexStr = formData.get("providerIndex")?.toString();
    const providerIndex = Number(providerIndexStr);

    if (isNaN(providerIndex)) {
      return new Response("Invalid provider index", { status: 400 });
    }

    try {
      const userDocRef = db.collection("users").doc(uid);
      const userDoc = await userDocRef.get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const fundingProviders = userData?.fundingProviders || [];

      if (providerIndex < 0 || providerIndex >= fundingProviders.length) {
        return new Response("Provider index out of range", { status: 400 });
      }

      const selectedProvider = fundingProviders[providerIndex].provider;

      // Update default provider in Firestore
      await userDocRef.set({
        defaultProvider: selectedProvider,
      }, { merge: true });

      // Redirect back to funding page
      const redirectUrl = new URL("/funding", req.url).toString();
      return Response.redirect(redirectUrl, 302);
    } catch (e: unknown) {
      console.error("Error setting default provider:", e);
      return new Response("Failed to set default provider", { status: 500 });
    }
  }

  // Payment Endpoints
  else if (req.method === "POST" && pathname === "/createPayLink") {
    return await handleCreatePayLink(req, uid);
  } else if (req.method === "GET" && pathname === "/balance") {
    return await handleGetBalance(req, uid);
  } else if (req.method === "POST" && pathname === "/payInvoice") {
    return await handlePayInvoice(req, uid);
  } else if (req.method === "GET" && pathname === "/transactions") {
    return await handleGetTransactions(req, uid);
  } else if (req.method === "GET" && pathname === "/checkStatus") {
    return await handleCheckStatus(req, uid);
  } else {
    return new Response("Not Found", { status: 404 });
  }
}

// Payment Handlers

async function handleCreatePayLink(req: Request, uid: string): Promise<Response> {
  try {
    const formData = await req.formData();
    const amountStr = formData.get("amount")?.toString();
    const memo = formData.get("memo")?.toString() || "";

    const amount = parseFloat(amountStr || "0");
    if (isNaN(amount) || amount <= 0) {
      return new Response("Invalid amount", { status: 400 });
    }

    // Fetch user's default provider
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const defaultProvider = userData?.defaultProvider;
    const fundingProviders = userData?.fundingProviders || [];

    if (!defaultProvider) {
      return new Response("No default provider set", { status: 400 });
    }

    // Find the default provider details
    const provider = fundingProviders.find(
      (p: any) => p.provider === defaultProvider,
    );

    if (!provider) {
      return new Response("Default provider not found", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (defaultProvider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
    } else if (defaultProvider === "opennode") {
      paymentService = new OpenNodePaymentService(provider);
    } else {
      return new Response("Unsupported provider", { status: 400 });
    }

    // Create payment link
    const payLink = await paymentService.createPayLink(amount, memo);

    return new Response(JSON.stringify(payLink), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e: unknown) {
    console.error("Error creating payment link:", e);
    return new Response("Failed to create payment link", { status: 500 });
  }
}

async function handleGetBalance(req: Request, uid: string): Promise<Response> {
  try {
    // Fetch user's default provider
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const defaultProvider = userData?.defaultProvider;
    const fundingProviders = userData?.fundingProviders || [];

    if (!defaultProvider) {
      return new Response("No default provider set", { status: 400 });
    }

    // Find the default provider details
    const provider = fundingProviders.find(
      (p: any) => p.provider === defaultProvider,
    );

    if (!provider) {
      return new Response("Default provider not found", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (defaultProvider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
    } else if (defaultProvider === "opennode") {
      paymentService = new OpenNodePaymentService(provider);
    } else {
      return new Response("Unsupported provider", { status: 400 });
    }

    // Get balance
    const balance = await paymentService.getBalance();

    return new Response(JSON.stringify(balance), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e: unknown) {
    console.error("Error fetching balance:", e);
    return new Response("Failed to fetch balance", { status: 500 });
  }
}

async function handlePayInvoice(req: Request, uid: string): Promise<Response> {
  try {
    const formData = await req.formData();
    const paymentRequest = formData.get("paymentRequest")?.toString();

    if (!paymentRequest) {
      return new Response("Payment request is required", { status: 400 });
    }

    // Fetch user's default provider
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const defaultProvider = userData?.defaultProvider;
    const fundingProviders = userData?.fundingProviders || [];

    if (!defaultProvider) {
      return new Response("No default provider set", { status: 400 });
    }

    // Find the default provider details
    const provider = fundingProviders.find(
      (p: any) => p.provider === defaultProvider,
    );

    if (!provider) {
      return new Response("Default provider not found", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (defaultProvider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
    } else if (defaultProvider === "opennode") {
      paymentService = new OpenNodePaymentService(provider);
    } else {
      return new Response("Unsupported provider", { status: 400 });
    }

    // Pay the invoice
    const payResponse = await paymentService.payInvoice(paymentRequest);

    return new Response(JSON.stringify(payResponse), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e: unknown) {
    console.error("Error paying invoice:", e);
    return new Response("Failed to pay invoice", { status: 500 });
  }
}

async function handleGetTransactions(req: Request, uid: string): Promise<Response> {
  try {
    // Fetch user's default provider
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const defaultProvider = userData?.defaultProvider;
    const fundingProviders = userData?.fundingProviders || [];

    if (!defaultProvider) {
      return new Response("No default provider set", { status: 400 });
    }

    // Find the default provider details
    const provider = fundingProviders.find(
      (p: any) => p.provider === defaultProvider,
    );

    if (!provider) {
      return new Response("Default provider not found", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (defaultProvider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
    } else if (defaultProvider === "opennode") {
      paymentService = new OpenNodePaymentService(provider);
    } else {
      return new Response("Unsupported provider", { status: 400 });
    }

    // Get transactions
    const transactions = await paymentService.getTransactions();

    return new Response(JSON.stringify(transactions), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e: unknown) {
    console.error("Error fetching transactions:", e);
    return new Response("Failed to fetch transactions", { status: 500 });
  }
}

async function handleCheckStatus(req: Request, uid: string): Promise<Response> {
  try {
    const url = new URL(req.url);
    const chargeId = url.searchParams.get("chargeId");

    if (!chargeId) {
      return new Response("chargeId query parameter is required", { status: 400 });
    }

    // Fetch user's default provider
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const defaultProvider = userData?.defaultProvider;
    const fundingProviders = userData?.fundingProviders || [];

    if (!defaultProvider) {
      return new Response("No default provider set", { status: 400 });
    }

    // Find the default provider details
    const provider = fundingProviders.find(
      (p: any) => p.provider === defaultProvider,
    );

    if (!provider) {
      return new Response("Default provider not found", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (defaultProvider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
    } else if (defaultProvider === "opennode") {
      paymentService = new OpenNodePaymentService(provider);
    } else {
      return new Response("Unsupported provider", { status: 400 });
    }

    // Check payment status
    let status: string = '';
    if (defaultProvider === "lnbits") {
      status = await paymentService.checkStatus(chargeId);
    } else if (defaultProvider === "opennode") {
      status = await paymentService.checkStatus(chargeId);
    }

    return new Response(JSON.stringify({ chargeId, status }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e: unknown) {
    console.error("Error checking payment status:", e);
    return new Response("Failed to check payment status", { status: 500 });
  }
}

// Start the server
console.log("Server is running on http://localhost:8000");
serve(handler, { port: 8000 });
