// main.ts
import express from "npm:express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsPromises from "node:fs/promises";

const execAsync = promisify(exec); // Define execAsync here

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware to parse URL-encoded data
app.use(express.urlencoded({ extended: true }));

// Set the views directory and the view engine to EJS
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Function to extract repository name from Git URL
function getRepoName(gitUrl: string): string {
  const match = gitUrl.match(/\/([^\/]+?)(?:\.git)?$/);
  if (match) {
    return match[1];
  } else {
    throw new Error("Invalid Git URL");
  }
}

// Route for the main page
app.get("/", async (req: any, res: { render: (arg0: string, arg1: { plugins: string[]; }) => void; }) => {
  const pluginsDir = path.join(__dirname, "plugins");
  let plugins: string[] = [];

  try {
    const dirEntries = await fsPromises.readdir(pluginsDir, { withFileTypes: true });
    plugins = dirEntries
      .filter((entry: { isDirectory: () => any; }) => entry.isDirectory())
      .map((entry: { name: any; }) => entry.name);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      await fsPromises.mkdir(pluginsDir);
    } else {
      throw e;
    }
  }

  res.render("index", { plugins });
});

// Route to handle plugin installation
app.post("/install", async (req: { body: { gitUrl: any; }; }, res: { status: (arg0: number) => { (): any; new(): any; send: { (arg0: string): void; new(): any; }; }; redirect: (arg0: string) => void; }) => {
  const gitUrl = req.body.gitUrl;

  if (!gitUrl) {
    res.status(400).send("Git URL is required");
    return;
  }

  let repoName;
  try {
    repoName = getRepoName(gitUrl);
  } catch (e: any) {
    res.status(400).send("Invalid Git URL");   
    return;
  }

  const pluginsDir = path.join(__dirname, "plugins");
  const pluginPath = path.join(pluginsDir, repoName);

  try {
    // Check if the plugin directory already exists
    if (fs.existsSync(pluginPath)) {
      // Remove the existing directory
      await fsPromises.rm(pluginPath, { recursive: true, force: true });
    }

    // Clone the repository
    await execAsync(`git clone ${gitUrl} ${pluginPath}`);

    // Run migrations if migrate.ts exists
    const migrateFile = path.join(pluginPath, "migrate.ts");
    if (fs.existsSync(migrateFile)) {
      await execAsync(`deno run --allow-read --allow-write ${migrateFile}`);
    } else {
      console.warn(`Migration file not found at ${migrateFile}`);
      // Optionally handle the absence of migrate.ts
    }

    res.redirect("/");
  } catch (e: any) {
    console.error("Error installing plugin:", e);
    res.status(500).send(`Failed to install plugin: ${e.message}`);
  }
});

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
