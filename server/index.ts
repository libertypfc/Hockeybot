import express, { type Request, Response, NextFunction } from "express";
import { createServer } from 'http';
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import { startBot } from "./bot";
import path from 'path';

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

async function startApplication() {
  if (isStarting) return;
  isStarting = true;

  try {
    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize routes
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    registerRoutes(app);

    // Error handling middleware
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      log(`Error: ${message}`, 'error');
      res.status(status).json({ message });
    });

    // Setup Vite for development or serve static files for production
    if (process.env.NODE_ENV === "development") {
      try {
        await setupVite(app, httpServer);
      } catch (error) {
        console.error("Failed to setup Vite:", error);
      }
    } else {
      // For production, serve static files from the dist/public directory
      const distPath = path.resolve(process.cwd(), "dist/public");
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    // Start the HTTP server
    await new Promise<void>((resolve) => {
      httpServer.listen(port, "0.0.0.0", () => {
        log(`HTTP server listening on port ${port}`, 'startup');
        resolve();
      });
    });

    // Start Discord bot if token is available
    if (process.env.DISCORD_TOKEN) {
      log('Starting Discord bot...', 'startup');
      try {
        await startBot();
        log('Discord bot started successfully', 'startup');
      } catch (error) {
        log(`Warning: Failed to start Discord bot: ${error}`, 'startup');
        if (error instanceof Error && error.message.includes('Invalid Discord token')) {
          log('Please check your Discord token configuration', 'startup');
        }
      }
    } else {
      log('No Discord token found, skipping bot initialization', 'startup');
    }

    return true;
  } catch (error) {
    startupError = error as Error;
    log(`Critical startup error: ${error}`, 'startup');
    console.error('Startup error:', error);
    throw error;
  } finally {
    isStarting = false;
  }
}

// Start the application with error handling
startApplication().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});