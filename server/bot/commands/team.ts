import { SlashCommandBuilder, ChannelType, PermissionFlagsBits, ChatInputCommandInteraction, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { teams, players, contracts } from '@db/schema';
import { eq, and } from 'drizzle-orm';

export const TeamCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('createteam')
      .setDescription('Creates a new team with all required channels')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the team')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamName = interaction.options.getString('name', true);

        // Create category
        const category = await interaction.guild?.channels.create({
          name: teamName,
          type: ChannelType.GuildCategory,
        });

        if (!category || !interaction.guild) {
          return interaction.editReply('Failed to create team category');
        }

        // Create text and voice channels
        const channels = [
          ['team-chat', ChannelType.GuildText],
          ['signing', ChannelType.GuildText],
          ['roster', ChannelType.GuildText],
          ['team-voice', ChannelType.GuildVoice],
        ] as const;

        // Create all standard channels in parallel
        await Promise.all(channels.map(([name, type]) =>
          interaction.guild!.channels.create({
            name,
            type,
            parent: category.id,
          })
        ));

        // Create media channel with specific settings
        await interaction.guild.channels.create({
          name: 'stats-pictures',
          type: ChannelType.GuildMedia,
          parent: category.id,
          rateLimitPerUser: 30, // 30 seconds slowmode to prevent spam
          nsfw: false,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
              ],
              deny: [
                PermissionFlagsBits.CreatePublicThreads,
                PermissionFlagsBits.CreatePrivateThreads,
              ]
            }
          ]
        });

        // Create team role
        const role = await interaction.guild.roles.create({
          name: teamName,
          mentionable: true,
        });

        // Save team to database
        await db.insert(teams).values({
          name: teamName,
          discordCategoryId: category.id,
          salaryCap: 82_500_000, // NHL salary cap as default
          availableCap: 82_500_000,
        });

        await interaction.editReply(`Team ${teamName} has been created successfully with all channels and roles!`);
      } catch (error) {
        console.error('Error creating team:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create team: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('deleteteam')
      .setDescription('Deletes a team and all associated channels/roles')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction) {
      try {
        // Get all teams from database
        const allTeams = await db.query.teams.findMany();

        if (allTeams.length === 0) {
          return interaction.reply('No teams found in the database.');
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

        try {
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

          // 1. Update all players on this team to free agents
          try {
            await db.update(players)
              .set({
                currentTeamId: null,
                status: 'free_agent'
              })
              .where(eq(players.currentTeamId, teamId));
          } catch (error) {
            errors.push('Failed to update players');
            console.error('Error updating players:', error);
          }

          // 2. Delete all contracts associated with this team
          try {
            await db.delete(contracts)
              .where(eq(contracts.teamId, teamId));
          } catch (error) {
            errors.push('Failed to delete contracts');
            console.error('Error deleting contracts:', error);
          }

          // 3. Delete Discord elements
          if (interaction.guild) {
            // Delete channels in category
            try {
              const category = await interaction.guild.channels.cache.get(selectedTeam.discordCategoryId);
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

            // Delete team role
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

          // 4. Finally, delete the team from database
          try {
            await db.delete(teams).where(eq(teams.id, teamId));
          } catch (error) {
            errors.push('Failed to delete team from database');
            console.error('Error deleting team from database:', error);
            throw error; // This is critical, so we throw
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
          if (error instanceof Error && error.message.includes('time')) {
            await interaction.editReply({
              content: 'Timed out! Please try the command again.',
              components: [],
            });
          } else {
            console.error('Error in team deletion:', error);
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            await interaction.editReply({
              content: `Failed to delete team: ${errorMessage}`,
              components: [],
            });
          }
        }
      } catch (error) {
        console.error('Critical error in delete team command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.reply(`Failed to load teams: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clearteam')
      .setDescription('Remove a team and all its data from the database')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the team to clear')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamName = interaction.options.getString('name', true);

        // Get team from database
        const team = await db.query.teams.findFirst({
          where: eq(teams.name, teamName)
        });

        if (!team) {
          return interaction.editReply(`Team "${teamName}" not found in database`);
        }

        // Update all players on this team to free agents
        await db.update(players)
          .set({
            currentTeamId: null,
            status: 'free_agent'
          })
          .where(eq(players.currentTeamId, team.id));

        // Delete all contracts associated with this team
        await db.delete(contracts)
          .where(eq(contracts.teamId, team.id));

        // Finally, delete the team
        await db.delete(teams)
          .where(eq(teams.id, team.id));

        await interaction.editReply(`Team ${teamName} has been cleared from the database. All players have been set to free agents.`);

      } catch (error) {
        console.error('Error clearing team:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to clear team: ${errorMessage}`);
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

        // Get team information
        const team = await db.query.teams.findFirst({
          where: eq(teams.name, teamRole.name),
        });

        if (!team) {
          return interaction.editReply('Team not found in database');
        }

        // Get all players on the team with their active contracts
        const teamPlayers = await db.query.players.findMany({
          where: eq(players.currentTeamId, team.id),
          with: {
            currentTeam: true,
          },
        });

        // Get active contracts for the team
        const activeContracts = await db.query.contracts.findMany({
          where: and(
            eq(contracts.teamId, team.id),
            eq(contracts.status, 'active')
          ),
        });

        // Calculate total salary
        const totalSalary = activeContracts.reduce((sum, contract) => sum + contract.salary, 0);
        const availableCap = team.salaryCap - totalSalary;

        // Create embed for team information
        const embed = new EmbedBuilder()
          .setTitle(`${team.name} Team Information`)
          .setColor('#0099ff')
          .addFields(
            { 
              name: 'Salary Cap Information', 
              value: 
                `Total Cap: $${team.salaryCap.toLocaleString()}\n` +
                `Used Cap: $${totalSalary.toLocaleString()}\n` +
                `Available Cap: $${availableCap.toLocaleString()}`
            }
          );

        // Add roster information
        if (teamPlayers.length > 0) {
          const playerList = teamPlayers.map(player => {
            const playerContract = activeContracts.find(c => c.playerId === player.id);
            const salary = playerContract ? `$${playerContract.salary.toLocaleString()}` : 'No active contract';
            return `<@${player.discordId}> - ${salary}`;
          }).join('\n');

          embed.addFields({ 
            name: 'Current Roster', 
            value: playerList || 'No players on roster'
          });
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
];