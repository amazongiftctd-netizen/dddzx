const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

// ─────────────────────────────────────────
//  CONFIG — fill these in before running
// ─────────────────────────────────────────
const CONFIG = {
  TOKEN: process.env.TOKEN,
  CHEF_ROLE_ID: "1519592994389495929",
  ADMIN_ROLE_ID: "1519593159967903854",
  DOORDASH_CATEGORY_ID: "1519589134153547918",  // Category for DoorDash orders
  UBEREATS_CATEGORY_ID: "1519589134153547918",  // Category for Uber Eats orders — change to a different ID if you want separate categories
  REVIEW_CHANNEL_ID: "1519589104474652772",
};

// Brand colors
const COLORS = {
  gold: 0xFFD700,
  green: 0x2ECC71,
  red: 0xE74C3C,
  orange: 0xFF6B35,
  purple: 0x9B59B6,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// In-memory ticket store  { channelId: { userId, service, address, stage } }
const tickets = new Map();
// Waiting for address  { userId: { service, interaction } }
const awaitingAddress = new Map();

// ─────────────────────────────────────────
//  READY
// ─────────────────────────────────────────
client.once("ready", () => {
  console.log(`✅ Deluxe Bites bot is live as ${client.user.tag}`);
});

// ─────────────────────────────────────────
//  !setup  — post the order panel
// ─────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.content === "!setup" && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    const embed = new EmbedBuilder()
      .setTitle("🍽️  DELUXE BITES")
      .setDescription(
        "### Welcome to **Deluxe Bites** — premium delivery at your fingertips.\n\n" +
        "Choose your delivery platform below to place your order.\n" +
        "A chef will be assigned to you shortly after you submit your address.\n\n" +
        "─────────────────────────────"
      )
      .setColor(COLORS.gold)
      .setThumbnail("https://cdn.discordapp.com/emojis/1234567890.png") // optional logo
      .addFields(
        { name: "🟥  DoorDash", value: "Fast delivery · Real-time tracking", inline: true },
        { name: "⬛  Uber Eats", value: "Reliable delivery · Live ETA", inline: true }
      )
      .setImage("https://i.imgur.com/QkIa5tT.png") // decorative banner (optional)
      .setFooter({ text: "Deluxe Bites • Fine Food Delivered", iconURL: message.guild.iconURL() })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("order_doordash")
        .setLabel("Order via DoorDash")
        .setEmoji("🔴")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("order_ubereats")
        .setLabel("Order via Uber Eats")
        .setEmoji("⬛")
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }
});

// ─────────────────────────────────────────
//  BUTTON INTERACTIONS
// ─────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {

  // ── ORDER BUTTONS ──
  if (interaction.isButton() && (interaction.customId === "order_doordash" || interaction.customId === "order_ubereats")) {
    const service = interaction.customId === "order_doordash" ? "DoorDash" : "Uber Eats";
    const emoji   = service === "DoorDash" ? "🔴" : "⬛";

    // Store pending address request
    awaitingAddress.set(interaction.user.id, { service, guildId: interaction.guild.id });

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${service} Order — Deluxe Bites`)
      .setDescription(
        `Great choice! You selected **${service}**.\n\n` +
        `📍 **Please type your full delivery address in this channel.**\n` +
        `*(Your address is only visible to our team)*\n\n` +
        `> Type \`cancel\` at any time to cancel.`
      )
      .setColor(service === "DoorDash" ? COLORS.red : 0x1A1A1A)
      .setFooter({ text: "Deluxe Bites • Awaiting your address..." });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // ── CHEF BUTTONS: COMPLETED / ISSUE ──
  if (interaction.isButton() && (interaction.customId.startsWith("chef_complete_") || interaction.customId.startsWith("chef_issue_"))) {
    const isComplete = interaction.customId.startsWith("chef_complete_");
    const ticketChannelId = interaction.channel.id;
    const ticket = tickets.get(ticketChannelId);

    if (!ticket) {
      return interaction.reply({ content: "❌ Ticket data not found.", ephemeral: true });
    }

    // Chef-only check
    const member = interaction.member;
    if (!member.roles.cache.has(CONFIG.CHEF_ROLE_ID)) {
      return interaction.reply({ content: "❌ Only **Chefs** can use these buttons.", ephemeral: true });
    }

    if (isComplete) {
      // ── MARK COMPLETE ──
      ticket.stage = "completed";
      tickets.set(ticketChannelId, ticket);

      const doneEmbed = new EmbedBuilder()
        .setTitle("✅  Order Completed!")
        .setDescription(
          `<@${ticket.userId}> Your order has been marked **completed** by our chef!\n\n` +
          `📸 **Please post a photo of your food OR leave a review below!**\n` +
          `Your review will be shared in our reviews channel.\n\n` +
          `> Type your review or drop a photo — we love the feedback! 💬`
        )
        .setColor(COLORS.green)
        .setFooter({ text: "Deluxe Bites • Thank you for ordering!" })
        .setTimestamp();

      // Disable chef buttons, add review prompt
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("chef_complete_done").setLabel("✅ Completed").setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId("chef_issue_done").setLabel("⚠️ Issue").setStyle(ButtonStyle.Danger).setDisabled(true)
      );

      await interaction.update({ components: [disabledRow] });
      await interaction.channel.send({ embeds: [doneEmbed] });

      // Grant user permission to post in ticket
      await interaction.channel.permissionOverwrites.edit(ticket.userId, {
        SendMessages: true,
        AttachFiles: true,
      });

    } else {
      // ── MARK ISSUE ──
      ticket.stage = "issue";
      tickets.set(ticketChannelId, ticket);

      const issueEmbed = new EmbedBuilder()
        .setTitle("⚠️  Issue Reported")
        .setDescription(
          `<@&${CONFIG.ADMIN_ROLE_ID}> — An issue has been flagged on this ticket!\n\n` +
          `**Customer:** <@${ticket.userId}>\n` +
          `**Service:** ${ticket.service}\n` +
          `**Address:** ${ticket.address}\n\n` +
          `Please look into this immediately.`
        )
        .setColor(COLORS.red)
        .setFooter({ text: "Deluxe Bites • Issue Alert" })
        .setTimestamp();

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("chef_complete_done").setLabel("✅ Completed").setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId("chef_issue_done").setLabel("⚠️ Issue").setStyle(ButtonStyle.Danger).setDisabled(true)
      );

      await interaction.update({ components: [disabledRow] });
      await interaction.channel.send({ embeds: [issueEmbed] });
    }
    return;
  }
});

