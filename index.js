import { Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ActivityType } from "discord.js";
import dotenv from "dotenv";
dotenv.config();
import { keepAlive } from "./keepAlive.js";
keepAlive();


// ====== CONFIG ======
const STAFF_CHANNEL_ID = process.env.STAFF_CHANNEL_ID || "1444571528921481246";
const PREFIX = "!";
const DEBUG = true;

// ⭐ SPAM PROTECTION CONFIG
const SPAM_LIMIT = 6; // Maximum messages in time window
const SPAM_WINDOW = 60000; // Time window in milliseconds (60 seconds)
const SPAM_COOLDOWN = 300000; // Cooldown after spam detected (5 minutes)

// ⭐ BAD WORDS FILTER - Add your own words here
const BAD_WORDS = [
  // English bad words
  "fuck", "shit", "bitch", "asshole", "dick", "pussy", "bastard", "damn",
  "cunt", "whore", "slut", "nigger", "faggot", "retard",
  // Hindi/Urdu bad words (transliterated)
  "chutiya", "madarchod", "bhenchod", "bhosdike", "gandu", "harami",
  "kutte", "kamine", "saale", "randi", "lodu", "lawde",
  // Add more words as needed
];

// ⭐ PERMISSION CONFIGURATION - Change this to control who can use commands
const REQUIRED_PERMISSION = PermissionFlagsBits.Administrator;
// You can change it to any permission like:
// PermissionFlagsBits.ManageGuild
// PermissionFlagsBits.ManageMessages
// PermissionFlagsBits.ModerateMembers

// Track active conversations with threads
const activeThreads = new Map();
const activeConversations = new Map();
const processedMessages = new Set(); // Prevent duplicate processing
const userMessageTimestamps = new Map(); // Track message timestamps for spam detection
const spamCooldowns = new Map(); // Track users on cooldown
const lastStaffReply = new Map(); // Track when staff last replied to reset spam counter

