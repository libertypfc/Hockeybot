import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { players, teams, contracts } from '@db/schema';
import { eq, and } from 'drizzle-orm';

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
        const fromTeam = await db.select({
          id: teams.id,
          name: teams.name,
          availableCap: teams.availableCap,
          salaryCap: teams.salaryCap,
        })
        .from(teams)
        .where(eq(teams.name, fromTeamRole.name))
        .then(rows => rows[0]);

        const toTeam = await db.select({
          id: teams.id,
          name: teams.name,
          availableCap: teams.availableCap,
          salaryCap: teams.salaryCap,
        })
        .from(teams)
        .where(eq(teams.name, toTeamRole.name))
        .then(rows => rows[0]);

        if (!fromTeam || !toTeam) {
          return interaction.editReply('Invalid team name(s)');
        }

        // Get player and their active contract
        const player = await db.query.players.findFirst({
          where: and(
            eq(players.discordId, user.id),
            eq(players.currentTeamId, fromTeam.id)
          ),
          with: {
            contracts: {
              where: eq(contracts.status, 'active'),
            },
          },
        });

        if (!player) {
          return interaction.editReply('Player not found or not on the trading team');
        }

        const activeContract = player.contracts[0];
        if (!activeContract) {
          return interaction.editReply('Player does not have an active contract');
        }

        // Calculate salary impact based on player's exempt status
        const playerSalary = activeContract.salary; // Always transfer full salary

        // Check if receiving team has enough cap space
        if (!player.salaryExempt && toTeam.availableCap! < playerSalary) {
          return interaction.editReply(`${toTeamRole} does not have enough cap space for this trade. They need $${playerSalary.toLocaleString()} in space.`);
        }

        // Update team cap space - salary always moves with the player
        await db.update(teams)
          .set({
            availableCap: fromTeam.availableCap! + playerSalary
          })
          .where(eq(teams.id, fromTeam.id));

        await db.update(teams)
          .set({
            availableCap: toTeam.availableCap! - playerSalary
          })
          .where(eq(teams.id, toTeam.id));

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
          if ('id' in fromTeamRole) {
            await member.roles.remove(fromTeamRole.id);
          }
          if ('id' in toTeamRole) {
            await member.roles.add(toTeamRole.id);
          }
        }

        const tradeEmbed = new EmbedBuilder()
          .setTitle('🔄 Trade Completed')
          .setDescription(`${user} has been traded from ${fromTeamRole} to ${toTeamRole}`)
          .addFields(
            { name: 'Salary', value: `$${playerSalary.toLocaleString()}`, inline: true },
            { name: 'Status', value: player.salaryExempt ? '🏷️ Salary Exempt' : '💰 Counts Against Cap', inline: true },
            { name: `${fromTeam.name} Cap Space`, value: `$${(fromTeam.availableCap! + playerSalary).toLocaleString()}`, inline: true },
            { name: `${toTeam.name} Cap Space`, value: `$${(toTeam.availableCap! - playerSalary).toLocaleString()}`, inline: true }
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