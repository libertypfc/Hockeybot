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
      // Get all teams first
      const allTeams = await db.query.teams.findMany();

      // Get all players with their team affiliations
      const allPlayers = await db.query.players.findMany({
        where: eq(players.status, 'signed'),
      });

      // Get all active contracts
      const activeContracts = await db.query.contracts.findMany({
        where: eq(contracts.status, 'active'),
      });

      // Calculate team details
      const teamsWithDetails = allTeams.map(team => {
        const teamPlayers = allPlayers.filter(p => p.currentTeamId === team.id);
        const teamContracts = activeContracts.filter(c => c.teamId === team.id);

        // Calculate total salary excluding exempt players
        const totalSalary = teamContracts.reduce((sum, contract) => {
          const player = teamPlayers.find(p => p.id === contract.playerId);
          return sum + (player?.salaryExempt ? 0 : contract.salary);
        }, 0);

        const availableCap = team.salaryCap! - totalSalary;
        const exemptPlayers = teamPlayers.filter(p => p.salaryExempt);

        return {
          ...team,
          totalSalary,
          availableCap,
          playerCount: teamPlayers.length,
          exemptPlayers: exemptPlayers.map(p => ({
            username: p.username,
            discordId: p.discordId,
          })),
        };
      });

      res.json(teamsWithDetails);
    } catch (error) {
      console.error('Error fetching teams:', error);
      res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  // Get all players
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

  // Get team roster
  app.get('/api/teams/:teamId/roster', async (req, res) => {
    try {
      const teamId = parseInt(req.params.teamId);

      // Get players on this team
      const teamPlayers = await db.query.players.findMany({
        where: eq(players.currentTeamId, teamId),
      });

      // Get active contracts for this team
      const activeContracts = await db.query.contracts.findMany({
        where: and(
          eq(contracts.teamId, teamId),
          eq(contracts.status, 'active')
        ),
      });

      const roster = teamPlayers.map(player => {
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

  // Toggle player salary exemption
  app.post('/api/teams/:teamId/exempt/:playerId', async (req, res) => {
    try {
      const teamId = parseInt(req.params.teamId);
      const playerId = parseInt(req.params.playerId);

      // Get current exempt players for this team
      const exemptPlayers = await db.query.players.findMany({
        where: and(
          eq(players.currentTeamId, teamId),
          eq(players.salaryExempt, true)
        ),
      });

      // Get the player we want to update
      const player = await db.query.players.findFirst({
        where: eq(players.id, playerId),
      });

      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }

      // Check if we can make this player exempt
      if (exemptPlayers.length >= 2 && !player.salaryExempt) {
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