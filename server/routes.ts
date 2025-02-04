import type { Express } from "express";
import { createServer, type Server } from "http";
import { startBot } from './bot';
import { db } from '@db';
import { teams, players, contracts, teamStats, playerStats, seasons, gameSchedule } from '@db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export function registerRoutes(app: Express): Server {
  const port = process.env.PORT || 3000;
  const alternatePort = 3001;

  // API Routes
  app.get('/api/teams', async (req, res) => {
    try {
      const allTeams = await db.query.teams.findMany({
        with: {
          players: true,
          contracts: {
            where: and(
              eq(contracts.status, 'active'),
              gte(contracts.endDate, new Date())
            )
          }
        }
      });

      const teamsWithStats = allTeams.map(team => {
        const totalSalary = team.contracts.reduce((sum, contract) => sum + contract.salary, 0);
        const availableCap = (team.salaryCap || 82500000) - totalSalary;

        // Get exempt players
        const exemptPlayers = team.players
          .filter(player => player.salaryExempt)
          .map(player => ({
            username: player.username,
            discordId: player.discordId
          }));

        return {
          id: team.id,
          name: team.name,
          salaryCap: team.salaryCap,
          availableCap: availableCap,
          totalSalary: totalSalary,
          playerCount: team.players.length,
          exemptPlayers: exemptPlayers
        };
      });

      res.json(teamsWithStats);
    } catch (error) {
      console.error('Error fetching teams:', error);
      res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  const tryPort = (portToTry: number): Promise<Server> => {
    return new Promise((resolve, reject) => {
      const httpServer = createServer(app);

      httpServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${portToTry} is in use, trying ${alternatePort}`);
          if (portToTry !== alternatePort) {
            httpServer.close();
            resolve(tryPort(alternatePort));
          } else {
            reject(new Error('Both ports are in use'));
          }
        } else {
          reject(err);
        }
      });

      httpServer.listen(portToTry, '0.0.0.0', async () => {
        console.log(`Server is running on port ${portToTry}`);
        try {
          // Start the bot after server is ready and handle any startup errors
          await startBot();
          console.log('Bot started successfully after server initialization');
        } catch (error) {
          console.error('Failed to start bot:', error);
          // Don't exit process, just log the error
          console.error('Bot startup failed but server will continue running');
        }
        resolve(httpServer);
      });
    });
  };

  // Try to start the server on the primary port
  return tryPort(Number(port)) as Promise<Server> & Server;
}