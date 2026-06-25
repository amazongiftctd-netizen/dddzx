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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const CONFIG = {
  TOKEN: process.env.TOKEN,
  CHEF_ROLE_ID: "1519592994389495929",
  ADMIN_ROLE_ID: "1519593159967903854",
  DOORDASH_CATEGORY_ID: "1519604859551219742",
  UBEREATS_CATEGORY_ID: "1519604859551219742",
  REVIEW_CHANNEL_ID: "1519589104474652772",
  COMPLETED_CHANNEL_ID: "1519606120925233293",
  COMPLETED_ROLE_ID: "1519608257017151518",
};

const COLORS = {
  gold: 0xFFD700,
  green: 0x2ECC71,
  red: 0xE74C3C,
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

const tickets = new Map();

client.once("ready", () => {
  console.log(`✅ Deluxe Bites bot is live as ${client.user.tag}`);
});

// ── !setup — post the order panel ──
client.on("messageCreate", async (message) => {
  if (message.content === "!setup" && message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    const embed = new EmbedBuilder()
      .setTitle("🍽️  DELUXE BITES")
      .setDescription(
        "### Welcome to **Deluxe Bites** — premium delivery at your fingertips.\n\n" +
        "Choose your delivery platform below to place your order.\n" +
        "A chef will be assigned to you shortly after you submit your address.\n\n" +
        "─────────────────────────────"
      )
      .setColor(COLORS.gold)
      .addFields(
        { name: "🔴  DoorDash", value: "Fast delivery · Real-time tracking", inline: true },
        { name: "⬛  Uber Eats", value: "Reliable delivery · Live ETA", inline: true }
      )
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

// ── ALL INTERACTIONS ──
client.on("interactionCreate", async (interaction) => {

  // ── ORDER BUTTONS → open modal ──
  if (interaction.isButton() && (interaction.customId === "order_doordash" || interaction.customId === "order_ubereats")) {
    const service = interaction.customId === "order_doordash" ? "DoorDash" : "Uber Eats";

    const modal = new ModalBuilder()
      .setCustomId(`address_modal_${interaction.customId === "order_doordash" ? "doordash" : "ubereats"}`)
      .setTitle(`${service} — Enter Delivery Address`);

    const addressInput = new TextInputBuilder()
      .setCustomId("address_input")
      .setLabel("Your Full Delivery Address")
      .setPlaceholder("e.g. 14235 Main St, Houston, TX 77038")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(5)
      .setMaxLength(200);

    modal.addComponents(new ActionRowBuilder().addComponents(addressInput));
    await interaction.showModal(modal);
    return;
  }

  // ── MODAL SUBMIT → create ticket ──
  if (interaction.isModalSubmit() && interaction.customId.startsWith("address_modal_")) {
    const service = interaction.customId === "address_modal_doordash" ? "DoorDash" : "Uber Eats";
    const address = interaction.fields.getTextInputValue("address_input");
    const guild = interaction.guild;
    const user = interaction.user;

    // Reply immediately so Discord does not time out
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription("⏳ Creating your order ticket, one second...")
          .setColor(COLORS.gold)
      ],
      ephemeral: true
    });

    const safeUsername = user.username.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const categoryId = service === "DoorDash" ? CONFIG.DOORDASH_CATEGORY_ID : CONFIG.UBEREATS_CATEGORY_ID;
    const channelPrefix = service === "DoorDash" ? "dd" : "ue";

    const ticketChannel = await guild.channels.create({
      name: `${channelPrefix}-${safeUsername}-order`,
      type: ChannelType.GuildText,
      parent: categoryId || null,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
        { id: CONFIG.CHEF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ],
    });

    tickets.set(ticketChannel.id, {
      userId: user.id,
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
        { name: "👤  Customer", value: `<@${user.id}>`, inline: true },
        { name: "🚗  Delivery Service", value: `**${service}**`, inline: true },
        { name: "📍  Delivery Address", value: `\`\`\`${address}\`\`\``, inline: false },
        { name: "📋  Status", value: "🟡 Awaiting Chef", inline: true },
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
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
      content: `<@&${CONFIG.CHEF_ROLE_ID}> — A new order just came in! 👨‍🍳`,
      embeds: [ticketEmbed],
      components: [chefRow],
    });

    await ticketChannel.send({
      embeds: [
        new EmbedBuilder()
          .setDescription(`👨‍🍳 **A chef will be with you shortly** <@${user.id}>! Sit tight, your order is being prepared.`)
          .setColor(COLORS.gold)
      ]
    });

    await interaction.followUp({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Order Placed!")
          .setDescription(`Your **${service}** order has been received!\n\n📍 **Address:** ${address}\n\n👉 Track your order: ${ticketChannel}`)
          .setColor(COLORS.gold)
          .setFooter({ text: "Deluxe Bites • Thank you for ordering!" })
      ],
      ephemeral: true
    });
    return;
  }

  // ── CHEF BUTTONS: COMPLETED / ISSUE ──
  if (interaction.isButton() && (interaction.customId.startsWith("chef_complete_") || interaction.customId.startsWith("chef_issue_"))) {
    const isComplete = interaction.customId.startsWith("chef_complete_");
    const ticket = tickets.get(interaction.channel.id);

    if (!ticket) return interaction.reply({ content: "❌ Ticket data not found.", ephemeral: true });

    if (!interaction.member.roles.cache.has(CONFIG.CHEF_ROLE_ID)) {
      return interaction.reply({ content: "❌ Only **Chefs** can use these buttons.", ephemeral: true });
    }

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("chef_complete_done").setLabel("Mark Completed").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId("chef_issue_done").setLabel("Report Issue").setEmoji("⚠️").setStyle(ButtonStyle.Danger).setDisabled(true)
    );

    if (isComplete) {
      ticket.stage = "completed";
      tickets.set(interaction.channel.id, ticket);

      await interaction.update({ components: [disabledRow] });

      // Notify in ticket
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅  Order Completed!")
            .setDescription(
              `<@${ticket.userId}> Your order has been marked **completed** by our chef!\n\n` +
              `📸 **Post a photo of your food or leave a review below!**\n` +
              `Your review will be shared in our reviews channel. 💬`
            )
            .setColor(COLORS.green)
            .setFooter({ text: "Deluxe Bites • Thank you for ordering!" })
            .setTimestamp()
        ]
      });

      // Log to completed channel
      const completedChannel = client.channels.cache.get(CONFIG.COMPLETED_CHANNEL_ID);
      if (completedChannel) {
        await completedChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅  Order Completed — Deluxe Bites")
              .setColor(COLORS.green)
              .addFields(
                { name: "👤  Customer", value: `<@${ticket.userId}>`, inline: true },
                { name: "🚗  Service", value: ticket.service, inline: true },
              )
              .setFooter({ text: "Deluxe Bites • Completed Orders" })
              .setTimestamp()
          ]
        });
      }

      // Give customer back send + attach perms
      await interaction.channel.permissionOverwrites.edit(ticket.userId, {
        SendMessages: true,
        AttachFiles: true,
        ViewChannel: true,
        ReadMessageHistory: true,
      });

      // Give customer the completed role
      try {
        const member = await interaction.guild.members.fetch(ticket.userId);
        await member.roles.add(CONFIG.COMPLETED_ROLE_ID);
      } catch (e) {
        console.error("Could not assign completed role:", e);
      }

    } else {
      ticket.stage = "issue";
      tickets.set(interaction.channel.id, ticket);

      await interaction.update({ components: [disabledRow] });

      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("⚠️  Issue Reported")
            .setDescription(
              `<@&${CONFIG.ADMIN_ROLE_ID}> — An issue has been flagged!\n\n` +
              `**Customer:** <@${ticket.userId}>\n` +
              `**Service:** ${ticket.service}\n` +
              `**Address:** ${ticket.address}\n\n` +
              `Please look into this immediately.`
            )
            .setColor(COLORS.red)
            .setFooter({ text: "Deluxe Bites • Issue Alert" })
            .setTimestamp()
        ]
      });
    }
    return;
  }
});

// ── REVIEW / PHOTO COLLECTION ──
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const ticket = tickets.get(message.channel.id);
  if (ticket && ticket.stage === "completed" && message.author.id === ticket.userId) {
    const reviewChannel = client.channels.cache.get(CONFIG.REVIEW_CHANNEL_ID);
    if (!reviewChannel) return;

    const files = [...message.attachments.values()].map(a => a.url);

    await reviewChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("⭐  New Review — Deluxe Bites")
          .setDescription(message.content || "*No text — see attached image*")
          .setColor(COLORS.purple)
          .addFields(
            { name: "👤  Customer", value: `<@${message.author.id}>`, inline: true },
            { name: "🚗  Service Used", value: ticket.service, inline: true },
          )
          .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: "Deluxe Bites • Customer Review" })
          .setTimestamp()
      ],
      files,
    });

    await message.react("⭐");
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription("💜 Thanks for your review! It's been posted to our reviews channel.")
          .setColor(COLORS.purple)
      ]
    });

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
