import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import { startBot } from "./bot";
import path from 'path';
import { createServer } from 'http';
import { CONFIG, validateConfig } from './config';

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
    // Validate configuration
    validateConfig();

    // Create and configure HTTP server
    const httpServer = createServer(app);
    registerRoutes(app);

    // Error handling middleware
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      log(`Error: ${message}`, 'error');
      res.status(status).json({ message });
    });

    // Setup Vite for development or serve static files for production
    if (CONFIG.NODE_ENV === "development") {
      try {
        await setupVite(app, httpServer);
      } catch (error) {
        console.error("Failed to setup Vite:", error);
        // Continue even if Vite setup fails in development
      }
    } else {
      // For production, serve static files from the dist/public directory
      const distPath = path.resolve(process.cwd(), "dist/public");
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    // Start HTTP server with proper error handling
    await new Promise<void>((resolve, reject) => {
      try {
        const server = httpServer.listen(CONFIG.PORT, "0.0.0.0", () => {
          log(`HTTP server listening on port ${CONFIG.PORT}`, 'startup');
          resolve();
        });

        server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            reject(new Error(`Port ${CONFIG.PORT} is already in use`));
          } else {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });

    // Initialize Discord bot after server is running
    if (CONFIG.DISCORD_TOKEN) {
      log('Starting Discord bot...', 'startup');
      try {
        await startBot();
        log('Discord bot started successfully', 'startup');
      } catch (error) {
        log(`Warning: Failed to start Discord bot: ${error}`, 'startup');
        // Don't fail the application if Discord bot fails to start
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

// Handle process termination gracefully
process.on('SIGTERM', () => {
  log('Received SIGTERM signal, shutting down gracefully...', 'shutdown');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT signal, shutting down gracefully...', 'shutdown');
  process.exit(0);
});