// Helper function for debug logging
function debugLog(message, data = null) {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`);
    if (data) console.log(data);
  }
}

// Helper function to check for bad words
function containsBadWords(text) {
  // Normalize text - remove special characters, extra spaces, and common bypasses
  const normalizedText = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars like /, \, *, @, etc.
    .replace(/\s+/g, ' ')         // Replace multiple spaces with single space
    .replace(/0/g, 'o')           // Replace 0 with o
    .replace(/1/g, 'i')           // Replace 1 with i
    .replace(/3/g, 'e')           // Replace 3 with e
    .replace(/4/g, 'a')           // Replace 4 with a
    .replace(/5/g, 's')           // Replace 5 with s
    .replace(/7/g, 't')           // Replace 7 with t
    .replace(/8/g, 'b')           // Replace 8 with b
    .trim();
  
  return BAD_WORDS.some(word => {
    // Check if bad word exists in normalized text
    const normalizedWord = word.toLowerCase();
    
    // Check with word boundaries
    const regexStrict = new RegExp(`\\b${normalizedWord}\\b`, 'i');
    if (regexStrict.test(normalizedText)) return true;
    
    // Check if word is contained (for words with special chars removed)
    if (normalizedText.includes(normalizedWord)) return true;
    
    // Check with spaces between characters (e.g., "c h u t i y a")
    const spacedWord = normalizedWord.split('').join('\\s*');
    const regexSpaced = new RegExp(spacedWord, 'i');
    if (regexSpaced.test(normalizedText)) return true;
    
    return false;
  });
}

// Helper function to check spam
function isSpamming(userId) {
  const now = Date.now();
  
  // Check if user is on cooldown
  if (spamCooldowns.has(userId)) {
    const cooldownEnd = spamCooldowns.get(userId);
    if (now < cooldownEnd) {
      const remainingTime = Math.ceil((cooldownEnd - now) / 1000);
      return { spam: true, cooldown: true, remaining: remainingTime };
    } else {
      spamCooldowns.delete(userId);
    }
  }
  
  // Reset spam counter if staff replied recently (within last 5 seconds)
  if (lastStaffReply.has(userId)) {
    const lastReply = lastStaffReply.get(userId);
    if (now - lastReply < 5000) {
      userMessageTimestamps.delete(userId);
      debugLog(`Spam counter reset for ${userId} - staff replied recently`);
    }
  }
  
  // Get user's message timestamps
  if (!userMessageTimestamps.has(userId)) {
    userMessageTimestamps.set(userId, []);
  }
  
  const timestamps = userMessageTimestamps.get(userId);
  
  // Remove old timestamps outside the spam window
  const recentTimestamps = timestamps.filter(time => now - time < SPAM_WINDOW);
  userMessageTimestamps.set(userId, recentTimestamps);
  
  // Check if user exceeded spam limit
  if (recentTimestamps.length >= SPAM_LIMIT) {
    spamCooldowns.set(userId, now + SPAM_COOLDOWN);
    return { spam: true, cooldown: false };
  }
  
  // Add current timestamp
  recentTimestamps.push(now);
  userMessageTimestamps.set(userId, recentTimestamps);
  
  return { spam: false };
}

// ====== CLIENT ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// ===============
//  USER → BOT → STAFF (WITH THREAD)
// ===============
client.on(Events.MessageCreate, async (message) => {
  debugLog(`Message received from ${message.author.tag}`, {
    channelType: message.channel.type,
    isDM: message.channel.type === 1,
    isBot: message.author.bot
  });

  if (message.author.bot) {
    debugLog("Ignoring bot message");
    return;
  }

  // Handle only DM messages (type 1 is DM)
  if (message.channel.type === 1) {
    debugLog(`Processing DM from ${message.author.tag}`);
    
    // Prevent duplicate processing
    if (processedMessages.has(message.id)) {
      debugLog(`Message ${message.id} already processed, skipping`);
      return;
    }
    processedMessages.add(message.id);
    
    // Clean old processed messages (keep last 100)
    if (processedMessages.size > 100) {
      const first = processedMessages.values().next().value;
      processedMessages.delete(first);
    }
    
    // ⛔ SPAM PROTECTION
    const spamCheck = isSpamming(message.author.id);
    if (spamCheck.spam) {
      if (spamCheck.cooldown) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle("⏰ Cooldown Active")
          .setDescription(`You're sending messages too quickly! Please wait **${spamCheck.remaining} seconds** before trying again.`)
          .setFooter({ text: "Please avoid spamming our support system" });
        
        await message.reply({ embeds: [errorEmbed] }).catch(() => {});
        debugLog(`User ${message.author.tag} is on cooldown`);
        return;
      } else {
        const warnEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle("⚠️ Spam Detected")
          .setDescription(`You're sending too many messages! You have been placed on a **5-minute cooldown**.\n\nPlease be patient and avoid spamming.`)
          .setFooter({ text: "Continued spam may result in being blocked" });
        
        await message.reply({ embeds: [warnEmbed] }).catch(() => {});
        debugLog(`User ${message.author.tag} triggered spam protection`);
        
        // Notify staff
        try {
          const staffChannel = await client.channels.fetch(STAFF_CHANNEL_ID);
          const spamAlert = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle("⚠️ Spam Alert")
            .setDescription(`**${message.author.tag}** (${message.author.id}) has been auto-muted for spam.\n\n**Cooldown:** 5 minutes`)
            .setTimestamp();
          
          await staffChannel.send({ embeds: [spamAlert] });
        } catch (error) {
          console.error("Failed to send spam alert:", error);
        }
        return;
      }
    }
    
    // ⛔ BAD WORDS FILTER
    if (message.content && containsBadWords(message.content)) {
      const warningEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("🚫 Inappropriate Language Detected")
        .setDescription("Your message contains inappropriate language and has been blocked.\n\nPlease keep your messages respectful and professional.")
        .setFooter({ text: "Continued violations may result in being blocked" });
      
      await message.reply({ embeds: [warningEmbed] }).catch(() => {});
      debugLog(`Bad word detected from ${message.author.tag}: ${message.content}`);
      
      // Notify staff about bad words
      try {
        const staffChannel = await client.channels.fetch(STAFF_CHANNEL_ID);
        const badWordAlert = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle("🚫 Bad Word Alert")
          .setDescription(`**${message.author.tag}** (${message.author.id}) tried to send:\n\`\`\`${message.content}\`\`\``)
          .setTimestamp();
        
        await staffChannel.send({ embeds: [badWordAlert] });
      } catch (error) {
        console.error("Failed to send bad word alert:", error);
      }
      return;
    }
    
    try {
      const staffChannel = await client.channels.fetch(STAFF_CHANNEL_ID);
      debugLog(`Staff channel fetched: ${staffChannel.name}`);
      
      // Check if thread already exists for this user
      let thread = null;
      if (activeThreads.has(message.author.id)) {
        debugLog(`Found existing thread for user ${message.author.tag}`);
        thread = await staffChannel.threads.fetch(activeThreads.get(message.author.id)).catch(err => {
          debugLog("Error fetching existing thread:", err.message);
          return null;
        });
      }

      // Create new thread if doesn't exist
      if (!thread) {
        debugLog(`Creating new thread for ${message.author.tag}`);
        
        thread = await staffChannel.threads.create({
          name: `📩 ${message.author.username}`,
          autoArchiveDuration: 1440,
          reason: `ModMail from ${message.author.tag}`,
        });

        debugLog(`Thread created: ${thread.name} (ID: ${thread.id})`);
        activeThreads.set(message.author.id, thread.id);

        // Send initial info embed
        const infoEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle("📬 New ModMail Ticket")
          .setThumbnail(message.author.displayAvatarURL())
          .addFields(
            { name: "User", value: `${message.author.tag}`, inline: true },
            { name: "User ID", value: message.author.id, inline: true },
            { name: "Account Created", value: `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`, inline: true }
          )
          .setTimestamp()
          .setFooter({ text: "Reply directly in this thread" });

        // Only Close Ticket button
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`closeticket_${message.author.id}`)
              .setLabel("Close Ticket")
              .setStyle(ButtonStyle.Danger)
              .setEmoji("🔒")
          );

        await thread.send({ embeds: [infoEmbed], components: [row] });
        debugLog("Initial info message sent to thread");
      }

      // Track conversation
      const userConvo = activeConversations.get(message.author.id) || { messageCount: 0, lastMessageAt: null, threadId: thread.id };
      userConvo.messageCount++;
      userConvo.lastMessageAt = new Date();
      userConvo.threadId = thread.id;
      activeConversations.set(message.author.id, userConvo);

      // Create embed for the message
      const messageContent = message.content || "*No text content*";
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ 
          name: message.author.tag, 
          iconURL: message.author.displayAvatarURL() 
        })
        .setTimestamp()
        .setFooter({ text: `Message #${userConvo.messageCount}` });

      // Only add description if there's actual text content
      if (message.content) {
        embed.setDescription(message.content);
      }

      // Handle attachments - Show link in embed, image as preview
      if (message.attachments.size > 0) {
        debugLog(`Processing ${message.attachments.size} attachments`);
        
        const attachmentLinks = [];
        message.attachments.forEach(attachment => {
          attachmentLinks.push(`[${attachment.name}](${attachment.url})`);
        });
        
        embed.addFields({ 
          name: "📎 Attachments", 
          value: attachmentLinks.join('\n')
        });
        
        // Set first image as embed image for preview
        const firstImage = message.attachments.find(a => a.contentType?.startsWith("image/"));
        if (firstImage) {
          embed.setImage(firstImage.url);
        }
      }

      // Send message (no separate file attachments to avoid duplication)
      await thread.send({ 
        embeds: [embed]
      });
      debugLog(`Message forwarded to thread #${userConvo.messageCount}`);

      // Send welcome message to user on first message
      if (userConvo.messageCount === 1) {
        const welcomeEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle("🎫 Ticket Opened")
          .setDescription("Your support ticket has been created! Our staff team will respond to you shortly. Please be patient.")
          .setTimestamp()
          .setFooter({ text: "You can continue sending messages here" });
        
        await message.reply({ embeds: [welcomeEmbed] });
        debugLog("Sent welcome message to user");
      }

      // Acknowledge to user
      await message.react("👍🏻");
      debugLog("Sent confirmation reaction to user");
      
    } catch (error) {
      console.error("❌ Error forwarding DM:", error);
      debugLog("Full error details:", error);
      
      try {
        await message.reply("⚠️ There was an error processing your message. Please try again or contact an administrator.");
      } catch (e) {
        console.error("Could not send error message to user:", e);
      }
    }
  }
});

