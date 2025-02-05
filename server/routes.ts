import type { Express } from "express";
import { createServer, type Server } from "http";
import { startBot } from './bot';
import { db } from '@db';
import { teams, players, contracts, teamStats, playerStats, seasons, gameSchedule } from '@db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export function registerRoutes(app: Express): Server {
  const port = process.env.PORT || 3000;

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

      const teamsWithStats = await Promise.all(allTeams.map(async team => {
        // Get current active contracts only for players currently on this team
        const currentTeamContracts = await db.query.contracts.findMany({
          where: and(
            eq(contracts.status, 'active'),
            gte(contracts.endDate, new Date()),
            sql`${contracts.playerId} IN (
              SELECT id FROM ${players}
              WHERE current_team_id = ${team.id}
            )`
          ),
        });

        // Calculate total salary only from active contracts of current players
        const totalSalary = currentTeamContracts.reduce((sum, contract) => {
          console.log(`Contract for team ${team.name}: ${contract.salary} (Status: ${contract.status}, End Date: ${contract.endDate})`);
          return sum + contract.salary;
        }, 0);

        const availableCap = (team.salaryCap || 82500000) - totalSalary;

        // Get exempt players
        const exemptPlayers = team.players
          .filter(player => player.salaryExempt)
          .map(player => ({
            username: player.username,
            discordId: player.discordId
          }));

        console.log(`Team ${team.name} summary:`);
        console.log(`- Total Salary: ${totalSalary}`);
        console.log(`- Available Cap: ${availableCap}`);
        console.log(`- Exempt Players: ${exemptPlayers.length}`);

        return {
          id: team.id,
          name: team.name,
          salaryCap: team.salaryCap,
          availableCap: availableCap,
          totalSalary: totalSalary,
          playerCount: team.players.length,
          exemptPlayers: exemptPlayers
        };
      }));

      res.json(teamsWithStats);
    } catch (error) {
      console.error('Error fetching teams:', error);
      res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  // Create HTTP server with consistent port
  const httpServer = createServer(app);

  httpServer.listen(port, '0.0.0.0', async () => {
    console.log(`Server is running on port ${port}`);
    try {
      await startBot();
      console.log('Bot started successfully after server initialization');
    } catch (error) {
      console.error('Failed to start bot:', error);
      console.error('Bot startup failed but server will continue running');
    }
  });

  return httpServer;
}