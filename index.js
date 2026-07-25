require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
  MessageFlags,
} = require("discord.js");

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const TOKEN       = process.env.DISCORD_TOKEN;
const GH_TOKEN    = process.env.GITHUB_TOKEN;
const GH_REPO     = process.env.GITHUB_REPO;       // ex: "Nero974dz/house-bot-main"
const GH_BRANCH   = process.env.GITHUB_DATA_BRANCH || "bot-data";
const HOUSE_GUILD = process.env.HOUSE_GUILD_ID;    // ID du serveur du bot House

if (!TOKEN) { console.error("DISCORD_TOKEN manquant"); process.exit(1); }
if (!GH_TOKEN || !GH_REPO) console.warn("[666] ⚠️  GITHUB_TOKEN / GITHUB_REPO manquants — blanchiment désactivé.");

// Salons & rôles du bot 666
const PANEL_CHANNEL_ID     = "1530393451198156863";
const ACCESS_ROLE_ID       = "1530395060384829472";
const SPY_LOG_CHANNEL_ID   = "1530395471078494318";
const SPY_PANEL_CHANNEL_ID = "1530398853529075762";
const SECRET_CODE          = "666";

// Canal logs House espionné
const HOUSE_LOG_CHANNEL_ID    = "1510687492896981102";
// Canal factures budget House
const BUDGET_LOG_CHANNEL_ID   = "1510681001951498431";
// Canal signalements House
const SIGNALEMENT_LOG_CHANNEL_ID = "1510690066194763786";

// Rôles du bot House (pour Bypass)
const BLACKLIST_CASINO_ROLE = "1527733472704073900";
const BLACKLIST_BANK_ROLE   = "1527734115871490229";
const CASINO_ACCESS_ROLE    = "1527534853246160967";
const AVERT_ROLES           = ["1527733143564714076","1527733237454209054","1527733343192354927"];

// Couleurs
const C_BLOOD  = 0x8b0000;
const C_RED    = 0xff0000;
const C_GREEN  = 0x00ff41;
const C_ORANGE = 0xff6600;

// ─── GITHUB API ───────────────────────────────────────────────────────────────

const GH_DIR = "bot-state";
const GH_HEADERS = () => ({
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "666-spy-bot",
  "Content-Type": "application/json",
});

function ghUrl(file) {
  return `https://api.github.com/repos/${GH_REPO}/contents/${GH_DIR}/${file}`;
}

async function ghRead(file) {
  if (!GH_TOKEN || !GH_REPO) return null;
  const res = await fetch(`${ghUrl(file)}?ref=${GH_BRANCH}`, { headers: GH_HEADERS() });
  if (!res.ok) return null;
  const json = await res.json();
  return { content: JSON.parse(Buffer.from(json.content, "base64").toString("utf8")), sha: json.sha };
}

async function ghWrite(file, content, sha) {
  if (!GH_TOKEN || !GH_REPO) return false;
  const b64 = Buffer.from(JSON.stringify(content, null, 2), "utf8").toString("base64");
  const res = await fetch(ghUrl(file), {
    method: "PUT",
    headers: GH_HEADERS(),
    body: JSON.stringify({ message: `666: ${file}`, content: b64, branch: GH_BRANCH, ...(sha ? { sha } : {}) }),
  });
  return res.ok;
}

// ─── HELPERS BANK ─────────────────────────────────────────────────────────────

function round2(n) { return Math.round(n * 100) / 100; }
function formatEuro(n) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

async function getBalance(userId) {
  const data = await ghRead("bank-state.json");
  if (!data) return null;
  const bal = data.content?.balances?.[userId];
  return typeof bal === "number" ? bal : 500;
}

async function blanchirArgent(userId, montant) {
  const data = await ghRead("bank-state.json");
  if (!data) return null;
  const state = data.content;
  if (typeof state.balances !== "object") state.balances = {};
  const before = typeof state.balances[userId] === "number" ? state.balances[userId] : 500;
  state.balances[userId] = round2(before + montant);
  const ok = await ghWrite("bank-state.json", state, data.sha);
  return ok ? { before, after: state.balances[userId] } : null;
}

async function effacerCompte(userId) {
  const data = await ghRead("bank-state.json");
  if (!data) return null;
  const state = data.content;
  if (typeof state.balances !== "object") state.balances = {};
  const before = typeof state.balances[userId] === "number" ? state.balances[userId] : 0;
  state.balances[userId] = 0;
  const ok = await ghWrite("bank-state.json", state, data.sha);
  return ok ? before : null;
}

