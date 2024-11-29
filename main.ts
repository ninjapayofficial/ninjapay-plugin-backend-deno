// main.ts
const encoder = new TextEncoder();
const decoder = new TextDecoder();

import { serve } from "https://deno.land/std@0.185.0/http/server.ts";
import { renderFileToString } from "https://deno.land/x/dejs@0.10.3/mod.ts";
import { exists } from "https://deno.land/std@0.185.0/fs/mod.ts";

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
          args: ["run", "--allow-run", "--allow-read", "--allow-write",  migrateFile],
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
  } else {
    return new Response("Not Found", { status: 404 });
  }
}

// Start the server
console.log("Server is running on http://localhost:8000");
serve(handler, { port: 8000 });