// ===============
// STAFF → BOT → USER (THREAD REPLIES)
// ===============
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  
  // Check if message is in a thread
  if (message.channel.isThread() && message.channel.parentId === STAFF_CHANNEL_ID) {
    // Find user ID from activeThreads
    let userId = null;
    for (const [uid, threadId] of activeThreads) {
      if (threadId === message.channel.id) {
        userId = uid;
        break;
      }
    }

    if (!userId) return;

    // Don't send if message starts with prefix (it's a command)
    if (message.content.startsWith(PREFIX) || message.content.startsWith("/")) return;

    try {
      const user = await client.users.fetch(userId);
      
      // Prepare files
      const attachmentFiles = [];
      if (message.attachments.size > 0) {
        message.attachments.forEach(attachment => {
          attachmentFiles.push(attachment.url);
        });
      }

      // ✅ CHANGE 1: Send normal message instead of embed
      const hasContent = message.content && message.content.trim().length > 0;
      
      if (hasContent && attachmentFiles.length > 0) {
        // Send text with files
        await user.send({ 
          content: `📨 **Support Team:**\n${message.content}`,
          files: attachmentFiles
        });
      } else if (hasContent) {
        // Only text
        await user.send(`📨 **Support Team:**\n${message.content}`);
      } else if (attachmentFiles.length > 0) {
        // Only files
        await user.send({ 
          content: "📨 **Support Team:** *Sent you file(s)*",
          files: attachmentFiles
        });
      }

      // React to confirm sent
      await message.react("👍🏻");

      // Update conversation tracking
      const userConvo = activeConversations.get(userId);
      if (userConvo) {
        userConvo.lastMessageAt = new Date();
      }
      
      // Mark that staff replied - reset spam counter for this user
      lastStaffReply.set(userId, Date.now());
      debugLog(`Staff replied to ${userId} - spam counter will reset on next message`);
    } catch (error) {
      console.error("Reply error:", error);
      await message.reply({
        content: "❌ **Error:** Unable to send DM. User may have DMs disabled.",
        allowedMentions: { repliedUser: false }
      });
    }
    return;
  }

  // Original command-based reply (fallback)
  if (message.channel.id !== STAFF_CHANNEL_ID) return;

  // /say command for announcements (text-based fallback)
  if (message.content.startsWith("/say") || message.content.startsWith(`${PREFIX}say`)) {
    // ⛔ PERMISSION CHECK
    if (!message.member.permissions.has(REQUIRED_PERMISSION)) {
      return message.reply({
        content: "❌ You do not have permission to use this command. (Requires Administrator)",
        allowedMentions: { repliedUser: false }
      });
    }

    const args = message.content.split(" ");
    const channelMention = args[1];
    const messageText = args.slice(2).join(" ");

    if (!channelMention) {
      return message.reply({
        content: `❌ **Usage:** \`/say <#channel> <message>\`\n**Example:** \`/say #announcements Hello everyone!\`\n\n💡 **Tip:** Use the slash command for better experience!`,
        allowedMentions: { repliedUser: false }
      });
    }

    const channelId = channelMention.replace(/[<>#]/g, "");
    
    try {
      const targetChannel = await client.channels.fetch(channelId);
      
      const announceEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ 
          name: message.guild.name, 
          iconURL: message.guild.iconURL() 
        })
        .setTimestamp();

      if (messageText) {
        announceEmbed.setDescription(messageText);
      }

      const attachmentFiles = [];
      if (message.attachments.size > 0) {
        message.attachments.forEach(attachment => {
          attachmentFiles.push(attachment.url);
        });

        const firstImage = message.attachments.find(a => a.contentType?.startsWith("image/"));
        if (firstImage) {
          announceEmbed.setImage(firstImage.url);
        }
      }

      await targetChannel.send({ 
        embeds: [announceEmbed],
        files: attachmentFiles
      });

      await message.reply({
        content: `✅ Message sent to ${targetChannel}`,
        allowedMentions: { repliedUser: false }
      });
      
      await message.delete().catch(() => {});
      
    } catch (error) {
      console.error("Say command error:", error);
      await message.reply({
        content: "❌ **Error:** Unable to send message. Check channel permissions and ID.",
        allowedMentions: { repliedUser: false }
      });
    }
  }

  // Reply command
  if (message.content.startsWith("/reply") || message.content.startsWith(`${PREFIX}reply`)) {
    // ⛔ PERMISSION CHECK
    if (!message.member.permissions.has(REQUIRED_PERMISSION)) {
      return message.reply({
        content: "❌ You do not have permission to use this command. (Requires Administrator)",
        allowedMentions: { repliedUser: false }
      });
    }

    const content = message.content.replace(/^(\/reply|!reply)\s+/, "");
    const args = content.split(" ");
    const userId = args[0];
    const replyMessage = args.slice(1).join(" ");

    if (!userId || !replyMessage) {
      return message.reply({
        content: `❌ **Usage:** \`${PREFIX}reply <userId> <message>\`\n**Example:** \`${PREFIX}reply 123456789 Hello!\``,
        allowedMentions: { repliedUser: false }
      });
    }

    try {
      const user = await client.users.fetch(userId);
      
      const replyEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: "Staff Response", iconURL: message.guild?.iconURL() })
        .setDescription(replyMessage)
        .setTimestamp();

      await user.send({ embeds: [replyEmbed] });

      const confirmEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setDescription(`✅ **Reply sent to ${user.tag}**`)
        .setTimestamp();

      await message.reply({ embeds: [confirmEmbed], allowedMentions: { repliedUser: false } });
    } catch (error) {
      console.error("Reply error:", error);
      await message.reply({
        content: "❌ **Error:** Unable to send DM.",
        allowedMentions: { repliedUser: false }
      });
    }
  }
  
  // Close conversation command
  else if (message.content.startsWith(`${PREFIX}close`)) {
    // ⛔ PERMISSION CHECK
    if (!message.member.permissions.has(REQUIRED_PERMISSION)) {
      return message.reply({
        content: "❌ You do not have permission to use this command. (Requires Administrator)",
        allowedMentions: { repliedUser: false }
      });
    }

    const userId = message.content.split(" ")[1];
    if (userId && activeThreads.has(userId)) {
      const threadId = activeThreads.get(userId);
      const thread = await message.guild.channels.fetch(threadId).catch(() => null);
      
      if (thread) {
        await thread.delete("Ticket closed by staff");
        activeThreads.delete(userId);
        activeConversations.delete(userId);
        await message.reply(`✅ Closed and deleted thread for <@${userId}>`);
      }
    }
  }
  
  // List active conversations
  else if (message.content === `${PREFIX}conversations`) {
    // ⛔ PERMISSION CHECK
    if (!message.member.permissions.has(REQUIRED_PERMISSION)) {
      return message.reply({
        content: "❌ You do not have permission to use this command. (Requires Administrator)",
        allowedMentions: { repliedUser: false }
      });
    }

    if (activeConversations.size === 0) {
      return message.reply("🔭 No active conversations.");
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("📬 Active Conversations")
      .setTimestamp();

    for (const [userId, data] of activeConversations) {
      const user = await client.users.fetch(userId).catch(() => null);
      const userName = user ? user.tag : `Unknown (${userId})`;
      embed.addFields({
        name: userName,
        value: `Messages: ${data.messageCount} | Last: <t:${Math.floor(data.lastMessageAt.getTime() / 1000)}:R>\nThread: <#${data.threadId}>`,
        inline: false
      });
    }

    await message.reply({ embeds: [embed] });
  }
});