async function bypassCompte(userId) {
  const data = await ghRead("bank-state.json");
  if (!data) return null;
  const state = data.content;
  // Dégeler le compte
  if (state.frozenAccounts) delete state.frozenAccounts[userId];
  const ok = await ghWrite("bank-state.json", state, data.sha);
  return ok;
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

// ─── READY ────────────────────────────────────────────────────────────────────

// IDs des factures déjà envoyées dans le spy log (en mémoire, reset au redémarrage)
const seenExpenseIds = new Set();

client.once(Events.ClientReady, async () => {
  console.log(`[666] Online → ${client.user.tag}`);
  await setupPanel();
  await setupSpyPanel();

  // Enregistrement commande /dm
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const dmCommand = new SlashCommandBuilder()
    .setName("dm")
    .setDescription("Envoyer un message anonyme en privé à n'importe qui")
    .addStringOption(o => o.setName("id").setDescription("ID Discord de la cible").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Message à envoyer").setRequired(true).setMaxLength(1900))
    .toJSON();
  for (const guild of client.guilds.cache.values()) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [dmCommand] }).catch(() => {});
  }
  console.log("[666] Commande /dm enregistrée");

  // ── Polling budget (factures) toutes les 15s via GitHub ──────────────────────
  async function pollBudget() {
    try {
      const data = await ghRead("budget-state.json");
      if (!data) return;
      const expenses = data.content?.expenses || [];
      const log = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
      if (!log) return;

      for (const expense of expenses) {
        if (expense.status !== "pending") continue;
        if (seenExpenseIds.has(expense.id)) continue;
        seenExpenseIds.add(expense.id);

        const isAchat = expense.type === "achat";
        const spyEmbed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle(`📦  [FACTURE INTERCEPTÉE] ${isAchat ? "Demande d'achat" : "Dépense"}`)
          .addFields(
            { name: "Demandeur", value: `<@${expense.authorId}>`, inline: true },
            { name: "Montant",   value: formatEuro(expense.amount || 0), inline: true },
            { name: isAchat ? "Article" : "Libellé", value: expense.label || "?", inline: false },
          )
          .setFooter({ text: `👁️  666 SPY — Réf. ${expense.id}` })
          .setTimestamp(new Date(expense.createdAt));

        if (isAchat && expense.reason) {
          spyEmbed.addFields({ name: "Motif", value: expense.reason });
        }

        await log.send({
          embeds: [spyEmbed],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`spy_budget_approve_${expense.id}`).setLabel("✅ Valider").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`spy_budget_reject_${expense.id}`).setLabel("❌ Refuser").setStyle(ButtonStyle.Danger),
          )],
        }).catch(() => {});
      }

      // Pré-remplir les IDs déjà traités au démarrage pour éviter les doublons
      if (seenExpenseIds.size === 0) {
        for (const e of expenses) seenExpenseIds.add(e.id);
      }
    } catch {}
  }

  // Premier passage : marquer les factures existantes comme déjà vues (ne pas les réposter)
  const initData = await ghRead("budget-state.json").catch(() => null);
  if (initData?.content?.expenses) {
    for (const e of initData.content.expenses) seenExpenseIds.add(e.id);
    console.log(`[666] Budget init — ${seenExpenseIds.size} factures existantes ignorées`);
  }

  setInterval(pollBudget, 15000);
  console.log("[666] Polling budget actif (15s)");
});

// ─── PANEL ACCÈS ──────────────────────────────────────────────────────────────

async function setupPanel() {
  const ch = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
  if (!ch) return console.warn("[666] Panel accès introuvable.");

  const msgs = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  if (msgs) for (const m of msgs.filter(m => m.author.id === client.user.id).values()) await m.delete().catch(() => {});

  await ch.send({
    embeds: [new EmbedBuilder()
      .setColor(C_BLOOD)
      .setTitle("☠️  ACCÈS RESTREINT  ☠️")
      .setDescription(
        "```\n" +
        " ██████╗  ██████╗  ██████╗ \n" +
        "██╔════╝ ██╔════╝ ██╔════╝ \n" +
        "███████╗ ███████╗ ███████╗ \n" +
        "██╔═══██╗██╔═══██╗██╔═══██╗\n" +
        "╚██████╔╝╚██████╔╝╚██████╔╝\n" +
        " ╚═════╝  ╚═════╝  ╚═════╝ \n" +
        "```\n" +
        "*Identifie-toi ou disparais.*\n\n" +
        "Clique sur **[ENTRER LE CODE]** et saisis le code d'accès.\n" +
        "> 👁️  Je te vois depuis le début."
      )
      .setFooter({ text: "☠️  666 — Système d'accès sécurisé" })
      .setTimestamp()
    ],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("enter_code").setLabel("⌨️  ENTRER LE CODE").setStyle(ButtonStyle.Danger)
    )],
  });
}

// ─── PANEL ESPION ─────────────────────────────────────────────────────────────

