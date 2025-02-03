import { SlashCommandBuilder, ChatInputCommandInteraction, Role } from 'discord.js';
import { db } from '@db';
import { players, teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const TradeCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('trade')
      .setDescription('Trade a player between teams')
      .addRoleOption(option =>
        option.setName('from_team')
          .setDescription('Team trading the player (use @team)')
          .setRequired(true))
      .addUserOption(option =>
        option.setName('player')
          .setDescription('Player being traded')
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('to_team')
          .setDescription('Team receiving the player (use @team)')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      const fromTeamRole = interaction.options.getRole('from_team', true);
      const toTeamRole = interaction.options.getRole('to_team', true);
      const user = interaction.options.getUser('player', true);

      // Validate teams
      const fromTeam = await db.query.teams.findFirst({
        where: eq(teams.name, fromTeamRole.name),
      });

      const toTeam = await db.query.teams.findFirst({
        where: eq(teams.name, toTeamRole.name),
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

      if (member) {
        // Remove old team role
        if (fromTeamRole) {
          await member.roles.remove(fromTeamRole);
        }

        // Add new team role
        if (toTeamRole) {
          await member.roles.add(toTeamRole);
        }
      }

      await interaction.reply(
        `${user} has been traded from ${fromTeamRole} to ${toTeamRole}`
      );
    },
  },
];