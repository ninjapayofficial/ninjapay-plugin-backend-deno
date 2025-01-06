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

// Helper function to get provider from headers
async function getProviderFromHeaders(headers: Headers): Promise<any | null> {
  const providerInvoiceKey = headers.get("X-Provider-Invoice-Key");
  const providerAdminKey = headers.get("X-Provider-Admin-Key");

  if (!providerInvoiceKey && !providerAdminKey) {
    console.log("No provider keys found in headers.");
    return null;
  }

  if (providerInvoiceKey) {
    const providerDoc = await db.collection("providerKeys").doc(
      providerInvoiceKey,
    ).get();
    if (providerDoc.exists) {
      console.log(`Provider found via Invoice Key: ${providerInvoiceKey}`);
      return providerDoc.data();
    }
  }

  if (providerAdminKey) {
    const querySnapshot = await db.collection("providerKeys")
      .where("providerAdminKey", "==", providerAdminKey)
      .limit(1)
      .get();

    if (!querySnapshot.empty) {
      const providerDoc = querySnapshot.docs[0];
      console.log(`Provider found via Admin Key: ${providerAdminKey}`);
      return providerDoc.data();
    }
  }

  console.warn("No matching provider found for the provided keys.");
  return null; // No matching provider found
}

// Function to handle HTTP requests
async function handler(req: Request): Promise<Response | any> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Parse cookies from the request
  const cookies = getCookies(req.headers);
  const token = cookies.token;

  // Extract provider keys from headers
  const providerInvoiceKey = req.headers.get("X-Provider-Invoice-Key");
  const providerAdminKey = req.headers.get("X-Provider-Admin-Key");

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

  // Check if the route is protected
  if (protectedRoutes.includes(pathname)) {
    // If provider keys are not present, require authentication
    if (!providerInvoiceKey && !providerAdminKey) {
      if (!token) {
        // Respond with JSON indicating the need to log in
        return new Response(JSON.stringify({ redirect: "/login" }), {
          headers: { "Content-Type": "application/json" },
          status: 401,
        });
      } else {
        // Verify token and get UID
        try {
          const decoded = await verifyIdToken(token);
          uid = decoded.uid;
        } catch (e) {
          console.error("Error verifying token:", e);
          // Respond with JSON indicating the need to log in
          return new Response(JSON.stringify({ redirect: "/login" }), {
            headers: { "Content-Type": "application/json" },
            status: 401,
          });
        }
      }
    }
    // Else, if provider keys are present, proceed without setting UID
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
    try {
      const body = await req.json();
      const gitUrl = body.gitUrl;

      if (!gitUrl) {
        return new Response(JSON.stringify({ error: "Git URL is required" }), {
          headers: { "Content-Type": "application/json" },
          status: 400,
        });
      }

      let repoName;
      try {
        repoName = getRepoName(gitUrl);
      } catch (e: unknown) {
        return new Response(
          JSON.stringify({ error: `Invalid Git URL: ${e}` }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      const pluginsDir = "./plugins";
      const pluginPath = `${pluginsDir}/${repoName}`;

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
        return new Response(
          JSON.stringify({
            error: `Failed to clone repository: ${errorString}`,
          }),
          { headers: { "Content-Type": "application/json" }, status: 500 },
        );
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
          return new Response(
            JSON.stringify({ error: "Migration failed" }),
            { headers: { "Content-Type": "application/json" }, status: 500 },
          );
        }
      } else {
        console.warn(`Migration file not found at ${migrateFile}`);
      }

      // Respond with success and redirect URL
      return new Response(JSON.stringify({ success: true, redirect: "/" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    } catch (e: unknown) {
      console.error("Error installing plugin:", e);
      return new Response(
        JSON.stringify({ error: `Failed to install plugin: ${e}` }),
        { headers: { "Content-Type": "application/json" }, status: 500 },
      );
    }
  } else if (req.method === "GET" && pathname === "/signup") {
    // Serve the signup page
    const body = await renderFileToString(`${Deno.cwd()}/views/signup.ejs`, {});
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/signup") {
    // Handle user signup
    try {
      const body = await req.json();
      const email = body.email;
      const password = body.password;

      if (!email || !password) {
        return new Response(
          JSON.stringify({ error: "Email and password are required" }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      // Firebase Signup API Endpoint
      const apiKey = Deno.env.get("API_KEY");
      const signUpUrl =
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;

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
        return new Response(
          JSON.stringify({ error: `Signup failed: ${data.error.message}` }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      // Set auth token in cookies
      const headers = new Headers();
      setCookie(headers, {
        name: "token",
        value: data.idToken,
        httpOnly: true,
        sameSite: "Lax",
        // secure: true, // Uncomment when using HTTPS
      });

      // Return success with redirect URL
      return new Response(
        JSON.stringify({ success: true, redirect: "/" }),
        {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": headers.get("Set-Cookie") || "",
          },
          status: 200,
        },
      );
    } catch (e: unknown) {
      console.error("Error during signup:", e);
      return new Response(
        JSON.stringify({ error: `Failed to signup: ${e}` }),
        { headers: { "Content-Type": "application/json" }, status: 500 },
      );
    }
  } else if (req.method === "GET" && pathname === "/login") {
    // Serve the login page
    const body = await renderFileToString(`${Deno.cwd()}/views/login.ejs`, {});
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/login") {
    // Handle user login
    try {
      const body = await req.json();
      const email = body.email;
      const password = body.password;

      if (!email || !password) {
        return new Response(
          JSON.stringify({ error: "Email and password are required" }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      // Firebase Login API Endpoint
      const apiKey = Deno.env.get("API_KEY");
      const signInUrl =
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

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
        return new Response(
          JSON.stringify({ error: `Login failed: ${data.error.message}` }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      // Set auth token in cookies
      const headers = new Headers();
      setCookie(headers, {
        name: "token",
        value: data.idToken,
        httpOnly: true,
        sameSite: "Lax",
        // secure: true, // Uncomment when using HTTPS
      });

      // Return success with redirect URL
      return new Response(
        JSON.stringify({ success: true, redirect: "/" }),
        {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": headers.get("Set-Cookie") || "",
          },
          status: 200,
        },
      );
    } catch (e: unknown) {
      console.error("Error during login:", e);
      return new Response(
        JSON.stringify({ error: `Failed to login: ${e}` }),
        { headers: { "Content-Type": "application/json" }, status: 500 },
      );
    }
  } else if (req.method === "POST" && pathname === "/logout") {
    // Handle user logout
    try {
      const headers = new Headers();
      deleteCookie(headers, "token");
      return new Response(
        JSON.stringify({ success: true, redirect: "/login" }),
        {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": headers.get("Set-Cookie") || "",
          },
          status: 200,
        },
      );
    } catch (e: unknown) {
      console.error("Error during logout:", e);
      return new Response(
        JSON.stringify({ error: `Failed to logout: ${e}` }),
        { headers: { "Content-Type": "application/json" }, status: 500 },
      );
    }
  } else if (req.method === "GET" && pathname === "/funding") {
    try {
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const fundingProviders = userData?.fundingProviders || [];
      const defaultProvider = userData?.defaultProvider || "";

      // Fetch transactions based on the default provider
      let transactions: any[] = []; // Explicitly type as any[] or a more specific type if known
      if (defaultProvider) {
        const response = await handleGetTransactions(req, uid);
        if (response.ok) {
          const data = await response.json();
          transactions = data.transactions || [];
        } else {
          console.error(
            "Error fetching transactions:",
            response.status,
            response.statusText,
          );
          // Handle the error, e.g., show an error message to the user
        }
      }

      const body = await renderFileToString(`${Deno.cwd()}/views/funding.ejs`, {
        fundingProviders,
        defaultProvider,
        transactions,
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
    try {
      const body = await req.json();
      const provider = body.provider;

      if (provider === "lnbits") {
        return new Response(
          JSON.stringify({ redirect: "/add-funding/lnbits" }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      } else if (provider === "opennode") {
        return new Response(
          JSON.stringify({ redirect: "/add-funding/opennode" }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      } else {
        return new Response(
          JSON.stringify({ error: "Invalid provider selected" }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }
    } catch (e: unknown) {
      console.error("Error selecting provider:", e);
      return new Response(
        JSON.stringify({ error: `Failed to select provider: ${e}` }),
        { headers: { "Content-Type": "application/json" }, status: 500 },
      );
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
    try {
      const body = await req.json();
      const instanceUrl = body.instanceUrl;
      const invoiceKey = body.invoiceKey;
      const adminKey = body.adminKey;

      if (!instanceUrl || !invoiceKey || !adminKey) {
        return new Response(
          JSON.stringify({ error: "All fields are required" }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      // Generate provider keys
      const providerInvoiceKey = generateProviderKey("p_ik_");
      const providerAdminKey = generateProviderKey("p_ak_");

      // Save to Firestore by appending to fundingProviders array
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
      await userDocRef.set(
        {
          fundingProviders,
        },
        { merge: true },
      );

      // If this is the first provider, set as default
      if (fundingProviders.length === 1) {
        await userDocRef.set(
          {
            defaultProvider: "lnbits",
          },
          { merge: true },
        );
      }

      // Add entries to providerKeys collection
      const providerData = {
        userId: uid,
        provider: "lnbits",
        instanceUrl,
        invoiceKey,
        adminKey,
        providerInvoiceKey,
        providerAdminKey,
      };

      // Add providerInvoiceKey document
      await db.collection("providerKeys").doc(providerInvoiceKey).set(
        providerData,
      );

      // Add providerAdminKey document
      await db.collection("providerKeys").doc(providerAdminKey).set(
        providerData,
      );

      // Respond with success and redirect URL
      return new Response(
        JSON.stringify({ success: true, redirect: "/funding" }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    } catch (e: unknown) {
      console.error("Error saving LNbits provider:", e);
      return new Response(
        JSON.stringify({ error: "Failed to add LNbits provider" }),
        { headers: { "Content-Type": "application/json" }, status: 500 },
      );
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
    try {
      const body = await req.json();
      const invoiceKey = body.invoiceKey;
      const readApiKey = body.readApiKey;

      if (!invoiceKey || !readApiKey) {
        return new Response(
          JSON.stringify({ error: "All fields are required" }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      // Generate provider keys
      const providerInvoiceKey = generateProviderKey("p_ik_");
      const providerAdminKey = generateProviderKey("p_ak_");

      // Save to Firestore by appending to fundingProviders array
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
      await userDocRef.set(
        {
          fundingProviders,
        },
        { merge: true },
      );

      // If this is the first provider, set as default
      if (fundingProviders.length === 1) {
        await userDocRef.set(
          {
            defaultProvider: "opennode",
          },
          { merge: true },
        );
      }

      // Add entries to providerKeys collection
      const providerData = {
        userId: uid,
        provider: "opennode",
        invoiceKey,
        readApiKey,
        providerInvoiceKey,
        providerAdminKey,
      };

      // Add providerInvoiceKey document
      await db.collection("providerKeys").doc(providerInvoiceKey).set(
        providerData,
      );

      // Add providerAdminKey document
      await db.collection("providerKeys").doc(providerAdminKey).set(
        providerData,
      );

      // Respond with success and redirect URL
      return new Response(
        JSON.stringify({ success: true, redirect: "/funding" }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    } catch (e: unknown) {
      console.error("Error saving OpenNode provider:", e);
      return new Response(
        JSON.stringify({ error: "Failed to add OpenNode provider" }),
        { headers: { "Content-Type": "application/json" }, status: 500 },
      );
    }
  } else if (req.method === "POST" && pathname === "/set-default-provider") {
    // Handle setting a default provider
    try {
      const body = await req.json();
      const providerIndex = body.providerIndex;

      if (isNaN(providerIndex)) {
        return new Response(
          JSON.stringify({ error: "Invalid provider index" }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      const userDocRef = db.collection("users").doc(uid);
      const userDoc = await userDocRef.get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const fundingProviders = userData?.fundingProviders || [];

      if (providerIndex < 0 || providerIndex >= fundingProviders.length) {
        return new Response(
          JSON.stringify({ error: "Provider index out of range" }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }

      const selectedProvider = fundingProviders[providerIndex].provider;

      // Update default provider in Firestore
      await userDocRef.set(
        {
          defaultProvider: selectedProvider,
        },
        { merge: true },
      );

      // Respond with success and redirect URL
      return new Response(
        JSON.stringify({ success: true, redirect: "/funding" }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    } catch (e: unknown) {
      console.error("Error setting default provider:", e);
      return new Response(
        JSON.stringify({ error: "Failed to set default provider" }),
        { headers: { "Content-Type": "application/json" }, status: 500 },
      );
    }
  } // Payment Endpoints
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

async function handleCreatePayLink(
  req: Request,
  uid: string,
): Promise<Response> {
  try {
    const headers = req.headers;
    let provider = null;

    // Attempt to get provider from headers
    provider = await getProviderFromHeaders(headers);

    if (!provider && uid) {
      // If no provider specified via headers, use default provider from session
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const defaultProviderName = userData?.defaultProvider;
      const fundingProviders = userData?.fundingProviders || [];

      if (defaultProviderName) {
        provider = fundingProviders.find(
          (p: any) => p.provider === defaultProviderName,
        );
        if (provider) {
          console.log(`Using default provider: ${provider.provider}`);
        } else {
          console.warn(`Default provider ${defaultProviderName} not found.`);
        }
      }
    }

    if (!provider) {
      console.error("No provider specified or found.");
      return new Response("No provider specified or found", { status: 400 });
    }

    // Parse the request body as JSON
    const body = await req.json();
    const amountStr = body.amount;
    const memo = body.memo || "";

    const amount = parseFloat(amountStr || "0");
    if (isNaN(amount) || amount <= 0) {
      console.warn(`Invalid amount received: ${amountStr}`);
      return new Response("Invalid amount", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (provider.provider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
      console.log("Initialized LNbitsPaymentService.");
    } else if (provider.provider === "opennode") {
      paymentService = new OpenNodePaymentService(provider);
      console.log("Initialized OpenNodePaymentService.");
    } else {
      console.error(`Unsupported provider: ${provider.provider}`);
      return new Response("Unsupported provider", { status: 400 });
    }

    // Create payment link
    const payLink = await paymentService.createPayLink(amount, memo);
    console.log("Payment link created successfully.");

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
    const headers = req.headers;
    let provider = null;

    // Attempt to get provider from headers
    provider = await getProviderFromHeaders(headers);

    if (!provider && uid) {
      // If no provider specified via headers, use default provider from session
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const defaultProviderName = userData?.defaultProvider;
      const fundingProviders = userData?.fundingProviders || [];

      if (defaultProviderName) {
        provider = fundingProviders.find(
          (p: any) => p.provider === defaultProviderName,
        );
      }
    }

    if (!provider) {
      return new Response("No provider specified or found", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (provider.provider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
    } else if (provider.provider === "opennode") {
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
    const headers = req.headers;
    let provider = null;

    // Attempt to get provider from headers
    provider = await getProviderFromHeaders(headers);

    if (!provider && uid) {
      // Use default provider if no provider key is provided
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const defaultProviderName = userData?.defaultProvider;
      const fundingProviders = userData?.fundingProviders || [];

      if (defaultProviderName) {
        provider = fundingProviders.find(
          (p: any) => p.provider === defaultProviderName,
        );
        if (provider) {
          console.log(`Using default provider: ${provider.provider}`);
        } else {
          console.warn(`Default provider ${defaultProviderName} not found.`);
        }
      }
    }

    if (!provider) {
      console.error("No provider specified or found.");
      return new Response("No provider specified or found", { status: 400 });
    }

    const body = await req.json();
    const paymentRequest = body.paymentRequest?.toString();

    // Log the received paymentRequest
    console.log(`Received paymentRequest: ${paymentRequest}`);

    if (!paymentRequest) {
      return new Response("Payment request is required", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (provider.provider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
      console.log("Initialized LNbitsPaymentService.");
    } else if (provider.provider === "opennode") {
      paymentService = new OpenNodePaymentService(provider);
      console.log("Initialized OpenNodePaymentService.");
    } else {
      console.error(`Unsupported provider: ${provider.provider}`);
      return new Response("Unsupported provider", { status: 400 });
    }

    // Pay the invoice
    const payResponse = await paymentService.payInvoice(paymentRequest);
    console.log("Payment response:", payResponse);

    return new Response(JSON.stringify(payResponse), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e: unknown) {
    console.error("Error paying invoice:", e);
    return new Response("Failed to pay invoice", { status: 500 });
  }
}

async function handleGetTransactions(
  req: Request,
  uid: string,
): Promise<Response> {
  try {
    const headers = req.headers;
    let provider = null;

    // Attempt to get provider from headers
    provider = await getProviderFromHeaders(headers);

    if (!provider && uid) {
      // If no provider specified via headers, use default provider from session
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const defaultProviderName = userData?.defaultProvider;
      const fundingProviders = userData?.fundingProviders || [];

      if (defaultProviderName) {
        provider = fundingProviders.find(
          (p: any) => p.provider === defaultProviderName,
        );
      }
    }

    if (!provider) {
      return new Response("No provider specified or found", { status: 400 });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (provider.provider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
    } else if (provider.provider === "opennode") {
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
    const headers = req.headers;
    let provider = null;

    // Attempt to get provider from headers
    provider = await getProviderFromHeaders(headers);

    if (!provider && uid) {
      // If no provider specified via headers, use default provider from session
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const defaultProviderName = userData?.defaultProvider;
      const fundingProviders = userData?.fundingProviders || [];

      if (defaultProviderName) {
        provider = fundingProviders.find(
          (p: any) => p.provider === defaultProviderName,
        );
      }
    }

    if (!provider) {
      return new Response("No provider specified or found", { status: 400 });
    }

    const url = new URL(req.url);
    const chargeId = url.searchParams.get("chargeId");

    if (!chargeId) {
      return new Response("chargeId query parameter is required", {
        status: 400,
      });
    }

    // Initialize the appropriate payment service
    let paymentService: any;
    if (provider.provider === "lnbits") {
      paymentService = new LNbitsPaymentService(provider);
    } else if (provider.provider === "opennode") {
      paymentService = new OpenNodePaymentService(provider);
    } else {
      return new Response("Unsupported provider", { status: 400 });
    }

    // Check payment status
    let status: string = "";
    if (provider.provider === "lnbits") {
      status = await paymentService.checkStatus(chargeId);
    } else if (provider.provider === "opennode") {
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