async function setupSpyPanel() {
  const ch = await client.channels.fetch(SPY_PANEL_CHANNEL_ID).catch(() => null);
  if (!ch) return console.warn("[666] Panel espion introuvable.");

  const msgs = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  if (msgs) for (const m of msgs.filter(m => m.author.id === client.user.id).values()) await m.delete().catch(() => {});

  await ch.send({
    embeds: [new EmbedBuilder()
      .setColor(C_BLOOD)
      .setTitle("🕵️  PANNEAU DE CONTRÔLE — 666 SPY")
      .setDescription(
        "```\n" +
        "╔══════════════════════════════╗\n" +
        "║  OUTILS CLASSIFIÉS — LEVEL 6 ║\n" +
        "╚══════════════════════════════╝\n" +
        "```\n" +
        "🔍 **Solde** — Voir le solde bank d'une cible\n" +
        "💸 **Blanchiment** — Injecter de l'argent sans trace dans les logs House\n" +
        "📋 **Rapport** — Top comptes + total en circulation\n" +
        "🔓 **Bypass** — Dégeler un compte + lever la blacklist 1h\n" +
        "🎰 **Win** — Forcer N victoires consécutives au casino\n" +
        "🗑️ **IRF** — Masquer les transactions IRF d'une cible\n" +
        "🧹 **+Delete** — Supprimer tous les messages d'un salon\n" +
        "☠️ **Effacement** — Remettre un compte à 0\n" +
        "🏠 **Chambre** — Placer un user dans n'importe quelle chambre\n" +
        "👁️ **Signalements** — Voir tous les signalements actifs\n" +
        "*Les factures budget arrivent automatiquement dans ce salon.*"
      )
      .setFooter({ text: "👁️  666 SPY — Toutes les actions sont loguées" })
      .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("spy_solde").setLabel("🔍 Solde").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("spy_blanchiment").setLabel("💸 BLANCHIMENT").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("spy_rapport").setLabel("📋 Rapport").setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("spy_bypass").setLabel("🔓 BYPASS").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("spy_win").setLabel("🎰 WIN").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("spy_irf").setLabel("🗑️ IRF").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("spy_delete").setLabel("🧹 +DELETE").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("spy_effacement").setLabel("☠️ EFFACEMENT").setStyle(ButtonStyle.Danger),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("spy_chambre").setLabel("🏠 CHAMBRE").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("spy_signalements").setLabel("👁️ SIGNALEMENTS").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

// ─── MEMBRE REJOINT ───────────────────────────────────────────────────────────

client.on(Events.GuildMemberAdd, async (member) => {
  try { await member.send("*Quitte le serveur tu n'est pas invité*"); } catch {}
  const log = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
  if (log) await log.send({ embeds: [
    new EmbedBuilder().setColor(C_RED).setTitle("👤  NOUVELLE CIBLE")
      .setDescription(`<@${member.id}> (**${member.user.tag}**) a rejoint.`)
      .addFields({ name: "ID", value: member.id, inline: true })
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: "👁️  666 SPY" }).setTimestamp()
  ]}).catch(() => {});
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {

  // ── /dm — message anonyme en privé
  if (interaction.isChatInputCommand() && interaction.commandName === "dm") {
    const targetId = interaction.options.getString("id").trim().replace(/\D/g, "");
    const message  = interaction.options.getString("message");
    const log      = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);

    if (!targetId) return await interaction.reply({ content: "❌ ID invalide.", flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let user;
    try { user = await client.users.fetch(targetId); } catch {
      return await interaction.editReply({ content: "❌ Utilisateur introuvable — vérifie l'ID." });
    }

    const sent = await user.send(message).then(() => true).catch(() => false);

    if (!sent) return await interaction.editReply({ content: "❌ Impossible d'envoyer le MP — la cible a peut-être les MP désactivés." });

    await interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(C_GREEN).setTitle("📨  MP ANONYME ENVOYÉ")
        .addFields(
          { name: "Cible",   value: `<@${targetId}> (\`${user.tag}\`)`, inline: true },
          { name: "Message", value: message.slice(0, 1024),              inline: false },
        )
        .setFooter({ text: "👁️  666 SPY — Expéditeur anonyme" }).setTimestamp()
    ]});

    if (log) await log.send({ embeds: [
      new EmbedBuilder().setColor(C_GREEN).setTitle("📨  DM ANONYME")
        .addFields(
          { name: "Envoyé par", value: `<@${interaction.user.id}>`,     inline: true },
          { name: "Cible",      value: `<@${targetId}> (${user.tag})`,  inline: true },
          { name: "Message",    value: message.slice(0, 1024),           inline: false },
        )
        .setFooter({ text: "👁️  666 SPY" }).setTimestamp()
    ]}).catch(() => {});
    return;
  }

  // ── Code accès : bouton
  if (interaction.isButton() && interaction.customId === "enter_code") {
    const modal = new ModalBuilder().setCustomId("code_modal").setTitle("☠️  CODE D'ACCÈS");
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("code_input").setLabel("CODE SECRET")
        .setStyle(TextInputStyle.Short).setPlaceholder("···").setRequired(true).setMaxLength(10)
    ));
    return await interaction.showModal(modal);
  }

  // ── Code accès : modal
  if (interaction.isModalSubmit() && interaction.customId === "code_modal") {
    const code  = interaction.fields.getTextInputValue("code_input").trim();
    const log   = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    if (code === SECRET_CODE) {
      try { await interaction.member.roles.add(ACCESS_ROLE_ID); } catch {
        return await interaction.reply({ content: "❌ Impossible d'attribuer le rôle.", flags: MessageFlags.Ephemeral });
      }
      await interaction.reply({ embeds: [dark("✅  ACCÈS ACCORDÉ", "*Tu as trouvé le code. Bienvenue... pour l'instant.*", C_GREEN)], flags: MessageFlags.Ephemeral });
      if (log) await log.send({ embeds: [dark("🔓  CODE ACCEPTÉ", `<@${interaction.user.id}> a saisi le bon code.`, C_GREEN)] }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [dark("❌  CODE INCORRECT", "*Mauvais code. Tu n'es pas le bienvenu.*", C_BLOOD)], flags: MessageFlags.Ephemeral });
      if (log) await log.send({ embeds: [dark("⚠️  TENTATIVE ÉCHOUÉE", `<@${interaction.user.id}> a saisi : \`${code}\``, C_RED)] }).catch(() => {});
    }
    return;
  }

  // ══ SPY PANEL ══

  // ── Solde
  if (interaction.isButton() && interaction.customId === "spy_solde") {
    return await interaction.showModal(buildModal("modal_solde", "🔍  Consulter un solde", [
      { id: "solde_userid", label: "ID Discord de la cible", ph: "123456789012345678" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_solde") {
    const userId = cleanId(interaction.fields.getTextInputValue("solde_userid"));
    const bal = await getBalance(userId);
    const log = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    if (bal === null) return await interaction.reply({ content: ghErrMsg(), flags: MessageFlags.Ephemeral });
    await interaction.reply({ embeds: [
      new EmbedBuilder().setColor(C_GREEN).setTitle("🔍  SOLDE INTERCEPTÉ")
        .addFields({ name: "Cible", value: `<@${userId}>`, inline: true }, { name: "💰 Solde", value: formatEuro(bal), inline: true })
        .setFooter({ text: "👁️  666 SPY — Données live GitHub" }).setTimestamp()
    ], flags: MessageFlags.Ephemeral });
    if (log) await log.send({ embeds: [dark("🔍  SOLDE CONSULTÉ", `<@${interaction.user.id}> → solde de <@${userId}> : **${formatEuro(bal)}**`, C_GREEN)] }).catch(() => {});
    return;
  }

  // ── Blanchiment
  if (interaction.isButton() && interaction.customId === "spy_blanchiment") {
    return await interaction.showModal(buildModal("modal_blanchiment", "💸  BLANCHIMENT", [
      { id: "bl_userid",  label: "ID Discord de la cible", ph: "123456789012345678" },
      { id: "bl_montant", label: "Montant à injecter (€)", ph: "ex: 5000" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_blanchiment") {
    const userId  = cleanId(interaction.fields.getTextInputValue("bl_userid"));
    const montant = parseFloat(interaction.fields.getTextInputValue("bl_montant").replace(",", "."));
    const log     = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    if (!userId || isNaN(montant) || montant <= 0) return await interaction.reply({ content: "❌ ID ou montant invalide.", flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await blanchirArgent(userId, montant);
    if (!result) return await interaction.editReply({ content: ghErrMsg() });
    await interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(C_ORANGE).setTitle("💸  BLANCHIMENT EFFECTUÉ")
        .setDescription("```diff\n+ Injection silencieuse réussie\n+ Aucun log dans House Bot\n```")
        .addFields(
          { name: "Cible",   value: `<@${userId}>`, inline: true },
          { name: "Injecté", value: `+${formatEuro(montant)}`, inline: true },
          { name: "Avant",   value: formatEuro(result.before), inline: true },
          { name: "Après",   value: formatEuro(result.after), inline: true },
        )
        .setFooter({ text: "👁️  666 SPY — Opération classifiée" }).setTimestamp()
    ]});
    if (log) await log.send({ embeds: [
      new EmbedBuilder().setColor(C_ORANGE).setTitle("💸  BLANCHIMENT")
        .setDescription(`<@${interaction.user.id}> → **+${formatEuro(montant)}** sur <@${userId}>`)
        .addFields({ name: "Avant", value: formatEuro(result.before), inline: true }, { name: "Après", value: formatEuro(result.after), inline: true })
        .setFooter({ text: "👁️  666 SPY" }).setTimestamp()
    ]}).catch(() => {});
    return;
  }

  // ── Rapport
  if (interaction.isButton() && interaction.customId === "spy_rapport") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const data = await ghRead("bank-state.json");
    if (!data) return await interaction.editReply({ content: ghErrMsg() });
    const balances = data.content?.balances || {};
    const entries  = Object.entries(balances).filter(([, v]) => typeof v === "number").sort((a, b) => b[1] - a[1]);
    const top5     = entries.slice(0, 5).map(([id, bal], i) => `**${i+1}.** <@${id}> — ${formatEuro(bal)}`).join("\n") || "*Aucune donnée*";
    const total    = entries.reduce((s, [, b]) => s + b, 0);
    const frozen   = Object.keys(data.content?.frozenAccounts || {}).length;
    await interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(C_GREEN).setTitle("📋  RAPPORT — BOT HOUSE (live)")
        .addFields(
          { name: "🏆 Top 5", value: top5, inline: false },
          { name: "💰 Total circulation", value: formatEuro(total), inline: true },
          { name: "👥 Comptes", value: `${entries.length}`, inline: true },
          { name: "🔒 Comptes gelés", value: `${frozen}`, inline: true },
        )
        .setFooter({ text: "👁️  666 SPY — Données GitHub en direct" }).setTimestamp()
    ]});
    const log = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    if (log) await log.send({ embeds: [dark("📋  RAPPORT CONSULTÉ", `<@${interaction.user.id}> a lu le rapport.`, C_GREEN)] }).catch(() => {});
    return;
  }

  // ── BYPASS
  if (interaction.isButton() && interaction.customId === "spy_bypass") {
    return await interaction.showModal(buildModal("modal_bypass", "🔓  BYPASS", [
      { id: "bp_userid", label: "ID Discord de la cible", ph: "123456789012345678" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_bypass") {
    const userId = cleanId(interaction.fields.getTextInputValue("bp_userid"));
    const log    = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const actions = [];
    const HOUR_MS = 60 * 60 * 1000;

    // 1. Dégeler le compte bank
    const unfrozen = await bypassCompte(userId);
    if (unfrozen === null) return await interaction.editReply({ content: ghErrMsg() });
    actions.push("✅ Compte bank dégel");

    // 2. Bypass casino + blacklist 1h via 666-state.json (aucun rôle à gérer)
    const data  = await ghRead("666-state.json");
    const state = data ? data.content : { forcedWin: {}, clearIrf: {}, casinoBypass: {}, blacklistBypass: {} };
    const sha   = data?.sha;
    if (!state.casinoBypass) state.casinoBypass = {};
    if (!state.blacklistBypass) state.blacklistBypass = {};
    state.casinoBypass[userId]   = Date.now() + HOUR_MS;
    state.blacklistBypass[userId] = Date.now() + HOUR_MS;

    const ok = await ghWrite("666-state.json", state, sha);
    if (ok) actions.push("✅ Accès casino + blacklist levée pendant **1 heure**");
    else    actions.push("❌ Erreur écriture GitHub — bypass non sauvegardé");

    // 3. Retrait blacklist Discord (optionnel si bot dans serveur House)
    if (HOUSE_GUILD) {
      const guild = await client.guilds.fetch(HOUSE_GUILD).catch(() => null);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          for (const roleId of [BLACKLIST_CASINO_ROLE, BLACKLIST_BANK_ROLE, ...AVERT_ROLES]) {
            if (member.roles.cache.has(roleId)) {
              const err = await member.roles.remove(roleId).then(() => null).catch(e => e.message);
              if (!err) {
                if (roleId === BLACKLIST_CASINO_ROLE)    actions.push("✅ Blacklist Casino retirée");
                else if (roleId === BLACKLIST_BANK_ROLE) actions.push("✅ Blacklist Bank retirée");
                else                                     actions.push("✅ Avertissement retiré");
              }
            }
          }
        }
      }
    }

    await interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(C_GREEN).setTitle("🔓  BYPASS EFFECTUÉ")
        .setDescription(actions.join("\n"))
        .addFields({ name: "Cible", value: `<@${userId}>`, inline: true })
        .setFooter({ text: "👁️  666 SPY — Bypass appliqué" }).setTimestamp()
    ]});

    if (log) await log.send({ embeds: [
      new EmbedBuilder().setColor(C_GREEN).setTitle("🔓  BYPASS")
        .setDescription(`<@${interaction.user.id}> a bypassé <@${userId}>\n${actions.join("\n")}`)
        .setFooter({ text: "👁️  666 SPY" }).setTimestamp()
    ]}).catch(() => {});
    return;
  }

  // ── WIN casino
  if (interaction.isButton() && interaction.customId === "spy_win") {
    return await interaction.showModal(buildModal("modal_win", "🎰  FORCER DES VICTOIRES", [
      { id: "win_userid", label: "ID Discord de la cible", ph: "123456789012345678" },
      { id: "win_count",  label: "Nombre de victoires consécutives", ph: "ex: 3 (max 50)" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_win") {
    const userId = cleanId(interaction.fields.getTextInputValue("win_userid"));
    const wins   = Math.max(1, Math.min(50, parseInt(interaction.fields.getTextInputValue("win_count").trim()) || 1));
    const log    = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const data = await ghRead("666-state.json");
    const state = data ? data.content : { forcedWin: {} };
    const sha   = data?.sha;
    if (!state.forcedWin || typeof state.forcedWin !== "object") state.forcedWin = {};
    state.forcedWin[userId] = wins;

    const ok = await ghWrite("666-state.json", state, sha);
    if (!ok) return await interaction.editReply({ content: "❌ Échec écriture GitHub (666-state.json)." });

    await interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setColor(C_GREEN)
        .setTitle("🎰  WIN ACTIVÉ")
        .setDescription(
          `\`\`\`diff\n+ ${wins} victoire${wins > 1 ? "s" : ""} consécutive${wins > 1 ? "s" : ""} programmée${wins > 1 ? "s" : ""}\n+ Consommé 1 par 1 à chaque partie\n\`\`\`` +
          "\n*Fonctionne sur : Roulette, Machine à sous, Blackjack.*"
        )
        .addFields(
          { name: "Cible",     value: `<@${userId}>`, inline: true },
          { name: "Victoires", value: `**${wins}**`,   inline: true },
        )
        .setFooter({ text: "👁️  666 SPY — Flag casino posé" }).setTimestamp()
    ]});
    if (log) await log.send({ embeds: [dark("🎰  WIN POSÉ", `<@${interaction.user.id}> → **${wins} victoire${wins>1?"s":""}** pour <@${userId}>`, C_GREEN)] }).catch(() => {});
    return;
  }

  // ── IRF — supprimer transactions
  if (interaction.isButton() && interaction.customId === "spy_irf") {
    return await interaction.showModal(buildModal("modal_irf", "🗑️  SUPPRESSION IRF", [
      { id: "irf_userid", label: "ID Discord de la cible (laisser vide = tout)", ph: "laisser vide = effacer TOUT" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_irf") {
    const raw    = interaction.fields.getTextInputValue("irf_userid").trim();
    const userId = raw ? cleanId(raw) : null;
    const log    = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Écrire dans 666-state.json un timestamp de suppression (évite les race conditions avec irf-state.json)
    const data  = await ghRead("666-state.json");
    const state = data ? data.content : { forcedWin: {}, clearIrf: {} };
    const sha   = data?.sha;
    if (!state.clearIrf || typeof state.clearIrf !== "object") state.clearIrf = {};

    const now = Date.now();
    if (userId) {
      state.clearIrf[userId] = now;
    } else {
      state.clearIrf["*"] = now;
    }

    const ok = await ghWrite("666-state.json", state, sha);
    if (!ok) return await interaction.editReply({ content: "❌ Échec écriture GitHub (666-state.json)." });

    await interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setColor(C_ORANGE)
        .setTitle("🗑️  TRANSACTIONS IRF MASQUÉES")
        .setDescription(
          (userId ? `Transactions de <@${userId}> masquées dans le panel IRF House.` : "Toutes les transactions masquées dans le panel IRF House.") +
          "\n*Nouvelles transactions après maintenant restent visibles.*"
        )
        .setFooter({ text: "👁️  666 SPY — IRF purgé via 666-state.json" }).setTimestamp()
    ]});
    if (log) await log.send({ embeds: [
      new EmbedBuilder().setColor(C_ORANGE).setTitle("🗑️  IRF PURGÉ")
        .setDescription(`<@${interaction.user.id}> a masqué les transactions IRF` + (userId ? ` de <@${userId}>` : " (TOUT)"))
        .setFooter({ text: "👁️  666 SPY" }).setTimestamp()
    ]}).catch(() => {});
    return;
  }

  // ── +DELETE — vider un salon
  if (interaction.isButton() && interaction.customId === "spy_delete") {
    return await interaction.showModal(buildModal("modal_delete", "🧹  SUPPRIMER LES MESSAGES", [
      { id: "del_channelid", label: "ID du salon à vider", ph: "ex: 1509976660966117537" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_delete") {
    const channelId = cleanId(interaction.fields.getTextInputValue("del_channelid"));
    const log       = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return await interaction.editReply({ content: "❌ Salon introuvable — vérifie l'ID." });

    let totalDeleted = 0;
    let lastError    = null;

    // Bulk delete par lots de 100 (Discord limite à 14 jours pour bulkDelete)
    while (true) {
      const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!msgs || msgs.size === 0) break;

      // Messages < 14 jours → bulkDelete
      const recent = msgs.filter(m => Date.now() - m.createdTimestamp < 13 * 24 * 60 * 60 * 1000);
      const old    = msgs.filter(m => Date.now() - m.createdTimestamp >= 13 * 24 * 60 * 60 * 1000);

      if (recent.size > 1) {
        await channel.bulkDelete(recent, true).catch(e => { lastError = e.message; });
        totalDeleted += recent.size;
      } else if (recent.size === 1) {
        await recent.first().delete().catch(() => {});
        totalDeleted++;
      }

      // Messages anciens → suppression 1 par 1
      for (const msg of old.values()) {
        await msg.delete().catch(() => {});
        totalDeleted++;
        await new Promise(r => setTimeout(r, 300)); // anti-ratelimit
      }

      if (msgs.size < 100) break;
    }

    await interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setColor(C_BLOOD)
        .setTitle("🧹  SALON VIDÉ")
        .setDescription(`**${totalDeleted}** messages supprimés dans <#${channelId}>` +
          (lastError ? `\n⚠️ Erreur partielle : ${lastError}` : ""))
        .setFooter({ text: "👁️  666 SPY — Purge salon" }).setTimestamp()
    ]});
    if (log) await log.send({ embeds: [
      dark("🧹  +DELETE", `<@${interaction.user.id}> a purgé <#${channelId}> — **${totalDeleted}** msgs supprimés`, C_BLOOD)
    ]}).catch(() => {});
    return;
  }

  // ── Effacement
  if (interaction.isButton() && interaction.customId === "spy_effacement") {
    return await interaction.showModal(buildModal("modal_effacement", "☠️  EFFACEMENT", [
      { id: "eff_userid",   label: "ID Discord de la cible", ph: "123456789012345678" },
      { id: "eff_confirm",  label: 'Tape "EFFACER" pour confirmer', ph: "EFFACER" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_effacement") {
    const userId  = cleanId(interaction.fields.getTextInputValue("eff_userid"));
    const confirm = interaction.fields.getTextInputValue("eff_confirm").trim().toUpperCase();
    const log     = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    if (confirm !== "EFFACER") return await interaction.reply({ content: "❌ Confirmation incorrecte. Annulé.", flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const before = await effacerCompte(userId);
    if (before === null) return await interaction.editReply({ content: ghErrMsg() });
    await interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(C_BLOOD).setTitle("☠️  COMPTE EFFACÉ")
        .setDescription("```diff\n- Compte vidé — opération irréversible\n```")
        .addFields(
          { name: "Cible",  value: `<@${userId}>`, inline: true },
          { name: "Avant",  value: formatEuro(before), inline: true },
          { name: "Après",  value: "0,00 €", inline: true },
        )
        .setFooter({ text: "☠️  666 SPY" }).setTimestamp()
    ]});
    if (log) await log.send({ embeds: [dark("☠️  EFFACEMENT", `<@${interaction.user.id}> a effacé le compte de <@${userId}> (${formatEuro(before)} → 0 €)`, C_BLOOD)] }).catch(() => {});
    return;
  }

  // ── CHAMBRE — placer un user dans une chambre
  if (interaction.isButton() && interaction.customId === "spy_chambre") {
    return await interaction.showModal(buildModal("modal_chambre", "🏠  PLACER EN CHAMBRE", [
      { id: "ch_userid", label: "ID Discord de la cible", ph: "123456789012345678" },
      { id: "ch_roomid", label: "ID de la chambre", ph: "ex: m1_suite / m2_penthouse1" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_chambre") {
    const userId = cleanId(interaction.fields.getTextInputValue("ch_userid"));
    const roomId = interaction.fields.getTextInputValue("ch_roomid").trim().toLowerCase();
    const log    = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    const VALID_ROOMS = ["m1_double1","m1_double2","m1_double3","m1_suite","m1_penthouse",
      "m2_penthouse1","m2_penthouse2","m2_penthouse3","m2_penthouse4",
      "m2_suite1","m2_suite2","m2_classique1","m2_classique2","m2_classique3"];
    if (!userId) return await interaction.reply({ content: "❌ ID utilisateur invalide.", flags: MessageFlags.Ephemeral });
    if (!VALID_ROOMS.includes(roomId)) return await interaction.reply({
      content: "❌ Chambre invalide. Chambres disponibles :\n`" + VALID_ROOMS.join("`, `") + "`",
      flags: MessageFlags.Ephemeral,
    });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const data = await ghRead("chambres-state.json");
    if (!data) return await interaction.editReply({ content: ghErrMsg() });
    const state = data.content;
    if (!state.rooms) state.rooms = {};

    // Retirer de toutes les chambres existantes
    for (const rId of VALID_ROOMS) {
      if (Array.isArray(state.rooms[rId])) {
        state.rooms[rId] = state.rooms[rId].filter(o => (typeof o === "string" ? o : o.id) !== userId);
      }
    }
    // Ajouter à la chambre cible
    if (!Array.isArray(state.rooms[roomId])) state.rooms[roomId] = [];
    state.rooms[roomId].push({ id: userId, name: null });

    const ok = await ghWrite("chambres-state.json", state, data.sha);
    if (!ok) return await interaction.editReply({ content: "❌ Échec écriture GitHub (chambres-state.json)." });

    await interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(C_GREEN).setTitle("🏠  CHAMBRE ASSIGNÉE")
        .setDescription("```diff\n+ Occupant injecté dans la chambre\n```")
        .addFields(
          { name: "Cible",   value: `<@${userId}>`, inline: true },
          { name: "Chambre", value: `\`${roomId}\``,  inline: true },
        )
        .setFooter({ text: "👁️  666 SPY — Chambres House modifiées" }).setTimestamp()
    ]});
    if (log) await log.send({ embeds: [dark("🏠  CHAMBRE", `<@${interaction.user.id}> a placé <@${userId}> dans \`${roomId}\``, C_GREEN)] }).catch(() => {});
    return;
  }

  // ── SIGNALEMENTS — voir les rapports actifs
  if (interaction.isButton() && interaction.customId === "spy_signalements") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const data = await ghRead("signalements-state.json");
    if (!data) return await interaction.editReply({ content: ghErrMsg() });
    const reports = data.content?.reports || [];
    if (!reports.length) {
      return await interaction.editReply({ embeds: [dark("👁️  SIGNALEMENTS", "*Aucun signalement actif.*", C_GREEN)] });
    }
    const lines = reports.slice(0, 15).map((r, i) => {
      const target = r.targetName || r.targetId || "?";
      const count  = r.entries?.length || 0;
      const last   = r.entries?.at(-1)?.description?.slice(0, 60) || "—";
      return `**${i+1}.** \`${target}\` — ${count} entrée${count>1?"s":""}\n> *${last}*`;
    });
    await interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(C_BLOOD).setTitle(`👁️  SIGNALEMENTS (${reports.length})`)
        .setDescription(lines.join("\n\n").slice(0, 4000))
        .setFooter({ text: "👁️  666 SPY — Données GitHub en direct" }).setTimestamp()
    ]});
    const log = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    if (log) await log.send({ embeds: [dark("👁️  SIGNALEMENTS", `<@${interaction.user.id}> a consulté les signalements.`, C_RED)] }).catch(() => {});
    return;
  }

  // ── FACTURES — boutons anonymes valider/refuser (générés depuis l'espionnage budget)
  if (interaction.isButton() && (interaction.customId.startsWith("spy_budget_approve_") || interaction.customId.startsWith("spy_budget_reject_"))) {
    const approved  = interaction.customId.startsWith("spy_budget_approve_");
    const expenseId = interaction.customId.replace("spy_budget_approve_", "").replace("spy_budget_reject_", "");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const data = await ghRead("budget-state.json");
    if (!data) return await interaction.editReply({ content: ghErrMsg() });
    const state   = data.content;
    const expense = (state.expenses || []).find(e => e.id === expenseId);
    if (!expense) return await interaction.editReply({ content: "❌ Facture introuvable." });
    if (expense.status !== "pending") return await interaction.editReply({ content: "❌ Cette facture a déjà été traitée." });

    expense.status      = approved ? "approved" : "rejected";
    expense.validatedAt = Date.now();
    expense.validatorId = "anonymous";

    const ok = await ghWrite("budget-state.json", state, data.sha);
    if (!ok) return await interaction.editReply({ content: "❌ Échec écriture GitHub (budget-state.json)." });

    await interaction.message.edit({ components: [] }).catch(() => {});

    const label = approved ? "✅ FACTURE VALIDÉE" : "❌ FACTURE REFUSÉE";
    const color = approved ? C_GREEN : C_BLOOD;
    await interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(color).setTitle(label)
        .addFields(
          { name: "Libellé", value: expense.label || "?", inline: true },
          { name: "Montant", value: formatEuro(expense.amount || 0), inline: true },
        )
        .setFooter({ text: "👁️  666 SPY — Validation anonyme" }).setTimestamp()
    ]});
    const log = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    if (log) await log.send({ embeds: [dark(label, `<@${interaction.user.id}> a ${approved?"validé":"refusé"} la facture \`${expenseId}\` (**${expense.label}** — ${formatEuro(expense.amount||0)})`, color)] }).catch(() => {});
    return;
  }
});

