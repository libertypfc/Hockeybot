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
  log(`${req.method} ${req.path} started`, 'request');

  res.on("finish", () => {
    const duration = Date.now() - start;
    log(`${req.method} ${req.path} ${res.statusCode} completed in ${duration}ms`, 'request');
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
    log('Configuration validated successfully', 'startup');

    // Create and configure HTTP server
    const httpServer = createServer(app);
    registerRoutes(app);
    log('Routes registered successfully', 'startup');

    // Setup Vite or static files based on environment
    if (CONFIG.NODE_ENV === "development") {
      try {
        await setupVite(app, httpServer);
        log('Vite middleware setup complete', 'startup');
      } catch (error) {
        console.error("Failed to setup Vite:", error);
      }
    } else {
      const distPath = path.resolve(process.cwd(), "dist/public");
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      log('Static file serving configured', 'startup');
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

// Handle process termination gracefully
process.on('SIGTERM', () => {
  log('Received SIGTERM signal, shutting down gracefully...', 'shutdown');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT signal, shutting down gracefully...', 'shutdown');
  process.exit(0);
});