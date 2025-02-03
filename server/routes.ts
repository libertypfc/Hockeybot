import type { Express } from "express";
import { createServer, type Server } from "http";
import { startBot } from './bot';
import { db } from '@db';
import { teams, players, contracts } from '@db/schema';
import { eq, and, asc } from 'drizzle-orm';

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  // Start the Discord bot
  startBot();

  // API Routes
  app.get('/api/teams', async (_req, res) => {
    try {
      const allTeams = await db.query.teams.findMany({
        with: {
          players: {
            with: {
              currentTeam: true,
            },
          },
        },
      });

      // Get active contracts for each team
      const teamsWithDetails = await Promise.all(
        allTeams.map(async (team) => {
          const activeContracts = await db.query.contracts.findMany({
            where: eq(contracts.teamId, team.id),
          });

          // Calculate total salary excluding exempt players
          const totalSalary = activeContracts.reduce((sum, contract) => {
            const player = team.players.find(p => p.id === contract.playerId);
            return sum + (player?.salaryExempt ? 0 : contract.salary);
          }, 0);

          const availableCap = team.salaryCap! - totalSalary;

          const exemptPlayers = team.players.filter(player => player.salaryExempt);

          return {
            ...team,
            totalSalary,
            availableCap,
            playerCount: team.players.length,
            exemptPlayers: exemptPlayers.map(p => ({ 
              username: p.username,
              discordId: p.discordId 
            })),
          };
        })
      );

      res.json(teamsWithDetails);
    } catch (error) {
      console.error('Error fetching teams:', error);
      res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  // New endpoint to get all players
  app.get('/api/players', async (_req, res) => {
    try {
      const allPlayers = await db.select({
        id: players.id,
        username: players.username,
        discordId: players.discordId,
      })
      .from(players)
      .orderBy(asc(players.username));

      res.json(allPlayers);
    } catch (error) {
      console.error('Error fetching players:', error);
      res.status(500).json({ error: 'Failed to fetch players' });
    }
  });

  // New endpoint to get team roster
  app.get('/api/teams/:teamId/roster', async (req, res) => {
    try {
      const teamId = parseInt(req.params.teamId);
      const players = await db.query.players.findMany({
        where: eq(players.currentTeamId, teamId),
        with: {
          currentTeam: true,
        },
      });

      const activeContracts = await db.query.contracts.findMany({
        where: and(
          eq(contracts.teamId, teamId),
          eq(contracts.status, 'active')
        ),
      });

      const roster = players.map(player => {
        const contract = activeContracts.find(c => c.playerId === player.id);
        return {
          id: player.id,
          username: player.username,
          discordId: player.discordId,
          salaryExempt: player.salaryExempt,
          salary: contract?.salary || 0,
        };
      });

      res.json(roster);
    } catch (error) {
      console.error('Error fetching team roster:', error);
      res.status(500).json({ error: 'Failed to fetch team roster' });
    }
  });

  // New endpoint to toggle player exemption
  app.post('/api/teams/:teamId/exempt/:playerId', async (req, res) => {
    try {
      const teamId = parseInt(req.params.teamId);
      const playerId = parseInt(req.params.playerId);

      // Get current exempt players count
      const exemptCount = await db.query.players.count({
        where: and(
          eq(players.currentTeamId, teamId),
          eq(players.salaryExempt, true)
        ),
      });

      // Get player's current status
      const player = await db.query.players.findFirst({
        where: eq(players.id, playerId),
      });

      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }

      if (exemptCount >= 2 && !player.salaryExempt) {
        return res.status(400).json({ error: 'Team already has 2 salary exempt players' });
      }

      // Toggle exemption
      await db.update(players)
        .set({ salaryExempt: !player.salaryExempt })
        .where(eq(players.id, playerId));

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating player exemption:', error);
      res.status(500).json({ error: 'Failed to update player exemption' });
    }
  });

  return httpServer;
}