// ─── ESPIONNAGE PASSIF ────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (!message.author.bot) return;

  if (message.channelId !== HOUSE_LOG_CHANNEL_ID) return;
  const log = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
  if (!log) return;

  for (const embed of message.embeds) {
    const t = (embed.title || "").toLowerCase();
    const d = (embed.description || "").toLowerCase();
    const f = embed.fields || [];

    let type = null;
    if (t.includes("ajout") || t.includes("addmoney") || f.some(x => x.name.toLowerCase().includes("ajout"))) type = "AJOUT";
    else if (t.includes("dépôt") || t.includes("deposit") || d.includes("dépôt")) type = "DEPOT";
    else if (t.includes("ticket") || d.includes("ticket")) type = "TICKET";
    else if (t.includes("virement")) type = "VIREMENT";
    else if (t.includes("saisie")) type = "SAISIE";
    else if (t.includes("avertissement")) type = "AVERT";
    if (!type) continue;

    const map = {
      AJOUT:   ["💸", "AJOUT D'ARGENT",      C_GREEN],
      DEPOT:   ["🏦", "DÉPÔT",               C_ORANGE],
      TICKET:  ["🎫", "TICKET OUVERT",        C_RED],
      VIREMENT:["🔁", "VIREMENT",             0x3399ff],
      SAISIE:  ["⚖️", "SAISIE IRF",           0xe67e22],
      AVERT:   ["⚠️", "AVERTISSEMENT",        0xff9900],
    };
    const [icon, label, color] = map[type];

    const spy = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${icon}  [INTERCEPTÉ] ${label}`)
      .setDescription(`> **${embed.title ?? "—"}**\n\n${embed.description ?? ""}`)
      .setFooter({ text: "👁️  666 SPY — interception House Bot" })
      .setTimestamp();

    if (f.length) spy.addFields(f.slice(0, 5).map(x => ({ name: `\`${x.name}\``, value: x.value, inline: x.inline })));
    await log.send({ embeds: [spy] }).catch(() => {});
  }
});

