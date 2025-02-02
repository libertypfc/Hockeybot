import { SlashCommandBuilder, ChatInputCommandInteraction, Role } from 'discord.js';
import { db } from '@db';
import { players, teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const TradeCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('trade')
      .setDescription('Trade a player between teams')
      .addStringOption(option =>
        option.setName('from_team')
          .setDescription('Team trading the player')
          .setRequired(true))
      .addUserOption(option =>
        option.setName('player')
          .setDescription('Player being traded')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('to_team')
          .setDescription('Team receiving the player')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      const fromTeamName = interaction.options.getString('from_team', true);
      const toTeamName = interaction.options.getString('to_team', true);
      const user = interaction.options.getUser('player', true);

      // Validate teams
      const fromTeam = await db.query.teams.findFirst({
        where: eq(teams.name, fromTeamName),
      });

      const toTeam = await db.query.teams.findFirst({
        where: eq(teams.name, toTeamName),
      });

      if (!fromTeam || !toTeam) {
        return interaction.reply('Invalid team name(s)');
      }

      // Get player
      const player = await db.query.players.findFirst({
        where: eq(players.discordId, user.id),
      });

      if (!player) {
        return interaction.reply('Player not found in database');
      }

      // Update player's team
      await db.update(players)
        .set({ currentTeamId: toTeam.id })
        .where(eq(players.id, player.id));

      // Update Discord roles
      const member = await interaction.guild?.members.fetch(user.id);

      const oldRole = interaction.guild?.roles.cache.find(
        (role: Role) => role.name === fromTeamName
      );

      const newRole = interaction.guild?.roles.cache.find(
        (role: Role) => role.name === toTeamName
      );

      if (oldRole && member) {
        await member.roles.remove(oldRole);
      }

      if (newRole && member) {
        await member.roles.add(newRole);
      }

      await interaction.reply(
        `${user} has been traded from ${fromTeamName} to ${toTeamName}`
      );
    },
  },
];