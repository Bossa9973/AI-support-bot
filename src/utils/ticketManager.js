const {
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const config = require('../config');
const db = require('../database/db');
const embedBuilder = require('./embedBuilder');
const { generateTranscript } = require('./transcript');

/**
 * Handles creating, managing, and closing ticket channels.
 */
module.exports = {
  /**
   * Creates a new ticket channel for a user.
   */
  async createTicketChannel(guild, user) {
    // 1. Check for existing active ticket
    const existing = db.getUserActiveTicket(user.id, guild.id);
    if (existing) {
      const existingChannel = guild.channels.cache.get(existing.channelId);
      if (existingChannel) {
        return {
          success: false,
          error: `You already have an open ticket in <#${existingChannel.id}>!`
        };
      }
    }

    // 2. Get next sequential ticket number
    const ticketNumber = db.getNextTicketNumber();
    const formattedNumber = String(ticketNumber).padStart(4, '0');
    const sanitizedUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15) || 'user';
    const channelName = `ticket-${sanitizedUsername}-${formattedNumber}`;

    // 3. Setup permissions
    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageMessages
        ]
      }
    ];

    // Add support role permissions if configured
    if (config.tickets.supportRoleId && guild.roles.cache.has(config.tickets.supportRoleId)) {
      permissionOverwrites.push({
        id: config.tickets.supportRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      });
    }

    // 4. Create Channel
    try {
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: config.tickets.categoryId || null,
        topic: `Support Ticket for ${user.tag} (${user.id}) | Ticket #${formattedNumber}`,
        permissionOverwrites: permissionOverwrites
      });

      // 5. Save to database
      db.createTicket(channel.id, {
        userId: user.id,
        guildId: guild.id,
        ticketNumber: ticketNumber
      });

      // 6. Send Greeting Embed & Ticket Controls
      const greeting = embedBuilder.createTicketGreeting(user, ticketNumber);
      await channel.send(greeting);

      return { success: true, channel };
    } catch (error) {
      console.error('Failed to create ticket channel:', error);
      return {
        success: false,
        error: 'Failed to create ticket channel. Please check bot permissions (Manage Channels).'
      };
    }
  },

  /**
   * Closes a ticket channel and generates transcripts.
   */
  async closeTicket(channel, closedByUser) {
    const ticketData = db.getTicket(channel.id);
    if (!ticketData) {
      return { success: false, error: 'This channel is not a tracked ticket.' };
    }

    db.closeTicket(channel.id);

    try {
      // 1. Lock user permissions in channel
      await channel.permissionOverwrites.edit(ticketData.userId, {
        SendMessages: false
      });

      // Rename channel to closed
      const formattedNum = String(ticketData.ticketNumber).padStart(4, '0');
      await channel.setName(`closed-${formattedNum}`).catch(() => {});

      // 2. Generate transcript
      const transcriptAttachment = await generateTranscript(channel);
      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => new Map());

      // 3. Post closed controls in channel
      const closedControls = embedBuilder.createClosedControls(closedByUser.id);
      await channel.send(closedControls);

      // 4. Send transcript to Logs channel if configured
      if (config.tickets.transcriptChannelId) {
        const logChannel = channel.guild.channels.cache.get(config.tickets.transcriptChannelId);
        if (logChannel && logChannel.isTextBased()) {
          const logEmbed = embedBuilder.createTranscriptLogEmbed(ticketData, closedByUser, messages.size);
          await logChannel.send({
            embeds: [logEmbed],
            files: [transcriptAttachment]
          }).catch(console.error);
        }
      }

      // 5. Send transcript to user via DM
      const ticketUser = await channel.client.users.fetch(ticketData.userId).catch(() => null);
      if (ticketUser) {
        ticketUser.send({
          content: `Your support ticket in **${channel.guild.name}** has been closed. Here is your transcript:`,
          files: [transcriptAttachment]
        }).catch(() => {
          // User DMs may be closed, ignore
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error closing ticket:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Reopens a closed ticket.
   */
  async reopenTicket(channel, reopenedByUser) {
    const ticketData = db.getTicket(channel.id);
    if (!ticketData) {
      return { success: false, error: 'This channel is not a tracked ticket.' };
    }

    db.updateTicket(channel.id, { status: 'open' });

    try {
      // Restore user permissions
      await channel.permissionOverwrites.edit(ticketData.userId, {
        SendMessages: true
      });

      const formattedNum = String(ticketData.ticketNumber).padStart(4, '0');
      await channel.setName(`ticket-${formattedNum}`).catch(() => {});

      await channel.send({
        content: `🔓 Ticket re-opened by <@${reopenedByUser.id}>.`
      });

      return { success: true };
    } catch (error) {
      console.error('Error reopening ticket:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Deletes a ticket channel.
   */
  async deleteTicket(channel, deletedByUser) {
    db.deleteTicket(channel.id);
    await channel.send('⛔ *Deleting ticket channel in 5 seconds...*');
    setTimeout(async () => {
      await channel.delete(`Ticket deleted by ${deletedByUser.tag}`).catch(console.error);
    }, 5000);
  }
};
