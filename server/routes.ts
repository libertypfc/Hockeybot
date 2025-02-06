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

        const totalSalary = currentTeamContracts.reduce((sum, contract) => {
          return sum + contract.salary;
        }, 0);

        const availableCap = (team.salaryCap || 82500000) - totalSalary;

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
      }));

      res.json(teamsWithStats);
    } catch (error) {
      console.error('Error fetching teams:', error);
      res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  // Get team roster with salary information
  app.get('/api/teams/:teamId/roster', async (req, res) => {
    try {
      const teamId = parseInt(req.params.teamId);

      if (isNaN(teamId)) {
        return res.status(400).json({ error: 'Invalid team ID' });
      }

      const team = await db.query.teams.findFirst({
        where: eq(teams.id, teamId),
        with: {
          players: {
            where: and(
              eq(players.currentTeamId, sql`${teamId}`),
              eq(players.status, 'signed')
            ),
          },
        },
      });

      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }

      // Get active contracts for all players on the team
      const activeContracts = await db.query.contracts.findMany({
        where: and(
          eq(contracts.teamId, teamId),
          eq(contracts.status, 'active'),
          gte(contracts.endDate, new Date())
        ),
      });

      // Map players with their contract information
      const roster = team.players.map(player => {
        const contract = activeContracts.find(c => c.playerId === player.id);
        return {
          id: player.id,
          username: player.username,
          discordId: player.discordId,
          salaryExempt: player.salaryExempt,
          salary: contract?.salary || 0,
        };
      });

      console.log('Roster response:', roster); // Add logging for debugging
      res.json(roster);
    } catch (error) {
      console.error('Error fetching team roster:', error);
      res.status(500).json({ error: 'Failed to fetch team roster' });
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