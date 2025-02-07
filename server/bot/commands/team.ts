import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams } from '@db/schema';
import { eq, and } from 'drizzle-orm';
import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, ComponentType } from 'discord.js';

export const TeamCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('deleteteam')
      .setDescription('Deletes a team and all associated channels/roles')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction) {
      try {
        // Get all teams from database for the current guild
        const allTeams = await db.query.teams.findMany({
          where: eq(teams.guild_id, interaction.guildId)
        });

        if (allTeams.length === 0) {
          return interaction.reply('No teams found in the database for this guild.');
        }

        // Create select menu for teams
        const teamSelect = new StringSelectMenuBuilder()
          .setCustomId('team-select')
          .setPlaceholder('Select a team to delete')
          .addOptions(
            allTeams.map(team =>
              new StringSelectMenuOptionBuilder()
                .setLabel(team.name)
                .setValue(team.id.toString())
                .setDescription(`Delete ${team.name} and all associated data`)
            )
          );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(teamSelect);

        const response = await interaction.reply({
          content: 'Please select the team you want to delete:',
          components: [row],
        });

        const confirmation = await response.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id,
          time: 30000,
          componentType: ComponentType.StringSelect,
        });

        const teamId = parseInt(confirmation.values[0]);
        const selectedTeam = allTeams.find(t => t.id === teamId);

        if (!selectedTeam) {
          return confirmation.update({
            content: 'Selected team not found.',
            components: [],
          });
        }

        let errors: string[] = [];

        // Get all players before updating
        const teamPlayers = await db.select({
          id: players.id,
        })
          .from(players)
          .where(eq(players.current_team_id, teamId));

        // Update players to free agents
        await db.update(players)
          .set({
            current_team_id: null,
            status: 'free_agent'
          })
          .where(eq(players.current_team_id, teamId));

        // Assign Free Agent role to all players
        for (const player of teamPlayers) {
          await assignFreeAgentRole(interaction, player.id);
        }

        // Delete all contracts
        try {
          await db.delete(contracts)
            .where(eq(contracts.team_id, teamId));
        } catch (error) {
          errors.push('Failed to delete contracts');
          console.error('Error deleting contracts:', error);
        }

        // Delete Discord elements
        if (interaction.guild) {
          try {
            const category = await interaction.guild.channels.cache.get(selectedTeam.discord_category_id);
            if (category) {
              const channelsInCategory = interaction.guild.channels.cache.filter(
                channel => channel.parentId === category.id
              );

              await Promise.all(
                channelsInCategory.map(channel => channel.delete())
              );

              await category.delete();
            }
          } catch (error) {
            errors.push('Failed to delete some Discord channels');
            console.error('Error deleting channels:', error);
          }

          try {
            const teamRole = interaction.guild.roles.cache.find(role => role.name === selectedTeam.name);
            if (teamRole) {
              await teamRole.delete();
            }
          } catch (error) {
            errors.push('Failed to delete team role');
            console.error('Error deleting role:', error);
          }
        }

        // Finally, delete the team
        try {
          await db.delete(teams).where(eq(teams.id, teamId));
        } catch (error) {
          errors.push('Failed to delete team from database');
          console.error('Error deleting team from database:', error);
          throw error;
        }

        const successMessage = `Team ${selectedTeam.name} has been deleted.`;
        const errorMessage = errors.length > 0
          ? `\nWarning: Some operations failed: ${errors.join(', ')}`
          : '';

        await confirmation.update({
          content: successMessage + errorMessage,
          components: [],
        });

      } catch (error) {
        console.error('Error in delete team command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.reply(`Failed to delete team: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('teaminfo')
      .setDescription('Display team information including roster and salary cap')
      .addRoleOption(option =>
        option.setName('team')
          .setDescription('The team to get information about (use @team)')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamRole = interaction.options.getRole('team', true);
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Get team information using select instead of query
        const [team] = await db.select({
          id: teams.id,
          name: teams.name,
          salaryCap: teams.salary_cap,
          availableCap: teams.available_cap,
        })
          .from(teams)
          .where(
            and(
              eq(teams.name, teamRole.name),
              eq(teams.guild_id, guildId)
            )
          );

        if (!team) {
          return interaction.editReply('Team not found in database for this guild');
        }

        // Get all players on the team with their active contracts
        const teamPlayers = await db.select({
          id: players.id,
          username: players.username,
          discordId: players.discordId,
          salaryExempt: players.salaryExempt,
        })
          .from(players)
          .where(eq(players.currentTeamId, team.id));

        // Get active contracts for the team
        const activeContracts = await db.select({
          playerId: contracts.playerId,
          salary: contracts.salary,
        })
          .from(contracts)
          .where(
            and(
              eq(contracts.teamId, team.id),
              eq(contracts.status, 'active')
            )
          );

        // Calculate total salary excluding exempt players
        const totalSalary = activeContracts.reduce((sum, contract) => {
          const player = teamPlayers.find(p => p.id === contract.playerId);
          return sum + (player?.salaryExempt ? 0 : contract.salary);
        }, 0);

        const availableCap = (team.salaryCap ?? 0) - totalSalary;

        // Create embed for team information
        const embed = new EmbedBuilder()
          .setTitle(`${team.name} Team Information`)
          .setColor('#0099ff')
          .addFields(
            {
              name: 'Salary Cap Information',
              value:
                `Total Cap: $${(team.salaryCap ?? 0).toLocaleString()}\n` +
                `Used Cap: $${totalSalary.toLocaleString()}\n` +
                `Available Cap: $${availableCap.toLocaleString()}`
            }
          );

        // Add roster information
        if (teamPlayers.length > 0) {
          // Separate exempt and non-exempt players
          const exemptPlayers = teamPlayers.filter(p => p.salaryExempt);
          const nonExemptPlayers = teamPlayers.filter(p => !p.salaryExempt);

          // Format player lists
          const formatPlayer = (player: typeof teamPlayers[0]) => {
            const playerContract = activeContracts.find(c => c.playerId === player.id);
            const salary = playerContract ? `$${playerContract.salary.toLocaleString()}` : 'No active contract';
            return `<@${player.discordId}> - ${salary}`;
          };

          if (nonExemptPlayers.length > 0) {
            embed.addFields({
              name: 'Active Roster',
              value: nonExemptPlayers.map(formatPlayer).join('\n') || 'No active players'
            });
          }

          if (exemptPlayers.length > 0) {
            embed.addFields({
              name: '🌟 Salary Cap Exempt Players',
              value: exemptPlayers.map(formatPlayer).join('\n')
            });
          }
        } else {
          embed.addFields({
            name: 'Current Roster',
            value: 'No players on roster'
          });
        }

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error displaying team info:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to get team information: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setcap')
      .setDescription('Set a team\'s salary cap')
      .addRoleOption(option =>
        option.setName('team')
          .setDescription('The team to modify (use @team)')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('New salary cap amount')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamRole = interaction.options.getRole('team', true);
        const newCap = interaction.options.getInteger('amount', true);
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        if (newCap < 0) {
          return interaction.editReply('Salary cap cannot be negative.');
        }

        const team = await db.select({
          id: teams.id,
          name: teams.name,
          salary_cap: teams.salary_cap,
        })
          .from(teams)
          .where(and(
            eq(teams.name, teamRole.name),
            eq(teams.guild_id, guildId)
          ))
          .then(rows => rows[0]);

        if (!team) {
          return interaction.editReply('Team not found in database for this guild');
        }

        await db.update(teams)
          .set({ salary_cap: newCap })
          .where(eq(teams.id, team.id));

        const embed = new EmbedBuilder()
          .setTitle('Salary Cap Updated')
          .setDescription(`Updated salary cap for ${team.name}`)
          .addFields(
            { name: 'Previous Cap', value: `$${(team.salary_cap ?? 0).toLocaleString()}` },
            { name: 'New Cap', value: `$${newCap.toLocaleString()}` }
          )
          .setColor('#00FF00')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error setting salary cap:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to set salary cap: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setfloor')
      .setDescription('Set a team\'s salary cap floor')
      .addRoleOption(option =>
        option.setName('team')
          .setDescription('The team to modify (use @team)')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('New salary cap floor amount')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamRole = interaction.options.getRole('team', true);
        const newFloor = interaction.options.getInteger('amount', true);
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        if (newFloor < 0) {
          return interaction.editReply('Salary cap floor cannot be negative.');
        }

        const team = await db.select({
          id: teams.id,
          name: teams.name,
          cap_floor: teams.cap_floor,
        })
          .from(teams)
          .where(and(
            eq(teams.name, teamRole.name),
            eq(teams.guild_id, guildId)
          ))
          .then(rows => rows[0]);

        if (!team) {
          return interaction.editReply('Team not found in database for this guild');
        }

        await db.update(teams)
          .set({ cap_floor: newFloor })
          .where(eq(teams.id, team.id));

        await interaction.editReply(`Updated salary cap floor for ${team.name} to $${newFloor.toLocaleString()}`);

      } catch (error) {
        console.error('Error setting cap floor:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to set cap floor: ${errorMessage}`);
      }
    },
  },
];

// Helper function for assigning free agent role
async function assignFreeAgentRole(interaction: ChatInputCommandInteraction, playerId: number) {
  try {
    const player = await db.query.players.findFirst({
      where: eq(players.id, playerId),
    });

    if (!player || !interaction.guild) return;

    const member = await interaction.guild.members.fetch(player.discord_id);
    const freeAgentRole = interaction.guild.roles.cache.find(role => role.name === 'Free Agent');

    if (freeAgentRole && member) {
      await member.roles.add(freeAgentRole);
    }
  } catch (error) {
    console.error('Error assigning free agent role:', error);
  }
}