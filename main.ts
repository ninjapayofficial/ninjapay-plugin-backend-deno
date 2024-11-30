// main.ts
const encoder = new TextEncoder();
const decoder = new TextDecoder();

import { serve } from "https://deno.land/std@0.185.0/http/server.ts";
import { renderFileToString } from "https://deno.land/x/dejs@0.10.3/mod.ts";
import { exists } from "https://deno.land/std@0.185.0/fs/mod.ts";
import { config } from "dotenv";
import { getCookies, setCookie, deleteCookie, } from "https://deno.land/std@0.185.0/http/cookie.ts";

config(); // Load environment variables from .env

// Helper function to extract repository name from Git URL
function getRepoName(gitUrl: string): string {
  const match = gitUrl.match(/\/([^\/]+?)(?:\.git)?$/);
  if (match) {
    return match[1];
  } else {
    throw new Error("Invalid Git URL");
  }
}

// Function to handle HTTP requests
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Parse cookies from the request
  const cookies = getCookies(req.headers);
  const token = cookies.token;

  // Define protected routes
  const protectedRoutes = ["/", "/install"];

  if (protectedRoutes.includes(pathname)) {
    // Check if the user is authenticated
    if (!token) {
      // Redirect to login page
      // Construct absolute URL for redirection
      const redirectUrl = new URL("/login", req.url).toString();
      return Response.redirect(redirectUrl, 302);
    }
  }

  if (req.method === "GET" && pathname === "/") {
    // Serve the main page
    const pluginsDir = "./plugins";
    let plugins: string[] = [];

    try {
      for await (const dirEntry of Deno.readDir(pluginsDir)) {
        if (dirEntry.isDirectory) {
          plugins.push(dirEntry.name);
        }
      }
    } catch (e: any) {
      if (e instanceof Deno.errors.NotFound) {
        await Deno.mkdir(pluginsDir);
      } else {
        throw e;
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
    } catch (e: any) {
      return new Response("Invalid Git URL", { status: 400 });
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

        const { code, stderr } = await denoRunCommand.output();
        const errorString = decoder.decode(stderr);

        if (code !== 0) {
          console.error("Error running migrations:", errorString);
        }
      } else {
        console.warn(`Migration file not found at ${migrateFile}`);
      }

      // Redirect back to the main page
      return Response.redirect("/", 303);
    } catch (e: any) {
      console.error("Error installing plugin:", e);
      return new Response(`Failed to install plugin: ${e.message}`, {
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
    const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;

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
      return new Response(`Signup failed: ${data.error.message}`, { status: 400 });
    }

    // Set auth token in cookies
    const headers = new Headers();
    setCookie(headers, {
      name: "token",
      value: data.idToken,
      httpOnly: true,
      sameSite: "Lax",
    });

    headers.set("Location", "/");
    return new Response(null, {
      status: 302,
      headers,
    });
  } else if (req.method === "GET" && pathname === "/login") {
    // Serve the login page
    const body = await renderFileToString(`${Deno.cwd()}/views/login.ejs`, {});
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (req.method === "POST" && pathname === "/login") {
    // Handle user login / // ... after successful login ...
    const formData = await req.formData();
    const email = formData.get("email")?.toString();
    const password = formData.get("password")?.toString();

    if (!email || !password) {
      return new Response("Email and password are required", { status: 400 });
    }

    // Firebase Login API Endpoint
    const apiKey = Deno.env.get("API_KEY");
    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

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
      return new Response(`Login failed: ${data.error.message}`, { status: 400 });
    }

    // Set auth token in cookies
    const headers = new Headers();
    setCookie(headers, {
      name: "token",
      value: data.idToken,
      httpOnly: true,
      sameSite: "Lax",
    });
    
    const redirectUrl = new URL("/", req.url).toString();
    headers.set("Location", redirectUrl);
    return new Response(null, {
      status: 302,
      headers,
    });
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
  } else {
    return new Response("Not Found", { status: 404 });
  }
}

// Start the server
console.log("Server is running on http://localhost:8000");
serve(handler, { port: 8000 });
