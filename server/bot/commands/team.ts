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
      await interaction.deferReply();

      try {
        if (!interaction.guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Get all teams from database for the current guild
        const allTeams = await db.select()
          .from(teams)
          .where(eq(teams.guild_id, interaction.guildId));

        if (allTeams.length === 0) {
          return interaction.editReply('No teams found in the database for this guild.');
        }

        // Create select menu for teams
        const teamSelect = new StringSelectMenuBuilder()
          .setCustomId('team-select')
          .setPlaceholder('Select a team to delete')
          .addOptions(allTeams.map(team =>
            new StringSelectMenuOptionBuilder()
              .setLabel(team.name)
              .setValue(team.id.toString())
              .setDescription(`Delete ${team.name} and all associated data`)
          ));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(teamSelect);

        const response = await interaction.editReply({
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

          // Get all players before updating
          const teamPlayers = await db.select()
            .from(players)
            .where(eq(players.currentTeamId, teamId));

          // Update players to free agents
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

          // Delete all contracts
          try {
            await db.delete(contracts)
              .where(eq(contracts.teamId, teamId));
          } catch (error) {
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
              console.error('Error deleting channels:', error);
            }

            try {
              const teamRole = interaction.guild.roles.cache.find(role => role.name === selectedTeam.name);
              if (teamRole) {
                await teamRole.delete();
              }
            } catch (error) {
              console.error('Error deleting role:', error);
            }
          }

          // Delete the team
          await db.delete(teams)
            .where(eq(teams.id, teamId));

          await confirmation.update({
            content: `Team ${selectedTeam.name} has been deleted successfully.`,
            components: [],
          });

        } catch (error) {
          console.error('Error in team deletion process:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          await interaction.editReply({
            content: `Failed to delete team: ${errorMessage}`,
            components: [],
          });
        }

      } catch (error) {
        console.error('Error in delete team command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to delete team: ${errorMessage}`);
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
            and(eq(teams.name, teamRole.name), eq(teams.guild_id, guildId))
          );

        if (!team) {
          return interaction.editReply('Team not found in database for this guild');
        }

        // Get all players on the team with their active contracts
        const teamPlayers = await db.select({
          id: players.id,
          username: players.username,
          discordId: players.discord_id,
          salaryExempt: players.salary_exempt,
        })
          .from(players)
          .where(eq(players.current_team_id, team.id));

        // Get active contracts for the team
        const activeContracts = await db.select({
          playerId: contracts.player_id,
          salary: contracts.salary,
        })
          .from(contracts)
          .where(
            and(eq(contracts.team_id, team.id), eq(contracts.status, 'active'))
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
          .where(and(eq(teams.name, teamRole.name), eq(teams.guild_id, guildId)))
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
          .where(and(eq(teams.name, teamRole.name), eq(teams.guild_id, guildId)))
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
  {
    data: new SlashCommandBuilder()
      .setName('changeteamname')
      .setDescription('Change a team\'s name')
      .addRoleOption(option =>
        option.setName('team')
          .setDescription('The team to rename (use @team)')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('newname')
          .setDescription('The new name for the team')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamRole = interaction.options.getRole('team', true);
        const newName = interaction.options.getString('newname', true);
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Find team in database
        const [team] = await db.select()
          .from(teams)
          .where(
            and(eq(teams.name, teamRole.name), eq(teams.guild_id, guildId))
          );

        if (!team) {
          return interaction.editReply('Team not found in database for this guild');
        }

        // Update team name in database
        await db.update(teams)
          .set({ name: newName })
          .where(eq(teams.id, team.id));

        // Update Discord role name
        try {
          await teamRole.setName(newName, 'Team name change command');
        } catch (error) {
          console.error('Error updating role name:', error);
          return interaction.editReply('Failed to update Discord role name. Please check bot permissions.');
        }

        const embed = new EmbedBuilder()
          .setTitle('Team Name Updated')
          .setDescription(`Team name has been changed from ${team.name} to ${newName}`)
          .setColor('#00FF00')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error changing team name:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to change team name: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('releasedirect')
      .setDescription('Release a player to free agency immediately')
      .addUserOption(option =>
        option.setName('player')
          .setDescription('The player to release')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const user = interaction.options.getUser('player', true);
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Find player in database
        const player = await db.query.players.findFirst({
          where: eq(players.discord_id, user.id),
        });

        if (!player) {
          return interaction.editReply('Player not found in the database.');
        }

        if (!player.current_team_id) {
          return interaction.editReply('This player is not currently on a team.');
        }

        // Get current team info for the message
        const team = await db.query.teams.findFirst({
          where: eq(teams.id, player.current_team_id),
        });

        // Update player status to free agent and remove team
        await db.update(players)
          .set({
            current_team_id: null,
            status: 'free_agent'
          })
          .where(eq(players.id, player.id));

        // End any active contracts
        await db.update(contracts)
          .set({
            status: 'terminated',
            end_date: new Date()
          })
          .where(and(eq(contracts.player_id, player.id), eq(contracts.status, 'active')));

        // Update Discord roles if possible
        if (interaction.guild) {
          try {
            const member = await interaction.guild.members.fetch(user.id);

            // Remove any team roles
            const teamRole = team ? interaction.guild.roles.cache.find(role => role.name === team.name) : null;
            if (teamRole) {
              await member.roles.remove(teamRole);
            }

            // Add Free Agent role
            const freeAgentRole = interaction.guild.roles.cache.find(role => role.name === 'Free Agent');
            if (freeAgentRole) {
              await member.roles.add(freeAgentRole);
            }
          } catch (error) {
            console.error('Error updating Discord roles:', error);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('Player Released')
          .setDescription(`${user} has been released to free agency${team ? ` from ${team.name}` : ''}.`)
          .setColor('#FF0000')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error in release command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to release player: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('exemptplayer')
      .setDescription('Set a player as salary cap exempt'),

    async execute(interaction: ChatInputCommandInteraction) {
      try {
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.reply('This command must be run in a guild.');
        }

        const allTeams = await db.query.teams.findMany({
          with: {
            players: {
              where: eq(players.status, 'signed'),
            },
          },
          where: eq(teams.guild_id, guildId)
        });

        if (allTeams.length === 0) {
          return interaction.reply('No teams found.');
        }

        const teamSelect = new StringSelectMenuBuilder()
          .setCustomId('team-select')
          .setPlaceholder('Select a team')
          .addOptions(allTeams.map(team => new StringSelectMenuOptionBuilder()
            .setLabel(team.name)
            .setValue(team.id.toString())
            .setDescription(`Select ${team.name}`)
          ));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(teamSelect);
        const response = await interaction.reply({ content: 'Select a team', components: [row] });

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

        const teamPlayers = await db.query.players.findMany({
          where: and(eq(players.current_team_id, selectedTeamId), eq(players.status, 'signed'))
        });

        if (teamPlayers.length === 0) {
          return teamSelection.update({ content: 'No players found on this team.', components: [] });
        }

        const playerSelect = new StringSelectMenuBuilder()
          .setCustomId('player-select')
          .setPlaceholder('Select a player')
          .addOptions(teamPlayers.map(player => new StringSelectMenuOptionBuilder()
            .setLabel(player.username)
            .setValue(player.id.toString())
            .setDescription(`Select ${player.username}`)
          ));

        const playerRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(playerSelect);
        const playerResponse = await teamSelection.update({ content: 'Select a player to exempt', components: [playerRow] });

        const playerSelection = await playerResponse.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id,
          time: 30000,
          componentType: ComponentType.StringSelect,
        });

        const selectedPlayerId = parseInt(playerSelection.values[0]);
        const selectedPlayer = teamPlayers.find(p => p.id === selectedPlayerId);

        if (!selectedPlayer) {
          return playerSelection.update({ content: 'Selected player not found.', components: [] });
        }

        await db.update(players).set({ salary_exempt: true }).where(eq(players.id, selectedPlayerId));

        await playerSelection.update({ content: `${selectedPlayer.username} is now salary cap exempt.`, components: [] });

      } catch (error) {
        console.error('Error in exemption process:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply({
          content: `Failed to manage player exemption: ${errorMessage}`,
          components: [],
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('cut')
      .setDescription('Cut a player from the team roster')
      .addUserOption(option =>
        option.setName('player')
          .setDescription('The player to cut from the roster')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const user = interaction.options.getUser('player', true);
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Find player in database
        const player = await db.query.players.findFirst({
          where: eq(players.discord_id, user.id),
        });

        if (!player) {
          return interaction.editReply('Player not found in the database.');
        }

        if (!player.current_team_id) {
          return interaction.editReply('This player is not currently on a team.');
        }

        // Get current team info for the message
        const team = await db.query.teams.findFirst({
          where: eq(teams.id, player.current_team_id),
        });

        // Update player status to free agent and remove team
        await db.update(players)
          .set({
            current_team_id: null,
            status: 'free_agent'
          })
          .where(eq(players.id, player.id));

        // End any active contracts
        await db.update(contracts)
          .set({
            status: 'terminated',
            end_date: new Date()
          })
          .where(and(eq(contracts.player_id, player.id), eq(contracts.status, 'active')));

        // Update Discord roles if possible
        if (interaction.guild) {
          try {
            const member = await interaction.guild.members.fetch(user.id);

            // Remove any team roles
            const teamRole = team ? interaction.guild.roles.cache.find(role => role.name === team.name) : null;
            if (teamRole) {
              await member.roles.remove(teamRole);
            }

            // Add Free Agent role
            const freeAgentRole = interaction.guild.roles.cache.find(role => role.name === 'Free Agent');
            if (freeAgentRole) {
              await member.roles.add(freeAgentRole);
            }
          } catch (error) {
            console.error('Error updating Discord roles:', error);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('Player Cut')
          .setDescription(`${user} has been cut${team ? ` from ${team.name}` : ''} and is now a free agent.`)
          .setColor('#FF0000')
          .setFooter({ text: 'Player is now available to be signed by any team' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Try to DM the player about being cut
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle('❌ Team Roster Update')
            .setDescription(`You have been cut${team ? ` from ${team.name}` : ''} and are now a free agent.`)
            .setColor('#FF0000')
            .setFooter({ text: 'You are now free to sign with any team' })
            .setTimestamp();

          await user.send({ embeds: [dmEmbed] });
        } catch (error) {
          console.warn(`Could not send DM to ${user.tag}`, error);
        }

      } catch (error) {
        console.error('Error in cut command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to cut player: ${errorMessage}`);
      }
    },
  },
];

// Helper function remains unchanged
async function assignFreeAgentRole(interaction: ChatInputCommandInteraction, playerId: number) {
  try {
    const player = await db.query.players.findFirst({
      where: eq(players.id, playerId),
    });

    if (!player || !interaction.guild) return;

    const member = await interaction.guild.members.fetch(player.discordId);
    const freeAgentRole = interaction.guild.roles.cache.find(role => role.name === 'Free Agent');

    if (freeAgentRole && member) {
      await member.roles.add(freeAgentRole);
    }
  } catch (error) {
    console.error('Error assigning free agent role:', error);
  }
}