import type { Express } from "express";
import { createServer, type Server } from "http";
import { startBot, client } from './bot';
import { db } from '@db';
import { teams, players, contracts } from '@db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { Client, GatewayIntentBits } from 'discord.js';

export function registerRoutes(app: Express): Server {
  const port = process.env.PORT || 3000;

  // API Routes
  app.get('/api/servers', async (req, res) => {
    try {
      if (!client) {
        console.error('Discord client is null');
        return res.status(503).json({
          error: 'Discord connection unavailable',
          details: 'The Discord bot is not initialized'
        });
      }

      if (!client.isReady()) {
        console.error('Discord client is not ready');
        return res.status(503).json({
          error: 'Discord connection unavailable',
          details: 'The Discord bot is still initializing. Please try again in a few moments.'
        });
      }

      console.log('Client ready, attempting to fetch guilds...');

      // Get cached guilds first
      let guilds = client.guilds.cache;
      console.log(`Initial guild cache size: ${guilds.size}`);

      // If cache is empty, try to fetch
      if (guilds.size === 0) {
        try {
          console.log('Cache empty, fetching guilds from Discord API...');
          const fetchedGuilds = await client.guilds.fetch();
          guilds = fetchedGuilds;
          console.log(`Fetched ${guilds.size} guilds from Discord API`);
        } catch (fetchError) {
          console.error('Error fetching guilds:', fetchError);
          return res.status(500).json({
            error: 'Failed to fetch Discord servers',
            details: fetchError instanceof Error ? fetchError.message : 'Unknown error fetching servers'
          });
        }
      }

      // Map guild data
      const servers = Array.from(guilds.values()).map(guild => {
        console.log(`Processing guild: ${guild.id} - ${guild.name}`);
        return {
          id: guild.id,
          name: guild.name,
          memberCount: guild.memberCount
        };
      });

      if (servers.length === 0) {
        console.log('No servers found in the response');
        return res.status(404).json({
          error: 'No servers found',
          details: 'The bot is not a member of any Discord servers. Please add the bot to a server first.'
        });
      }

      console.log(`Returning ${servers.length} servers:`, servers);
      res.json(servers);

    } catch (error) {
      console.error('Unexpected error in /api/servers route:', error);
      res.status(500).json({ 
        error: 'Failed to fetch servers',
        details: error instanceof Error ? error.message : 'Unknown error occurred while fetching servers'
      });
    }
  });

  app.get('/api/teams', async (req, res) => {
    try {
      const { guildId } = req.query;

      if (!guildId) {
        return res.status(400).json({ error: 'Guild ID is required' });
      }

      // Get teams for specific guild using correct column names
      const allTeams = await db.select({
        id: teams.id,
        name: teams.name,
        salaryCap: teams.salary_cap,
        guildId: teams.guild_id,
        availableCap: teams.available_cap,
      })
      .from(teams)
      .where(eq(teams.guild_id, guildId as string));

      // Get players and contracts for each team
      const teamsWithStats = await Promise.all(allTeams.map(async team => {
        const teamPlayers = await db.select({
          id: players.id,
          username: players.username,
          discordId: players.discordId,
          salaryExempt: players.salaryExempt,
        })
        .from(players)
        .where(eq(players.currentTeamId, team.id));

        const teamContracts = await db.select({
          playerId: contracts.playerId,
          salary: contracts.salary,
        })
        .from(contracts)
        .where(and(
          eq(contracts.teamId, team.id),
          eq(contracts.status, 'active'),
          gte(contracts.endDate, new Date())
        ));

        const totalSalary = teamContracts.reduce((sum, contract) => {
          const player = teamPlayers.find(p => p.id === contract.playerId);
          return sum + (player?.salaryExempt ? 0 : contract.salary);
        }, 0);

        const exemptPlayers = teamPlayers
          .filter(player => player.salaryExempt)
          .map(player => ({
            username: player.username,
            discordId: player.discordId
          }));

        return {
          ...team,
          totalSalary,
          playerCount: teamPlayers.length,
          exemptPlayers
        };
      }));

      res.json(teamsWithStats);
    } catch (error) {
      console.error('Error fetching teams:', error);
      res.status(500).json({ 
        error: 'Failed to fetch teams',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get team roster with salary information
  app.get('/api/teams/:teamId/roster', async (req, res) => {
    try {
      const teamId = parseInt(req.params.teamId);

      if (isNaN(teamId)) {
        return res.status(400).json({ error: 'Invalid team ID' });
      }

      const teamPlayers = await db.query.players.findMany({
        where: and(
          eq(players.currentTeamId, teamId),
          eq(players.status, 'signed')
        ),
      });

      if (!teamPlayers) {
        console.log('No players found for team:', teamId);
        return res.json([]);
      }

      const activeContracts = await db.query.contracts.findMany({
        where: and(
          eq(contracts.teamId, teamId),
          eq(contracts.status, 'active'),
          gte(contracts.endDate, new Date())
        ),
      });

      const roster = teamPlayers.map(player => ({
        id: player.id,
        username: player.username,
        discordId: player.discordId,
        salaryExempt: player.salaryExempt,
        salary: activeContracts.find(c => c.playerId === player.id)?.salary || 0,
      }));

      res.json(roster);
    } catch (error) {
      console.error('Error fetching team roster:', error);
      res.status(500).json({ error: 'Failed to fetch team roster', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Create HTTP server with consistent port
  const httpServer = createServer(app);

  httpServer.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    startBot().catch(error => {
      console.error('Failed to start bot, but server will continue running:', error);
    });
  });

  return httpServer;
}