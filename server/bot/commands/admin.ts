import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { guildSettings, teams, contracts, players } from '@db/schema';
import { eq } from 'drizzle-orm';

export const AdminCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Test bot connection and get response time'),

    async execute(interaction: ChatInputCommandInteraction) {
      const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
      const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
      const wsLatency = interaction.client.ws.ping;
      const uptime = Math.floor(interaction.client.uptime! / 1000); // Convert to seconds

      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;

      const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .addFields(
          { name: 'Bot Latency', value: `${roundtripLatency}ms`, inline: true },
          { name: 'WebSocket Latency', value: `${wsLatency}ms`, inline: true },
          { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true }
        )
        .setColor(roundtripLatency < 200 ? '#00ff00' : roundtripLatency < 500 ? '#ffff00' : '#ff0000')
        .setTimestamp();

      await interaction.editReply({ content: null, embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setwelcomechannel')
      .setDescription('Set the channel for welcome messages')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to send welcome messages in')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText))
      .setDefaultMemberPermissions('0'),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);

        if (channel.type !== ChannelType.GuildText) {
          return interaction.editReply('Please select a text channel for welcome messages.');
        }

        await db.insert(guildSettings)
          .values({
            guild_id: interaction.guildId!,
            welcome_channel_id: channel.id,
          })
          .onConflictDoUpdate({
            target: [guildSettings.guild_id],
            set: { welcome_channel_id: channel.id },
          });

        await interaction.editReply(`Welcome messages will now be sent to ${channel}`);
      } catch (error) {
        console.error('Error setting welcome channel:', error);
        await interaction.editReply('Failed to set welcome channel');
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setcapnotificationchannel')
      .setDescription('Set the channel for salary cap notifications')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to send cap notifications in')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText))
      .setDefaultMemberPermissions('0'),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);

        if (channel.type !== ChannelType.GuildText) {
          return interaction.editReply('Please select a text channel for cap notifications.');
        }

        await db.insert(guildSettings)
          .values({
            guild_id: interaction.guildId!,
            cap_notification_channel_id: channel.id,
          })
          .onConflictDoUpdate({
            target: [guildSettings.guild_id],
            set: { cap_notification_channel_id: channel.id },
          });

        await interaction.editReply(`Salary cap notifications will now be sent to ${channel}`);
      } catch (error) {
        console.error('Error setting cap notification channel:', error);
        await interaction.editReply('Failed to set cap notification channel');
      }
    },
  },
];

export async function checkCapCompliance(client: any) {
  try {
    const allTeams = await db.query.teams.findMany({
      with: {
        players: true,
      },
    });

    const settings = await db.query.guildSettings.findFirst();
    if (!settings?.cap_notification_channel_id) return;

    const notificationChannel = await client.channels.fetch(settings.cap_notification_channel_id);
    if (!notificationChannel) return;

    for (const team of allTeams) {
      const activeContracts = await db.select({
        playerId: contracts.player_id,
        salary: contracts.salary,
      })
        .from(contracts)
        .where(eq(contracts.team_id, team.id));

      // Calculate total salary excluding exempt players
      const totalSalary = activeContracts.reduce((sum, contract) => {
        const player = team.players.find(p => p.id === contract.playerId);
        return sum + (player?.salary_exempt ? 0 : contract.salary);
      }, 0);

      if (totalSalary < (team.cap_floor || 0)) {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ Salary Cap Floor Alert')
          .setDescription(`${team.name} is below the salary cap floor!`)
          .addFields(
            { name: 'Current Total Salary', value: `$${totalSalary.toLocaleString()}` },
            { name: 'Cap Floor', value: `$${team.cap_floor?.toLocaleString()}` },
            { name: 'Amount Below Floor', value: `$${((team.cap_floor || 0) - totalSalary).toLocaleString()}` }
          )
          .setColor('#FF9900')
          .setTimestamp();

        await notificationChannel.send({ embeds: [embed] });
      } else if (totalSalary > (team.salary_cap || 0)) {
        const embed = new EmbedBuilder()
          .setTitle('🚨 Salary Cap Exceeded')
          .setDescription(`${team.name} is over the salary cap!`)
          .addFields(
            { name: 'Current Total Salary', value: `$${totalSalary.toLocaleString()}` },
            { name: 'Salary Cap', value: `$${team.salary_cap?.toLocaleString()}` },
            { name: 'Amount Over Cap', value: `$${(totalSalary - (team.salary_cap || 0)).toLocaleString()}` }
          )
          .setColor('#FF0000')
          .setTimestamp();

        await notificationChannel.send({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error('Error checking cap compliance:', error);
  }
}