import type { Express } from "express";
import { createServer, type Server } from "http";
import { startBot } from './bot';

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  
  // Start the Discord bot
  startBot();

  return httpServer;
}
