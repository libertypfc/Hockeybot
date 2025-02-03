import type { Express } from "express";
import { createServer, type Server } from "http";
import { startBot } from './bot';
import { db } from '@db';
import { teams, players, contracts, teamStats, playerStats, seasons, gameSchedule } from '@db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  // Start the Discord bot
  startBot();

  // API Routes
  app.get('/api/teams', async (_req, res) => {
    try {
      // Get all teams first
      const allTeams = await db.select({
        id: teams.id,
        name: teams.name,
        salaryCap: teams.salaryCap,
        availableCap: teams.availableCap,
      }).from(teams);

      if (allTeams.length === 0) {
        // Return empty array if no teams exist yet
        return res.json([]);
      }

      // Get all players with their team affiliations
      const allPlayers = await db.select({
        id: players.id,
        username: players.username,
        discordId: players.discordId,
        currentTeamId: players.currentTeamId,
        salaryExempt: players.salaryExempt,
      })
      .from(players)
      .where(eq(players.status, 'signed'));

      // Get all active contracts
      const activeContracts = await db.select({
        id: contracts.id,
        playerId: contracts.playerId,
        teamId: contracts.teamId,
        salary: contracts.salary,
      })
      .from(contracts)
      .where(eq(contracts.status, 'active'));

      // Calculate team details
      const teamsWithDetails = allTeams.map(team => {
        const teamPlayers = allPlayers.filter(p => p.currentTeamId === team.id);
        const teamContracts = activeContracts.filter(c => c.teamId === team.id);

        // Calculate total salary excluding exempt players
        const totalSalary = teamContracts.reduce((sum, contract) => {
          const player = teamPlayers.find(p => p.id === contract.playerId);
          return sum + (player?.salaryExempt ? 0 : contract.salary);
        }, 0);

        const availableCap = (team.salaryCap ?? 0) - totalSalary;
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

  // Get the current season and schedule
  app.get('/api/season/current', async (_req, res) => {
    try {
      const currentSeason = await db.query.seasons.findFirst({
        where: eq(seasons.status, 'active'),
        with: {
          gameSchedule: {
            with: {
              homeTeam: true,
              awayTeam: true,
            },
          },
        },
      });

      if (!currentSeason) {
        return res.status(404).json({ error: 'No active season found' });
      }

      res.json(currentSeason);
    } catch (error) {
      console.error('Error fetching current season:', error);
      res.status(500).json({ error: 'Failed to fetch current season' });
    }
  });

  // Get schedule for a specific date range
  app.get('/api/schedule', async (req, res) => {
    try {
      const { start, end } = req.query;
      const startDate = start ? new Date(start as string) : new Date();
      const endDate = end ? new Date(end as string) : new Date(startDate);
      endDate.setDate(endDate.getDate() + 7); // Default to a week if no end date

      const games = await db.select({
        id: gameSchedule.id,
        gameDate: gameSchedule.gameDate,
        gameNumber: gameSchedule.gameNumber,
        status: gameSchedule.status,
        homeScore: gameSchedule.homeScore,
        awayScore: gameSchedule.awayScore,
        homeTeamId: gameSchedule.homeTeamId,
        awayTeamId: gameSchedule.awayTeamId,
      })
      .from(gameSchedule)
      .where(and(
        gte(gameSchedule.gameDate, startDate),
        lte(gameSchedule.gameDate, endDate)
      ));

      // Get all team IDs from the games
      const teamIds = [...new Set([
        ...games.map(g => g.homeTeamId),
        ...games.map(g => g.awayTeamId)
      ])];

      // Fetch team names
      const teamNames = await db.select({
        id: teams.id,
        name: teams.name,
      })
      .from(teams)
      .where(eq(teams.id, teamIds));

      // Add team names to games
      const gamesWithTeams = games.map(game => ({
        ...game,
        homeTeam: teamNames.find(t => t.id === game.homeTeamId)?.name,
        awayTeam: teamNames.find(t => t.id === game.awayTeamId)?.name,
      }));

      res.json(gamesWithTeams);
    } catch (error) {
      console.error('Error fetching schedule:', error);
      res.status(500).json({ error: 'Failed to fetch schedule' });
    }
  });

  // Get team stats
  app.get('/api/teams/stats/:teamId', async (req, res) => {
    try {
      const teamId = parseInt(req.params.teamId);
      const currentSeason = new Date().getFullYear();

      const stats = await db.query.teamStats.findFirst({
        where: and(
          eq(teamStats.teamId, teamId),
          eq(teamStats.season, currentSeason)
        ),
      });

      if (!stats) {
        // Return default stats if none exist
        return res.json({
          wins: 0,
          losses: 0,
          otLosses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          points: 0,
        });
      }

      res.json(stats);
    } catch (error) {
      console.error('Error fetching team stats:', error);
      res.status(500).json({ error: 'Failed to fetch team stats' });
    }
  });

  // Get team players
  app.get('/api/teams/players/:teamId', async (req, res) => {
    try {
      const teamId = parseInt(req.params.teamId);
      const teamPlayers = await db.query.players.findMany({
        where: eq(players.currentTeamId, teamId),
      });

      res.json(teamPlayers);
    } catch (error) {
      console.error('Error fetching team players:', error);
      res.status(500).json({ error: 'Failed to fetch team players' });
    }
  });

  // Get player stats
  app.get('/api/players/stats/:playerId', async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stats = await db.query.playerStats.findMany({
        where: eq(playerStats.playerId, playerId),
      });

      if (!stats.length) {
        // Return default stats if none exist
        return res.json({
          hits: 0,
          fow: 0,
          foTaken: 0,
          takeaways: 0,
          giveaways: 0,
          shots: 0,
          pim: 0,
        });
      }

      // Aggregate stats
      const aggregatedStats = stats.reduce((acc, stat) => ({
        hits: acc.hits + (stat.hits || 0),
        fow: acc.fow + (stat.fow || 0),
        foTaken: acc.foTaken + (stat.foTaken || 0),
        takeaways: acc.takeaways + (stat.takeaways || 0),
        giveaways: acc.giveaways + (stat.giveaways || 0),
        shots: acc.shots + (stat.shots || 0),
        pim: acc.pim + (stat.pim || 0),
      }), {
        hits: 0,
        fow: 0,
        foTaken: 0,
        takeaways: 0,
        giveaways: 0,
        shots: 0,
        pim: 0,
      });

      res.json(aggregatedStats);
    } catch (error) {
      console.error('Error fetching player stats:', error);
      res.status(500).json({ error: 'Failed to fetch player stats' });
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
      .where(eq(players.status, 'signed'));

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
      const teamPlayers = await db.select({
        id: players.id,
        username: players.username,
        discordId: players.discordId,
        salaryExempt: players.salaryExempt,
      })
      .from(players)
      .where(eq(players.currentTeamId, teamId));

      // Get active contracts for this team
      const activeContracts = await db.select()
        .from(contracts)
        .where(and(
          eq(contracts.teamId, teamId),
          eq(contracts.status, 'active')
        ));

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