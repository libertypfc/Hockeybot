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

        // Get both teams with full details
        const fromTeam = await db.select({
          id: teams.id,
          name: teams.name,
          availableCap: teams.availableCap,
        })
        .from(teams)
        .where(eq(teams.name, fromTeamRole.name))
        .then(rows => rows[0]);

        const toTeam = await db.select({
          id: teams.id,
          name: teams.name,
          availableCap: teams.availableCap,
        })
        .from(teams)
        .where(eq(teams.name, toTeamRole.name))
        .then(rows => rows[0]);

        if (!fromTeam || !toTeam) {
          return interaction.editReply('Invalid team name(s)');
        }

        // Get player with their active contract
        const player = await db.query.players.findFirst({
          where: eq(players.discordId, user.id),
          with: {
            activeContracts: {
              where: eq(contracts.status, 'active'),
            },
          },
        });

        if (!player) {
          return interaction.editReply('Player not found in database');
        }

        if (!player.activeContracts || player.activeContracts.length === 0) {
          return interaction.editReply('Player has no active contract');
        }

        const activeContract = player.activeContracts[0];

        // Verify receiving team has enough cap space
        if (!player.salaryExempt) {
          const receivingTeamAvailableCap = toTeam.availableCap ?? 0;
          if (receivingTeamAvailableCap < activeContract.salary) {
            return interaction.editReply(
              `Trade failed: ${toTeam.name} does not have enough cap space. ` +
              `Need: $${activeContract.salary.toLocaleString()}, ` +
              `Available: $${receivingTeamAvailableCap.toLocaleString()}`
            );
          }
        }

        // Update cap space for both teams if player is not salary exempt
        if (!player.salaryExempt) {
          // Add cap space back to the sending team
          await db.update(teams)
            .set({
              availableCap: (fromTeam.availableCap ?? 0) + activeContract.salary
            })
            .where(eq(teams.id, fromTeam.id));

          // Subtract cap space from receiving team
          await db.update(teams)
            .set({
              availableCap: (toTeam.availableCap ?? 0) - activeContract.salary
            })
            .where(eq(teams.id, toTeam.id));
        }

        // Update player's team
        await db.update(players)
          .set({ currentTeamId: toTeam.id })
          .where(eq(players.id, player.id));

        // Update contract's team
        await db.update(contracts)
          .set({ teamId: toTeam.id })
          .where(eq(contracts.id, activeContract.id));

        // Update Discord roles
        const member = await interaction.guild?.members.fetch(user.id);
        if (member) {
          // Remove old team role
          if ('id' in fromTeamRole) {
            await member.roles.remove(fromTeamRole.id);
          }

          // Add new team role
          if ('id' in toTeamRole) {
            await member.roles.add(toTeamRole.id);
          }
        }

        // Create trade announcement embed
        const embed = new EmbedBuilder()
          .setTitle('🔄 Trade Announcement')
          .setDescription(`${user} has been traded from ${fromTeamRole} to ${toTeamRole}`)
          .addFields(
            { 
              name: 'Contract Details', 
              value: player.salaryExempt ? 
                '🌟 Player is salary cap exempt' : 
                `Salary: $${activeContract.salary.toLocaleString()}`
            },
            {
              name: 'Cap Space After Trade',
              value: player.salaryExempt ? 
                'No cap space affected (exempt player)' :
                `${fromTeam.name}: $${((fromTeam.availableCap ?? 0) + activeContract.salary).toLocaleString()}\n` +
                `${toTeam.name}: $${((toTeam.availableCap ?? 0) - activeContract.salary).toLocaleString()}`
            }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Notify the player via DM
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle('🏒 Trade Notification')
            .setDescription(`You have been traded from ${fromTeam.name} to ${toTeam.name}`)
            .addFields(
              { 
                name: 'Contract Status', 
                value: `Your current contract of $${activeContract.salary.toLocaleString()} has been transferred to your new team.`
              }
            )
            .setTimestamp();

          await user.send({ embeds: [dmEmbed] });
        } catch (error) {
          console.warn(`[Warning] Could not send trade DM to ${user.tag}`, error);
        }

      } catch (error) {
        console.error('[Error] Error processing trade:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to process trade: ${errorMessage}`);
      }
    },
  },
];