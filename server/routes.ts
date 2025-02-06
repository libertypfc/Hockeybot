import type { Express } from "express";
import { createServer, type Server } from "http";
import { startBot } from './bot';
import { db } from '@db';
import { teams, players, contracts } from '@db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { Client, GatewayIntentBits } from 'discord.js';

let discordClient: Client | null = null;

async function getDiscordClient() {
  if (!discordClient) {
    discordClient = new Client({ 
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
      ] 
    });
    await discordClient.login(process.env.DISCORD_TOKEN);
  }
  return discordClient;
}

export function registerRoutes(app: Express): Server {
  const port = process.env.PORT || 3000;

  // API Routes
  app.get('/api/servers', async (req, res) => {
    try {
      const client = await getDiscordClient();
      const guilds = await client.guilds.fetch();
      console.log('Fetched guilds:', Array.from(guilds.values()));

      const servers = Array.from(guilds.values()).map(guild => ({
        id: guild.id,
        name: guild.name
      }));

      console.log('Sending servers:', servers);
      res.json(servers);
    } catch (error) {
      console.error('Error fetching servers:', error);
      res.status(500).json({ error: 'Failed to fetch servers' });
    }
  });

  app.get('/api/teams', async (req, res) => {
    try {
      const { guildId } = req.query;

      if (!guildId) {
        return res.status(400).json({ error: 'Guild ID is required' });
      }

      console.log('Fetching teams for guild:', guildId);

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

      console.log('Found teams:', allTeams);

      // Get players and contracts for each team
      const teamsWithStats = await Promise.all(allTeams.map(async team => {
        // Get players for this team
        const teamPlayers = await db.select({
          id: players.id,
          username: players.username,
          discordId: players.discordId,
          salaryExempt: players.salaryExempt,
        })
        .from(players)
        .where(eq(players.currentTeamId, team.id));

        console.log(`Players for team ${team.name}:`, teamPlayers);

        // Get active contracts for this team
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

        console.log(`Contracts for team ${team.name}:`, teamContracts);

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
          id: team.id,
          name: team.name,
          salaryCap: team.salaryCap || 82500000,
          availableCap: (team.salaryCap || 82500000) - totalSalary,
          totalSalary,
          playerCount: teamPlayers.length,
          exemptPlayers
        };
      }));

      console.log('Final response:', teamsWithStats);
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

      // Get all signed players for this team
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

      // Get active contracts for all players
      const activeContracts = await db.query.contracts.findMany({
        where: and(
          eq(contracts.teamId, teamId),
          eq(contracts.status, 'active'),
          gte(contracts.endDate, new Date())
        ),
      });


      // Map players with their contract information
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
      res.status(500).json({ error: 'Failed to fetch team roster' });
    }
  });

  // Create HTTP server with consistent port
  const httpServer = createServer(app);

  httpServer.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    startBot().then(() => {
      console.log('Bot started successfully after server initialization');
    }).catch(error => {
      console.error('Failed to start bot:', error);
      console.error('Bot startup failed but server will continue running');
    });
  });

  return httpServer;
}