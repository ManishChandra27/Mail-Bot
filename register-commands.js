import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message to a channel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where message will be sent')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Message text')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('embed')
        .setDescription('Send as embed? true = embed, false = normal')
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName('attachment')
        .setDescription('Optional file/image')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Reply to a user via ModMail')
    .addStringOption(option =>
      option
        .setName('userid')
        .setDescription('User ID to reply to')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Your reply message')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close a ModMail ticket')
    .addStringOption(option =>
      option
        .setName('userid')
        .setDescription('User ID to close ticket for')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('conversations')
    .setDescription('List all active ModMail conversations')
];

const rest = new REST().setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('🔄 Starting to register slash commands...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log('✅ Successfully registered slash commands!');
    console.log('\n📋 Registered Commands:');
    commands.forEach(cmd => console.log(`  - /${cmd.name}`));
    console.log('\n🎉 You can now use slash commands in Discord!\n');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();