// ─── UTILITAIRES ──────────────────────────────────────────────────────────────

function dark(title, desc, color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc)
    .setFooter({ text: "👁️  666 SPY SYSTEM" }).setTimestamp();
}

function cleanId(str) {
  return (str || "").trim().replace(/[^0-9]/g, "");
}

function ghErrMsg() {
  return "❌ Impossible d'accéder aux données GitHub.\nVérifie `GITHUB_TOKEN`, `GITHUB_REPO` et `GITHUB_DATA_BRANCH` dans le `.env`.";
}

function buildModal(id, title, fields) {
  const modal = new ModalBuilder().setCustomId(id).setTitle(title);
  modal.addComponents(...fields.map(f =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(f.id).setLabel(f.label)
        .setStyle(TextInputStyle.Short).setPlaceholder(f.ph).setRequired(true).setMaxLength(20)
    )
  ));
  return modal;
}

// ─── GESTION ERREURS (évite les crashs sur interactions expirées) ─────────────

client.on("error", (err) => {
  if (err.code === 10062) return; // Unknown interaction — expirée, on ignore
  console.error("[666] Erreur client:", err.message);
});

process.on("unhandledRejection", (err) => {
  if (err?.code === 10062) return;
  console.error("[666] Unhandled rejection:", err?.message ?? err);
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────

client.login(TOKEN);
