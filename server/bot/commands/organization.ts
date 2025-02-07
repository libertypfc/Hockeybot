import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder, ChannelType, PermissionsBitField } from 'discord.js';
import { db } from '@db';
import { teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const OrganizationCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('createteam')
      .setDescription('Create a new team')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the team')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const name = interaction.options.getString('name', true);
        const guildId = interaction.guildId;

        if (!interaction.guild || !guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Create team role first
        const teamRole = await interaction.guild.roles.create({
          name: name,
          color: '#' + Math.floor(Math.random()*16777215).toString(16), // Random color
          reason: 'New team creation',
          permissions: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ]
        });

        // Create category for team
        const category = await interaction.guild.channels.create({
          name: name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
              id: teamRole.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
              ],
            },
            {
              id: interaction.guild.members.me!.id, // Bot's permissions
              allow: [PermissionsBitField.Flags.ViewChannel],
            }
          ],
        });

        // Create team channels
        const channels = await Promise.all([
          // Text Channels
          interaction.guild.channels.create({
            name: 'team-chat',
            type: ChannelType.GuildText,
            parent: category.id,
          }),
          interaction.guild.channels.create({
            name: 'roster',
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
              {
                id: teamRole.id,
                deny: [PermissionsBitField.Flags.SendMessages],
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
              }
            ]
          }),
          interaction.guild.channels.create({
            name: 'signing',
            type: ChannelType.GuildText,
            parent: category.id,
          }),
          interaction.guild.channels.create({
            name: 'stats-picture',
            type: ChannelType.GuildText,
            parent: category.id,
          }),
          // Voice Channel
          interaction.guild.channels.create({
            name: 'Team Chat',
            type: ChannelType.GuildVoice,
            parent: category.id,
          }),
        ]);

        // Create the team in database with Discord IDs
        const [team] = await db.insert(teams)
          .values({
            name,
            guild_id: guildId,
            salary_cap: 82500000, // Default salary cap
            available_cap: 82500000,
            cap_floor: 60375000, // 73.2% of cap
            discord_category_id: category.id,
            metadata: JSON.stringify({
              roleId: teamRole.id,
              channels: channels.map(ch => ({
                name: ch.name,
                id: ch.id,
                type: ch.type
              }))
            }),
          })
          .returning();

        const embed = new EmbedBuilder()
          .setTitle('Team Created')
          .setDescription(`Team "${name}" has been created successfully.`)
          .addFields(
            { name: 'Salary Cap', value: `$${team.salary_cap?.toLocaleString() ?? 0}`, inline: true },
            { name: 'Cap Floor', value: `$${team.cap_floor?.toLocaleString() ?? 0}`, inline: true },
            { name: 'Text Channels', value: channels.filter(ch => ch.type === ChannelType.GuildText).map(ch => `<#${ch.id}>`).join('\n'), inline: false },
            { name: 'Voice Channels', value: channels.filter(ch => ch.type === ChannelType.GuildVoice).map(ch => `🔊 ${ch.name}`).join('\n'), inline: false },
            { name: 'Team Role', value: `<@&${teamRole.id}>`, inline: false }
          )
          .setColor(teamRole.color)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error creating team:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create team: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('vieworg')
      .setDescription('View the teams in the server'),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Get all teams for this guild
        const guildTeams = await db.select({
          name: teams.name,
          salaryCap: teams.salary_cap,
          capFloor: teams.cap_floor,
        })
        .from(teams)
        .where(eq(teams.guild_id, guildId));

        if (guildTeams.length === 0) {
          return interaction.editReply('No teams found in this server.');
        }

        const embed = new EmbedBuilder()
          .setTitle('Server Teams')
          .setColor('#0099ff')
          .setDescription('Here are all the teams in this server:');

        for (const team of guildTeams) {
          embed.addFields({
            name: team.name,
            value: `Salary Cap: $${team.salaryCap?.toLocaleString() ?? 0}\nCap Floor: $${team.capFloor?.toLocaleString() ?? 0}`,
            inline: false
          });
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Error displaying teams:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to display teams: ${errorMessage}`);
      }
    },
  },
].filter(Boolean);