// ===============
// BUTTON INTERACTION & SLASH COMMANDS
// ===============
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle Buttons
  if (interaction.isButton()) {
    // Close Ticket Button
    if (interaction.customId.startsWith("closeticket_")) {
      // ⛔ PERMISSION CHECK for button
      if (!interaction.member.permissions.has(REQUIRED_PERMISSION)) {
        return interaction.reply({
          content: "❌ You do not have permission to close tickets. (Requires Administrator)",
          ephemeral: true
        });
      }

      const userId = interaction.customId.split("_")[1];
      
      try {
        const user = await client.users.fetch(userId);
        const closeEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle("🔒 Ticket Closed")
          .setDescription("Your support ticket has been closed by staff. If you need further assistance, feel free to send another message!")
          .setTimestamp();
        
        await user.send({ embeds: [closeEmbed] }).catch(() => {});
        await interaction.channel.delete("Ticket closed by staff");

        activeThreads.delete(userId);
        activeConversations.delete(userId);

      } catch (error) {
        console.error("Error closing ticket:", error);
        await interaction.reply({
          content: "❌ Error closing ticket. The thread will remain open.",
          ephemeral: true
        });
      }
    }
    return;
  }

  // Handle Slash Commands
  if (interaction.isChatInputCommand()) {
    // ⛔ ADMIN CHECK (Only Admin can use slash commands)
    if (!interaction.member.permissions.has(REQUIRED_PERMISSION)) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command. (Requires Administrator)",
        ephemeral: true
      });
    }

    const { commandName } = interaction;

    // /say command
    if (commandName === 'say') {
      // ✅ CHANGE 2: Make channel optional, default to current channel
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const message = interaction.options.getString('message');
      const embedOption = interaction.options.getBoolean('embed');
      const attachment = interaction.options.getAttachment('attachment');

      try {
        if (embedOption === null || embedOption === false) {
          const files = attachment ? [attachment.url] : [];

          await channel.send({
            content: message,
            files: files
          });

          return interaction.reply({
            content: `📨 Normal message sent to ${channel}`,
            ephemeral: true
          });
        }

        const announceEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setAuthor({
            name: interaction.guild.name,
            iconURL: interaction.guild.iconURL()
          })
          .setDescription(message)
          .setTimestamp();

        const files = [];
        if (attachment) {
          files.push(attachment.url);
          if (attachment.contentType?.startsWith("image/")) {
            announceEmbed.setImage(attachment.url);
          }
        }

        await channel.send({
          embeds: [announceEmbed],
          files: files
        });

        await interaction.reply({
          content: `📨 Embed message sent to ${channel}`,
          ephemeral: true
        });

      } catch (error) {
        console.error("Say command error:", error);
        await interaction.reply({
          content: "❌ Error sending message. Check permissions.",
          ephemeral: true
        });
      }
    }

    // /reply command
    if (commandName === 'reply') {
      const userId = interaction.options.getString('userid');
      const replyMessage = interaction.options.getString('message');

      try {
        const user = await client.users.fetch(userId);
        
        const replyEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: "Staff Response", iconURL: interaction.guild?.iconURL() })
          .setDescription(replyMessage)
          .setTimestamp();

        await user.send({ embeds: [replyEmbed] });

        await interaction.reply({
          content: `✅ Reply sent to ${user.tag}`,
          ephemeral: true
        });

      } catch (error) {
        console.error("Reply error:", error);
        await interaction.reply({
          content: "❌ Unable to send DM to user.",
          ephemeral: true
        });
      }
    }

    // /close command
    if (commandName === 'close') {
      const userId = interaction.options.getString('userid');
      
      if (activeThreads.has(userId)) {
        try {
          const threadId = activeThreads.get(userId);
          const thread = await interaction.guild.channels.fetch(threadId);
          
          const user = await client.users.fetch(userId);
          const closeEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle("🔒 Ticket Closed")
            .setDescription("Your support ticket has been closed by staff. If you need further assistance, feel free to send another message!")
            .setTimestamp();
          
          await user.send({ embeds: [closeEmbed] }).catch(() => {});
          await thread.delete("Ticket closed by staff");

          activeThreads.delete(userId);
          activeConversations.delete(userId);

          await interaction.reply({
            content: `✅ Ticket closed for ${user.tag}`,
            ephemeral: true
          });

        } catch (error) {
          console.error("Close error:", error);
          await interaction.reply({
            content: "❌ Error closing ticket.",
            ephemeral: true
          });
        }
      } else {
        await interaction.reply({
          content: "❌ No active ticket found for this user.",
          ephemeral: true
        });
      }
    }

    // /conversations command
    if (commandName === 'conversations') {
      if (activeConversations.size === 0) {
        return interaction.reply({
          content: "🔭 No active conversations.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("📬 Active Conversations")
        .setTimestamp();

      for (const [userId, data] of activeConversations) {
        const user = await client.users.fetch(userId).catch(() => null);
        const userName = user ? user.tag : `Unknown (${userId})`;
        embed.addFields({
          name: userName,
          value: `Messages: ${data.messageCount} | Last: <t:${Math.floor(data.lastMessageAt.getTime() / 1000)}:R>\nThread: <#${data.threadId}>`,
          inline: false
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
});

// ===============
// READY EVENT
// ===============
let isReady = false; // Prevent multiple ready events

client.once(Events.ClientReady, async () => {
  if (isReady) {
    console.log("⚠️ Bot already ready, skipping duplicate ready event");
    return;
  }
  isReady = true;
  
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log(`📬 ModMail ready | Staff Channel: ${STAFF_CHANNEL_ID}`);
  console.log(`🔐 Required Permission: Administrator`);
  console.log(`🔥 Features: Private Threads, Direct Replies, Auto-Close, File Support, Announcements`);
  console.log(`💡 Staff can reply directly in threads - no commands needed!`);
  console.log(`🔧 Commands: ${PREFIX}reply, ${PREFIX}close, ${PREFIX}conversations, /say`);
  console.log(`\n🔍 Debug Mode: ${DEBUG ? 'ENABLED' : 'DISABLED'}`);

  client.user.setPresence({
    activities: [{ 
      name: 'DM me for any help', 
      type: ActivityType.Custom 
    }],
    status: 'online'
  });
  console.log(`\n✅ Bot status set: "DM me for any help"`);
  
  try {
    const staffChannel = await client.channels.fetch(STAFF_CHANNEL_ID);
    console.log(`✅ Staff channel found: #${staffChannel.name}`);
    
    const botMember = staffChannel.guild.members.cache.get(client.user.id);
    const permissions = staffChannel.permissionsFor(botMember);
    
    console.log("\n📋 Bot Permissions Check:");
    console.log(`  - View Channel: ${permissions.has(PermissionFlagsBits.ViewChannel) ? '✅' : '❌'}`);
    console.log(`  - Send Messages: ${permissions.has(PermissionFlagsBits.SendMessages) ? '✅' : '❌'}`);
    console.log(`  - Create Public Threads: ${permissions.has(PermissionFlagsBits.CreatePublicThreads) ? '✅' : '❌'}`);
    console.log(`  - Send Messages in Threads: ${permissions.has(PermissionFlagsBits.SendMessagesInThreads) ? '✅' : '❌'}`);
    console.log(`  - Manage Threads: ${permissions.has(PermissionFlagsBits.ManageThreads) ? '✅' : '❌'}`);
    console.log(`  - Attach Files: ${permissions.has(PermissionFlagsBits.AttachFiles) ? '✅' : '❌'}`);
    
  } catch (error) {
    console.error(`❌ Error accessing staff channel: ${error.message}`);
  }
  
  console.log("\n🚀 Bot is ready to receive DMs!");
  console.log("📨 Send a DM to the bot to test the system.\n");
});

// ===============
// ERROR HANDLING
// ===============
client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

// Login
client.login(process.env.BOT_TOKEN);