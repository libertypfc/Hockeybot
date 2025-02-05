import express, { type Request, Response, NextFunction } from "express";
import { createServer } from 'http';
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startBot } from "./bot/discord";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

let isStarting = false;
let startupError: Error | null = null;
let retryAttempts = 0;
const MAX_RETRY_ATTEMPTS = 5;

async function startApplication() {
  if (isStarting) return;
  isStarting = true;

  try {
    // Start Discord bot first with retry logic
    let discordClient = null;
    let attempts = 0;
    while (!discordClient && attempts < 3) {
      discordClient = await startBot();
      if (!discordClient) {
        attempts++;
        log(`Discord bot startup attempt ${attempts} failed, retrying...`, 'startup');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    if (!discordClient) {
      throw new Error('Failed to initialize Discord bot after multiple attempts');
    }
    log('Discord bot started successfully', 'startup');

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize routes
    registerRoutes(app);

    // Error handling middleware
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      log(`Error: ${message}`, 'error');
      res.status(status).json({ message });
    });

    // Setup Vite or static serving
    if (app.get("env") === "development") {
      try {
        await setupVite(app, httpServer);
      } catch (error) {
        console.error("Failed to setup Vite:", error);
        // Continue even if Vite setup fails - we still want the bot to work
      }
    } else {
      serveStatic(app);
    }

    // Start the HTTP server
    const PORT = Number(process.env.PORT) || 5000;
    httpServer.listen(PORT, "0.0.0.0", () => {
      log(`HTTP server listening on port ${PORT}`, 'startup');
      retryAttempts = 0; // Reset retry attempts on successful startup
    });

    return true;
  } catch (error) {
    startupError = error as Error;
    log(`Critical startup error: ${error}`, 'startup');
    console.error('Startup error:', error);

    retryAttempts++;
    if (retryAttempts < MAX_RETRY_ATTEMPTS) {
      log(`Retrying startup (attempt ${retryAttempts}/${MAX_RETRY_ATTEMPTS})...`, 'startup');
      setTimeout(startApplication, 5000);
    } else {
      log('Max retry attempts reached. Please check logs and restart manually.', 'startup');
      process.exit(1);
    }
  } finally {
    isStarting = false;
  }
}

// Start the application with error handling
startApplication().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});