import type { Express } from "express";
import { createServer, type Server } from "http";
import { startBot } from './bot';
import { db } from '@db';
import { teams, players, contracts } from '@db/schema';
import { eq } from 'drizzle-orm';

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  // Start the Discord bot
  startBot();

  // API Routes
  app.get('/api/teams', async (_req, res) => {
    try {
      const allTeams = await db.query.teams.findMany({
        with: {
          players: true,
        },
      });

      // Get active contracts for each team
      const teamsWithDetails = await Promise.all(
        allTeams.map(async (team) => {
          const activeContracts = await db.query.contracts.findMany({
            where: eq(contracts.teamId, team.id),
          });

          const totalSalary = activeContracts.reduce((sum, contract) => sum + contract.salary, 0);
          const availableCap = team.salaryCap! - totalSalary;

          return {
            ...team,
            totalSalary,
            availableCap,
            playerCount: team.players.length,
          };
        })
      );

      res.json(teamsWithDetails);
    } catch (error) {
      console.error('Error fetching teams:', error);
      res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  return httpServer;
}