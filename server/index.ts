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

async function startApplication() {
  if (isStarting) return;
  isStarting = true;

  try {
    // Create HTTP server first
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
      }
    } else {
      serveStatic(app);
    }

    // Start the HTTP server first
    const PORT = Number(process.env.PORT) || 5000;
    await new Promise<void>((resolve) => {
      httpServer.listen(PORT, "0.0.0.0", () => {
        log(`HTTP server listening on port ${PORT}`, 'startup');
        resolve();
      });
    });

    // Start Discord bot with delay to ensure server is ready
    setTimeout(async () => {
      try {
        const discordClient = await startBot();
        if (discordClient) {
          log('Discord bot started successfully', 'startup');
        }
      } catch (error) {
        log(`Error starting Discord bot: ${error}`, 'startup');
        // Don't throw error here, let the bot's internal reconnection handle it
      }
    }, 5000); // 5 second delay before starting bot

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