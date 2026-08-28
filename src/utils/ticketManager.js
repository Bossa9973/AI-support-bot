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
  async createTicketChannel(guild, user, categoryId = 'general_support') {
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

    const categoryData = embedBuilder.getCategoryData(categoryId);

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
        topic: `${categoryData.label} Support for ${user.tag} (${user.id}) | Ticket #${formattedNumber}`,
        permissionOverwrites: permissionOverwrites
      });

      // 5. Save to database
      db.createTicket(channel.id, {
        userId: user.id,
        guildId: guild.id,
        ticketNumber: ticketNumber,
        category: categoryId
      });

      // 6. Send Greeting Embed & Ticket Controls
      const greeting = embedBuilder.createTicketGreeting(user, ticketNumber, categoryId);
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
      // 1. Lock user permissions in channel safely
      if (ticketData.userId) {
        await channel.permissionOverwrites.edit(ticketData.userId, {
          SendMessages: false
        }).catch((err) => console.warn('Could not update permission overwrites on close:', err.message));
      }

      // Rename channel to closed
      const formattedNum = String(ticketData.ticketNumber).padStart(4, '0');
      await channel.setName(`closed-${formattedNum}`).catch((err) => console.warn('Could not rename channel on close:', err.message));

      // 2. Generate transcript safely
      let transcriptAttachment = null;
      try {
        transcriptAttachment = await generateTranscript(channel);
      } catch (err) {
        console.warn('Transcript generation notice:', err.message);
      }

      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => new Map());

      // 3. Post closed controls in channel
      const closedUserId = closedByUser?.id || (typeof closedByUser === 'string' ? closedByUser : channel.client.user.id);
      const closedUserObj = (closedByUser && closedByUser.id) ? closedByUser : channel.client.user;

      const closedControls = embedBuilder.createClosedControls(closedUserId);
      await channel.send(closedControls).catch((err) => console.error('Error sending closedControls:', err));

      // 4. Send transcript to Logs channel if configured
      if (transcriptAttachment && config.tickets.transcriptChannelId) {
        const logChannel = channel.guild.channels.cache.get(config.tickets.transcriptChannelId);
        if (logChannel && logChannel.isTextBased()) {
          const logEmbed = embedBuilder.createTranscriptLogEmbed(ticketData, closedUserObj, messages.size);
          await logChannel.send({
            embeds: [logEmbed],
            files: [transcriptAttachment]
          }).catch(console.error);
        }
      }

      // 5. Send enhanced transcript to user via DM
      if (transcriptAttachment && ticketData.userId) {
        const ticketUser = await channel.client.users.fetch(ticketData.userId).catch(() => null);
        if (ticketUser) {
          const userDmEmbed = embedBuilder.createTranscriptUserDMEmbed(
            ticketData,
            channel.guild,
            closedUserObj,
            messages.size
          );
          await ticketUser.send({
            embeds: [userDmEmbed],
            files: [transcriptAttachment]
          }).catch(() => {
            // User DMs may be closed, ignore
          });
        }
      }

      // 6. Inspect ticket transcript for self-learning & knowledge discovery (non-blocking)
      try {
        const { inspectTicketTranscript } = require('../ai/selfLearning');
        inspectTicketTranscript(channel.client, ticketData, messages).catch((err) => {
          console.warn('[SelfLearning] Background transcript inspection error:', err.message);
        });
      } catch (inspectErr) {
        console.warn('[SelfLearning] Could not initiate transcript inspection:', inspectErr.message);
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
  },

  /**
   * Sorts the ticket into the corresponding priority Discord category.
   */
  async sortTicketIntoCategory(channel, priority) {
    if (!channel || !channel.guild) return;
    const guild = channel.guild;
    const normPriority = (priority || 'green').toLowerCase();

    let targetCategoryName = '🟢 Standard Tickets';
    let searchKeywords = ['standard', 'green'];
    if (normPriority === 'red') {
      targetCategoryName = '🔴 Critical Emergency';
      searchKeywords = ['critical', 'emergency', 'red'];
    } else if (normPriority === 'yellow' || normPriority === 'orange') {
      targetCategoryName = '🟡 Elevated Tickets';
      searchKeywords = ['elevated', 'yellow', 'orange'];
    }

    try {
      // 1. Search existing categories in guild
      let targetCat = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildCategory &&
          searchKeywords.some((kw) => c.name.toLowerCase().includes(kw))
      );

      // 2. If category doesn't exist, create it
      if (!targetCat) {
        const permissionOverwrites = [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: guild.members.me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.SendMessages
            ]
          }
        ];

        if (config.tickets.supportRoleId && guild.roles.cache.has(config.tickets.supportRoleId)) {
          permissionOverwrites.push({
            id: config.tickets.supportRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          });
        }

        targetCat = await guild.channels.create({
          name: targetCategoryName,
          type: ChannelType.GuildCategory,
          permissionOverwrites
        }).catch((err) => {
          console.warn(`Could not create category ${targetCategoryName}:`, err.message);
          return null;
        });
      }

      // 3. Move channel into target category if found
      if (targetCat && channel.parentId !== targetCat.id) {
        await channel.setParent(targetCat.id, { lockPermissions: false }).catch((err) => {
          console.warn(`Could not move channel to category ${targetCat.name}:`, err.message);
        });
      }
    } catch (err) {
      console.warn('Error sorting ticket into category:', err.message);
    }
  },

  /**
   * Renames ticket with priority emoji and summarized slug, e.g. 🟢-vps-network-issue
   */
  async updateTicketNameAndPriority(channel, priority, slug) {
    const normPriority = (priority || 'green').toLowerCase();
    const emoji = normPriority === 'red' ? '🔴' : normPriority === 'yellow' ? '🟡' : '🟢';

    const cleanSlug = (slug || 'support-request')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 35) || 'support-request';

    const newChannelName = `${emoji}-${cleanSlug}`;

    await channel.setName(newChannelName).catch((err) => {
      console.warn(`Could not rename channel to ${newChannelName}:`, err.message);
    });

    // Also sort into Discord category
    await this.sortTicketIntoCategory(channel, priority);
  }
};