// ─────────────────────────────────────────
//  MESSAGE LISTENER — address + reviews
// ─────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ── ADDRESS COLLECTION ──
  if (awaitingAddress.has(message.author.id)) {
    const { service, guildId } = awaitingAddress.get(message.author.id);

    if (message.content.toLowerCase() === "cancel") {
      awaitingAddress.delete(message.author.id);
      return;
    }

    // Only catch messages outside of ticket channels (DMs or order channel)
    // We collect from wherever they typed — if you want DM collection swap logic here
    const address = message.content;
    awaitingAddress.delete(message.author.id);

    const guild = client.guilds.cache.get(guildId) || message.guild;
    if (!guild) return;

    // ── CREATE TICKET CHANNEL ──
    const safeUsername = message.author.username.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const categoryId = service === "DoorDash" ? CONFIG.DOORDASH_CATEGORY_ID : CONFIG.UBEREATS_CATEGORY_ID;
    const channelPrefix = service === "DoorDash" ? "dd" : "ue";
    const ticketChannel = await guild.channels.create({
      name: `${channelPrefix}-${safeUsername}-order`,
      type: ChannelType.GuildText,
      parent: categoryId || null,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: message.author.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
        { id: CONFIG.CHEF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
    });

    // Save ticket
    tickets.set(ticketChannel.id, {
      userId: message.author.id,
      service,
      address,
      stage: "open",
    });

    const serviceEmoji = service === "DoorDash" ? "🔴" : "⬛";

    const ticketEmbed = new EmbedBuilder()
      .setTitle(`${serviceEmoji}  New Order — Deluxe Bites`)
      .setDescription(`A new order has come in! <@&${CONFIG.CHEF_ROLE_ID}>`)
      .setColor(service === "DoorDash" ? COLORS.red : 0x1A1A1A)
      .addFields(
        { name: "👤  Customer", value: `<@${message.author.id}>`, inline: true },
        { name: "🚗  Delivery Service", value: `**${service}**`, inline: true },
        { name: "📍  Delivery Address", value: `\`\`\`${address}\`\`\``, inline: false },
        { name: "📋  Status", value: "🟡 Awaiting Chef", inline: true },
      )
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: "Deluxe Bites • Order System" })
      .setTimestamp();

    const chefRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`chef_complete_${ticketChannel.id}`)
        .setLabel("Mark Completed")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`chef_issue_${ticketChannel.id}`)
        .setLabel("Report Issue")
        .setEmoji("⚠️")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `<@&${CONFIG.CHEF_ROLE_ID}>`,
      embeds: [ticketEmbed],
      components: [chefRow],
    });

    // Chef will be with you shortly
    const chefSoonEmbed = new EmbedBuilder()
      .setDescription("👨‍🍳  **A chef will be with you shortly!** Sit tight, your order is being prepared.")
      .setColor(COLORS.gold);

    await ticketChannel.send({ embeds: [chefSoonEmbed] });

    // DM or reply the customer with their ticket link
    try {
      await message.author.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🍽️ Order Placed — Deluxe Bites")
            .setDescription(`Your order has been received!\n\n📍 **Address:** ${address}\n🚗 **Service:** ${service}\n\n👉 Track your order here: ${ticketChannel}`)
            .setColor(COLORS.gold)
        ]
      });
    } catch {}

    return;
  }

  // ── REVIEW / PHOTO COLLECTION ──
  const ticket = tickets.get(message.channel.id);
  if (ticket && ticket.stage === "completed" && message.author.id === ticket.userId) {
    const reviewChannel = client.channels.cache.get(CONFIG.REVIEW_CHANNEL_ID);
    if (!reviewChannel) return;

    const reviewEmbed = new EmbedBuilder()
      .setTitle("⭐  New Review — Deluxe Bites")
      .setDescription(message.content || "*No text — see attached image*")
      .setColor(COLORS.purple)
      .addFields(
        { name: "👤  Customer", value: `<@${message.author.id}>`, inline: true },
        { name: "🚗  Service Used", value: ticket.service, inline: true },
      )
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: "Deluxe Bites • Customer Review" })
      .setTimestamp();

    // Forward any image attachments
    const files = [...message.attachments.values()].map(a => a.url);

    await reviewChannel.send({ embeds: [reviewEmbed], files });

    await message.react("⭐");
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription("💜 Thanks for your review! It's been posted to our reviews channel.")
          .setColor(COLORS.purple)
      ]
    });

    // Close ticket after review
    ticket.stage = "reviewed";
    tickets.set(message.channel.id, ticket);

    setTimeout(async () => {
      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setDescription("🔒 This ticket will be archived. Thank you for choosing **Deluxe Bites**!")
            .setColor(COLORS.gold)
        ]
      });
    }, 3000);
  }
});

client.login(CONFIG.TOKEN);
