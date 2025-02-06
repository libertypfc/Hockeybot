import { SlashCommandBuilder, ChannelType, PermissionFlagsBits, ChatInputCommandInteraction, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { teams, players, contracts } from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';

async function assignFreeAgentRole(interaction: ChatInputCommandInteraction, playerId: number) {
  try {
    const player = await db.select({
      discordId: players.discordId,
    })
    .from(players)
    .where(eq(players.id, playerId))
    .then(rows => rows[0]);

    if (!player || !interaction.guild) return;

    const member = await interaction.guild.members.fetch(player.discordId);
    const freeAgentRole = interaction.guild.roles.cache.find(role => role.name === "Free Agent");

    if (!freeAgentRole) {
      // Create Free Agent role if it doesn't exist
      await interaction.guild.roles.create({
        name: "Free Agent",
        color: "#808080", // Gray color
        reason: "Required for free agent players"
      });
    }

    if (member && freeAgentRole) {
      await member.roles.add(freeAgentRole);
    }
  } catch (error) {
    console.error('Error assigning Free Agent role:', error);
  }
}

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
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command can only be used in a server.');
        }

        console.log('Creating team with name:', teamName, 'in guild:', guildId);
        console.log('Guild info:', {
          guildId,
          guildName: interaction.guild?.name,
          botPermissions: interaction.guild?.members.me?.permissions.toArray()
        });

        // Check if team name already exists in this guild
        const existingTeam = await db.select({
          id: teams.id
        })
        .from(teams)
        .where(and(
          eq(teams.name, teamName),
          eq(teams.guildId, guildId)
        ))
        .then(rows => rows[0]);

        console.log('Existing team check result:', existingTeam);

        if (existingTeam) {
          return interaction.editReply(`A team named "${teamName}" already exists in this server.`);
        }

        // Create category
        const category = await interaction.guild?.channels.create({
          name: teamName,
          type: ChannelType.GuildCategory,
        });

        if (!category || !interaction.guild) {
          console.error('Failed to create category or guild is not available');
          return interaction.editReply('Failed to create team category');
        }

        console.log('Created category:', category.id);

        // Create channels
        const channels = [
          ['team-chat', ChannelType.GuildText],
          ['signing', ChannelType.GuildText],
          ['roster', ChannelType.GuildText],
          ['stats-pictures', ChannelType.GuildText],
          ['team-voice', ChannelType.GuildVoice],
        ] as const;

        await Promise.all(channels.map(([name, type]) =>
          interaction.guild!.channels.create({
            name,
            type,
            parent: category.id,
            ...(name === 'stats-pictures' ? {
              rateLimitPerUser: 30,
              nsfw: false,
              permissionOverwrites: [
                {
                  id: interaction.guild!.roles.everyone.id,
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
            } : {})
          })
        ));

        console.log('Created all channels for team');

        // Create team role
        const role = await interaction.guild.roles.create({
          name: teamName,
          mentionable: true,
        });

        console.log('Created team role:', role.id);

        try {
          console.log('Attempting to save team to database with data:', {
            name: teamName,
            discordCategoryId: category.id,
            guildId: guildId,
            salaryCap: 82_500_000,
            availableCap: 82_500_000,
          });

          // Save team to database with guildId
          const [newTeam] = await db.insert(teams).values({
            name: teamName,
            discordCategoryId: category.id,
            guildId: guildId,
            salaryCap: 82_500_000,
            availableCap: 82_500_000,
          }).returning();

          console.log('Successfully saved team to database:', newTeam);

          const embed = new EmbedBuilder()
            .setTitle('Team Created')
            .setDescription(`Team "${teamName}" has been created successfully!`)
            .addFields(
              { name: 'Category', value: category.name },
              { name: 'Role', value: role.name },
              { name: 'Guild ID', value: guildId }
            )
            .setColor('#00FF00')
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
        } catch (dbError) {
          console.error('Database error while saving team:', dbError);
          throw dbError;
        }
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
        // Get all teams from database for the current guild
        const allTeams = await db.query.teams.findMany({
          where: eq(teams.guildId, interaction.guildId)
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

          const teamPlayers = await db.select({
            id: players.id,
          })
          .from(players)
          .where(eq(players.currentTeamId, teamId));

          await db.update(players)
            .set({
              currentTeamId: null,
              status: 'free_agent'
            })
            .where(eq(players.currentTeamId, teamId));

          // Assign Free Agent role to all players
          for (const player of teamPlayers) {
            await assignFreeAgentRole(interaction, player.id);
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
        const guildId = interaction.guildId; //get guildId

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Get team from database, filtering by guildId
        const team = await db.select({
          id: teams.id,
          name: teams.name,
        })
        .from(teams)
        .where(and(
          eq(teams.name, teamName),
          eq(teams.guildId, guildId)
        ))
        .then(rows => rows[0]);

        if (!team) {
          return interaction.editReply(`Team "${teamName}" not found in database for this guild`);
        }

        // Get all players before updating
        const teamPlayers = await db.select({
          id: players.id,
        })
        .from(players)
        .where(eq(players.currentTeamId, team.id));


        // Update all players on this team to free agents
        await db.update(players)
          .set({
            currentTeamId: null,
            status: 'free_agent'
          })
          .where(eq(players.currentTeamId, team.id));

        // Assign Free Agent role to all affected players
        for (const player of teamPlayers) {
          await assignFreeAgentRole(interaction, player.id);
        }

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
        const guildId = interaction.guildId; //get guildId

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Get team information with explicit field selection, filtering by guildId
        const team = await db.select({
          id: teams.id,
          name: teams.name,
          salaryCap: teams.salaryCap,
          availableCap: teams.availableCap,
        })
        .from(teams)
        .where(and(
          eq(teams.name, teamRole.name),
          eq(teams.guildId, guildId)
        ))
        .then(rows => rows[0]);

        if (!team) {
          return interaction.editReply('Team not found in database for this guild');
        }

        // Get all players on the team with their active contracts
        const teamPlayers = await db.query.players.findMany({
          where: eq(players.currentTeamId, team.id),
          columns: {
            id: true,
            username: true,
            discordId: true,
            salaryExempt: true,
          },
        });

        // Get active contracts for the team
        const activeContracts = await db.select({
          playerId: contracts.playerId,
          salary: contracts.salary,
        })
        .from(contracts)
        .where(and(
          eq(contracts.teamId, team.id),
          eq(contracts.status, 'active')
        ));

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

          // Add non-exempt players
          if (nonExemptPlayers.length > 0) {
            embed.addFields({
              name: 'Active Roster',
              value: nonExemptPlayers.map(formatPlayer).join('\n') || 'No active players'
            });
          }

          // Add exempt players with special indicator
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
      .setName('exemptplayer')
      .setDescription('Set a player as salary cap exempt'),

    async execute(interaction: ChatInputCommandInteraction) {
      try {
        const guildId = interaction.guildId; //get guildId

        if (!guildId) {
          return interaction.reply('This command must be run in a guild.');
        }

        // Get all teams from database for the current guild
        const allTeams = await db.query.teams.findMany({
          with: {
            players: {
              where: eq(players.status, 'signed'),
            },
          },
          where: eq(teams.guildId, guildId)
        });

        if (allTeams.length === 0) {
          return interaction.reply('No teams found in the database for this guild.');
        }

        // Create select menu for teams
        const teamSelect = new StringSelectMenuBuilder()
          .setCustomId('team-select')
          .setPlaceholder('Select a team')
          .addOptions(
            allTeams.map(team =>
              new StringSelectMenuOptionBuilder()
                .setLabel(team.name)
                .setValue(team.id.toString())
                .setDescription(`Select ${team.name} to manage exemptions`)
            )
          );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(teamSelect);

        const response = await interaction.reply({
          content: 'Please select a team to manage salary exemptions:',
          components: [row],
        });

        try {
          const teamSelection = await response.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 30000,
            componentType: ComponentType.StringSelect,
          });

          const selectedTeamId = parseInt(teamSelection.values[0]);
          const selectedTeam = allTeams.find(t => t.id === selectedTeamId);

          if (!selectedTeam) {
            return teamSelection.update({
              content: 'Selected team not found.',
              components: [],
            });
          }

          // Get all signed players for this team
          const teamPlayers = await db.query.players.findMany({
            where: and(
              eq(players.currentTeamId, selectedTeamId),
              eq(players.status, 'signed')
            ),
          });

          if (teamPlayers.length === 0) {
            return teamSelection.update({
              content: 'No signed players found for this team.',
              components: [],
            });
          }

          // Create select menu for players
          const playerSelect = new StringSelectMenuBuilder()
            .setCustomId('player-select')
            .setPlaceholder('Select a player')
            .addOptions(
              teamPlayers.map(player =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(player.username)
                  .setValue(player.id.toString())
                  .setDescription(player.salaryExempt ? 'Currently Exempt' : 'Not Exempt')
              )
            );

          const playerRow = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(playerSelect);

          await teamSelection.update({
            content: `Select a player from ${selectedTeam.name} to toggle salary exemption:`,
            components: [playerRow],
          });

          const playerSelection = await response.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 30000,
            componentType: ComponentType.StringSelect,
          });

          const selectedPlayerId = parseInt(playerSelection.values[0]);
          const selectedPlayer = teamPlayers.find(p => p.id === selectedPlayerId);

          if (!selectedPlayer) {
            return playerSelection.update({
              content: 'Selected player not found.',
              components: [],
            });
          }

          // Count current exempt players
          const exemptCount = await db.query.players.findMany({
            where: and(
              eq(players.currentTeamId, selectedTeamId),
              eq(players.salaryExempt, true)
            ),
          });

          if (exemptCount.length >= 2 && !selectedPlayer.salaryExempt) {
            return playerSelection.update({
              content: 'Team already has 2 salary exempt players. Remove an exempt player before adding another.',
              components: [],
            });
          }

          // Toggle exempt status
          await db.update(players)
            .set({
              salaryExempt: !selectedPlayer.salaryExempt
            })
            .where(eq(players.id, selectedPlayerId));

          // Get active contract for salary adjustment
          const activeContract = await db.query.contracts.findFirst({
            where: and(
              eq(contracts.playerId, selectedPlayerId),
              eq(contracts.status, 'active')
            ),
          });

          if (activeContract) {
            // Update team's available cap space based on exemption status
            const capAdjustment = selectedPlayer.salaryExempt ? -activeContract.salary : activeContract.salary;
            await db.update(teams)
              .set({
                availableCap: sql`${teams.availableCap} + ${capAdjustment}`
              })
              .where(eq(teams.id, selectedTeamId));
          }

          const status = selectedPlayer.salaryExempt ? 'removed from' : 'added to';
          await playerSelection.update({
            content: `${selectedPlayer.username} has been ${status} salary cap exemption for ${selectedTeam.name}.\nThe team's available cap space has been adjusted accordingly.`,
            components: [],
          });

        } catch (error) {
          if (error instanceof Error && error.message.includes('time')) {
            await interaction.editReply({
              content: 'Timed out! Please try the command again.',
              components: [],
            });
          } else {
            console.error('Error in exemption process:', error);
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            await interaction.editReply({
              content: `Failed to manage player exemption: ${errorMessage}`,
              components: [],
            });
          }
        }

      } catch (error) {
        console.error('Error in exemptplayer command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.reply(`Failed to start exemption process: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('removeplayer')
      .setDescription('Remove a player from a team'),

    async execute(interaction: ChatInputCommandInteraction) {
      try {
        const guildId = interaction.guildId; //get guildId

        if (!guildId) {
          return interaction.reply('This command must be run in a guild.');
        }

        // Get all teams from database for the current guild
        const allTeams = await db.query.teams.findMany({
          with: {
            players: {
              where: eq(players.status, 'signed'),
            },
          },
          where: eq(teams.guildId, guildId)
        });

        if (allTeams.length === 0) {
          return interaction.reply('No teams found in the database for this guild.');
        }

        // Create select menu for teams
        const teamSelect = new StringSelectMenuBuilder()
          .setCustomId('team-select')
          .setPlaceholder('Select a team')
          .addOptions(
            allTeams.map(team =>
              new StringSelectMenuOptionBuilder()
                .setLabel(team.name)
                .setValue(team.id.toString())
                .setDescription(`Select ${team.name} to remove a player`)
            )
          );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(teamSelect);

        const response = await interaction.reply({
          content: 'Please select a team:',
          components: [row],
        });

        try {
          const teamSelection = await response.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 30000,
            componentType: ComponentType.StringSelect,
          });

          const selectedTeamId = parseInt(teamSelection.values[0]);
          const selectedTeam = allTeams.find(t => t.id === selectedTeamId);

          if (!selectedTeam) {
            return teamSelection.update({
              content: 'Selected team not found.',
              components: [],
            });
          }

          // Get all signed players for this team
          const teamPlayers = await db.query.players.findMany({
            where: and(
              eq(players.currentTeamId, selectedTeamId),
              eq(players.status, 'signed')
            ),
          });

          if (teamPlayers.length === 0) {
            return teamSelection.update({
              content: 'No signed players found for this team.',
              components: [],
            });
          }

          // Create select menu for players
          const playerSelect = new StringSelectMenuBuilder()
            .setCustomId('player-select')
            .setPlaceholder('Select a player')
            .addOptions(
              teamPlayers.map(player =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(player.username)
                  .setValue(player.id.toString())
                  .setDescription(`Remove ${player.username} from the team`)
              )
            );

          const playerRow = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(playerSelect);

          await teamSelection.update({
            content: `Select a player to remove from ${selectedTeam.name}:`,
            components: [playerRow],
          });

          const playerSelection = await response.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 30000,
            componentType: ComponentType.StringSelect,
          });

          const selectedPlayerId = parseInt(playerSelection.values[0]);
          const selectedPlayer = teamPlayers.find(p => p.id === selectedPlayerId);

          if (!selectedPlayer) {
            return playerSelection.update({
              content: 'Selected player not found.',
              components: [],
            });
          }

          // After setting player as free agent
          await db.update(players)
            .set({
              currentTeamId: null,
              status: 'free_agent',
              salaryExempt: false
            })
            .where(eq(players.id, selectedPlayerId));

          await assignFreeAgentRole(interaction, selectedPlayerId);

          // Terminate any active contracts
          await db.update(contracts)
            .set({ status: 'terminated' })
            .where(and(
              eq(contracts.playerId, selectedPlayerId),
              eq(contracts.status, 'active')
            ));

          // Remove team role from the player in Discord
          const guild = interaction.guild;
          if (guild) {
            const member = await guild.members.fetch(selectedPlayer.discordId);
            const teamRole = guild.roles.cache.find(
              role => role.name === selectedTeam.name
            );

            if (teamRole && member) {
              await member.roles.remove(teamRole);
            }
          }

          // Notify the player via DM
          try {
            const user = await interaction.client.users.fetch(selectedPlayer.discordId);
            const dmEmbed = new EmbedBuilder()
              .setTitle('🏒 Team Status Update')
              .setDescription(`You have been removed from ${selectedTeam.name}.\nYour status has been set to Free Agent.`)
              .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.warn(`Could not send DM to ${selectedPlayer.username}`, error);
          }

          await playerSelection.update({
            content: `${selectedPlayer.username} has been removed from ${selectedTeam.name} and set as a free agent.`,
            components: [],
          });

        } catch (error) {
          if (error instanceof Error && error.message.includes('time')) {
            await interaction.editReply({
              content: 'Timed out! Please try the command again.',
              components: [],
            });
          } else {
            console.error('Error in player removal process:', error);
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            await interaction.editReply({
              content: `Failed to remove player: ${errorMessage}`,
              components: [],
            });
          }
        }

      } catch (error) {
        console.error('Error in removeplayer command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.reply(`Failed to start player removal process: ${errorMessage}`);
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
        const guildId = interaction.guildId; //get guildId

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        if (newCap < 0) {
          return interaction.editReply('Salary cap cannot be negative.');
        }

        const team = await db.select({
          id: teams.id,
          name: teams.name,
          salaryCap: teams.salaryCap,
        })
        .from(teams)
        .where(and(
          eq(teams.name, teamRole.name),
          eq(teams.guildId, guildId)
        ))
        .then(rows => rows[0]);

        if (!team) {
          return interaction.editReply('Team not found in database for this guild');
        }

        await db.update(teams)
          .set({ salaryCap: newCap })
          .where(eq(teams.id, team.id));

        const embed = new EmbedBuilder()
          .setTitle('Salary Cap Updated')
          .setDescription(`Updated salary cap for ${team.name}`)
          .addFields(
            { name: 'Previous Cap', value: `$${(team.salaryCap ?? 0).toLocaleString()}` },
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
        const guildId = interaction.guildId; //get guildId

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        if (newFloor < 0) {
          return interaction.editReply('Salary cap floor cannot be negative.');
        }

        const team = await db.select({
          id: teams.id,
          name: teams.name,
          capFloor: teams.capFloor,
        })
        .from(teams)
        .where(and(
          eq(teams.name, teamRole.name),
          eq(teams.guildId, guildId)
        ))
        .then(rows => rows[0]);

        if (!team) {
          return interaction.editReply('Team not found in database for this guild');
        }

        await db.update(teams)
          .set({ capFloor: newFloor })
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