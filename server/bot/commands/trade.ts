import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { players, teams, contracts } from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';

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
      await interaction.deferReply();

      try {
        const fromTeamRole = interaction.options.getRole('from_team', true);
        const toTeamRole = interaction.options.getRole('to_team', true);
        const user = interaction.options.getUser('player', true);

        // Get both teams with their cap information
        const fromTeam = await db.query.teams.findFirst({
          where: eq(teams.name, fromTeamRole.name),
        });

        const toTeam = await db.query.teams.findFirst({
          where: eq(teams.name, toTeamRole.name),
        });

        if (!fromTeam || !toTeam) {
          return interaction.editReply('Invalid team name(s)');
        }

        // Get player and their active contract
        const player = await db.query.players.findFirst({
          where: and(
            eq(players.discordId, user.id),
            eq(players.currentTeamId, fromTeam.id)
          ),
        });

        if (!player) {
          return interaction.editReply('Player not found or not on the trading team');
        }

        // Get active contract
        const activeContract = await db.query.contracts.findFirst({
          where: and(
            eq(contracts.playerId, player.id),
            eq(contracts.status, 'active')
          ),
        });

        if (!activeContract) {
          return interaction.editReply('Player does not have an active contract');
        }

        // Calculate salary impact
        const playerSalary = activeContract.salary;

        // Check if receiving team has enough cap space
        if (!player.salaryExempt && (toTeam.availableCap ?? 0) < playerSalary) {
          return interaction.editReply(`${toTeamRole} does not have enough cap space for this trade. They need $${playerSalary.toLocaleString()} in space.`);
        }

        // Update team cap space only if player is not salary exempt
        if (!player.salaryExempt) {
          // Give cap space back to trading team
          await db.update(teams)
            .set({
              availableCap: sql`${teams.availableCap} + ${playerSalary}`,
            })
            .where(eq(teams.id, fromTeam.id));

          // Remove cap space from receiving team
          await db.update(teams)
            .set({
              availableCap: sql`${teams.availableCap} - ${playerSalary}`,
            })
            .where(eq(teams.id, toTeam.id));
        }

        // Update player's team and contract
        await db.update(players)
          .set({ currentTeamId: toTeam.id })
          .where(eq(players.id, player.id));

        await db.update(contracts)
          .set({ teamId: toTeam.id })
          .where(eq(contracts.id, activeContract.id));

        // Update Discord roles
        const member = await interaction.guild?.members.fetch(user.id);
        if (member) {
          await member.roles.remove(fromTeamRole);
          await member.roles.add(toTeamRole);
        }

        const tradeEmbed = new EmbedBuilder()
          .setTitle('🔄 Trade Completed')
          .setDescription(`${user} has been traded from ${fromTeamRole} to ${toTeamRole}`)
          .addFields(
            { name: 'Salary', value: `$${playerSalary.toLocaleString()}`, inline: true },
            { name: 'Status', value: player.salaryExempt ? '🏷️ Salary Exempt' : '💰 Counts Against Cap', inline: true },
            { name: `${fromTeam.name} Cap Space`, value: `$${(fromTeam.availableCap! + (player.salaryExempt ? 0 : playerSalary)).toLocaleString()}`, inline: true },
            { name: `${toTeam.name} Cap Space`, value: `$${(toTeam.availableCap! - (player.salaryExempt ? 0 : playerSalary)).toLocaleString()}`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [tradeEmbed] });
      } catch (error) {
        console.error('[Error] Error processing trade:', error);
        await interaction.editReply('Failed to process trade. Please try again.');
      }
    },
  },
];