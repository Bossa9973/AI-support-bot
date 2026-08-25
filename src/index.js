const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  ChannelType
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { handleButton } = require('./handlers/buttonHandler');
const { handleMessage } = require('./handlers/messageHandler');
const { handleDM } = require('./handlers/dmHandler');
const { getKnowledgeContext } = require('./ai/knowledgeBase');
const { warmupConnection } = require('./ai/client');

// Create Discord Client with required Intents including Direct Messages
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

client.commands = new Collection();

// Load Commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
const commandsData = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    commandsData.push(command.data.toJSON());
  } else {
    console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

/**
 * Register Slash Commands
 */
async function registerCommands() {
  if (!config.token || !config.clientId) {
    console.warn('[SETUP] Skipping slash command registration: DISCORD_TOKEN or CLIENT_ID is missing in .env');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    console.log(`[SLASH COMMANDS] Refreshing ${commandsData.length} application (/) commands...`);

    if (config.guildId) {
      // Guild-specific commands (Instant updates)
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commandsData }
      );
      console.log(`[SLASH COMMANDS] Successfully registered commands to Guild ID: ${config.guildId}`);
    } else {
      // Global commands
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commandsData }
      );
      console.log('[SLASH COMMANDS] Successfully registered global commands.');
    }
  } catch (error) {
    console.error('[SLASH COMMANDS ERROR] Failed to register slash commands:', error);
  }
}

// Bot Ready Event
client.once('ready', async () => {
  console.log('====================================================');
  console.log(`🤖 AI Support Bot is ONLINE as ${client.user.tag}`);
  console.log(`👑 Owner ID configured: ${config.ownerId ? config.ownerId : 'None (Set OWNER_ID in .env)'}`);
  console.log(`🧠 AI Provider: ${config.ai.providerName} (${config.ai.model})`);
  console.log(`📚 Knowledge Context Loaded (${getKnowledgeContext().length} chars)`);
  console.log('====================================================');

  await registerCommands();

  // Warm up the AI HTTP connection pool to avoid cold-start latency on the first ticket
  setTimeout(() => warmupConnection(), 2000);
});

// Interaction Event (Slash Commands & Buttons)
client.on('interactionCreate', async (interaction) => {
  try {
    // 1. Handle Slash Commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }
      await command.execute(interaction);
      return;
    }

    // 2. Handle Ticket Tool Buttons
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    const replyContent = {
      content: '❌ There was an error while executing this action!',
      ephemeral: true
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyContent).catch(() => {});
    } else {
      await interaction.reply(replyContent).catch(() => {});
    }
  }
});

// Message Event (Tickets & Owner DMs)
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check for Direct Message (Owner Training / Executive Control)
  if (!message.guild || message.channel.type === ChannelType.DM) {
    await handleDM(message);
    return;
  }

  // Guild Ticket Channel Messages
  await handleMessage(message);
});

// Graceful Error Handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

// Start the bot
if (!config.token) {
  console.log('====================================================');
  console.log('⚠️  NO DISCORD_TOKEN FOUND in .env');
  console.log('👉 Please edit "/root/AI support bot/.env" with your tokens');
  console.log('====================================================');
} else {
  client.login(config.token).catch((err) => {
    console.error('Failed to log in to Discord:', err);
  });
}
