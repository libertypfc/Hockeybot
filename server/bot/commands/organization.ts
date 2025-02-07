import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { conferences, divisions, teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const OrganizationCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('createconf')
      .setDescription('Create a new conference')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the conference')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('abbreviation')
          .setDescription('The abbreviation for the conference')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const name = interaction.options.getString('name', true);
        const abbreviation = interaction.options.getString('abbreviation', true);

        const conference = await db.insert(conferences)
          .values({
            name,
            abbreviation,
          })
          .returning();

        await interaction.editReply(`Conference "${name}" (${abbreviation}) has been created.`);
      } catch (error) {
        console.error('Error creating conference:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create conference: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('creatediv')
      .setDescription('Create a new division')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the division')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('abbreviation')
          .setDescription('The abbreviation for the division')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('conference')
          .setDescription('The conference this division belongs to')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const name = interaction.options.getString('name', true);
        const abbreviation = interaction.options.getString('abbreviation', true);
        const conferenceName = interaction.options.getString('conference', true);

        // Find the conference
        const conference = await db.query.conferences.findFirst({
          where: eq(conferences.name, conferenceName),
        });

        if (!conference) {
          return interaction.editReply(`Conference "${conferenceName}" not found.`);
        }

        const division = await db.insert(divisions)
          .values({
            name,
            abbreviation,
            conferenceId: conference.id,
          })
          .returning();

        await interaction.editReply(
          `Division "${name}" (${abbreviation}) has been created in the ${conferenceName} conference.`
        );
      } catch (error) {
        console.error('Error creating division:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create division: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('createteam')
      .setDescription('Create a new team')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the team')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('division')
          .setDescription('The division this team belongs to')
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('The team role')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const name = interaction.options.getString('name', true);
        const divisionName = interaction.options.getString('division', true);
        const role = interaction.options.getRole('role', true);

        // Find the division
        const division = await db.query.divisions.findFirst({
          where: eq(divisions.name, divisionName),
        });

        if (!division) {
          return interaction.editReply(`Division "${divisionName}" not found.`);
        }

        const team = await db.insert(teams)
          .values({
            name,
            divisionId: division.id,
            salaryCap: 82500000, // Default salary cap
            availableCap: 82500000,
            capFloor: 60375000, // 73.2% of cap
          })
          .returning();

        await interaction.editReply(
          `Team "${name}" has been created in the ${divisionName} division.`
        );
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
      .setDescription('View the league organization structure'),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        // First, get all conferences
        const confs = await db.select().from(conferences);

        if (confs.length === 0) {
          return interaction.editReply('No conferences found.');
        }

        const embed = new EmbedBuilder()
          .setTitle('League Organization')
          .setColor('#0099ff');

        // For each conference, get its divisions and teams
        for (const conf of confs) {
          const divs = await db.select()
            .from(divisions)
            .where(eq(divisions.conferenceId, conf.id));

          let conferenceText = '';

          for (const div of divs) {
            const teamsInDiv = await db.select()
              .from(teams)
              .where(eq(teams.divisionId, div.id));

            conferenceText += `\n__${div.name} Division__\n`;

            if (teamsInDiv.length === 0) {
              conferenceText += '• No teams assigned\n';
            } else {
              teamsInDiv.forEach(team => {
                conferenceText += `• ${team.name}\n`;
              });
            }
          }

          if (conferenceText) {
            embed.addFields({
              name: `${conf.name} Conference`,
              value: conferenceText || 'No divisions',
            });
          }
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Error displaying organization:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to display organization: ${errorMessage}`);
      }
    },
  },
].filter(Boolean);