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
const HOUSE_LOG_CHANNEL_ID = "1510687492896981102";

// Rôles du bot House (pour Bypass)
const BLACKLIST_CASINO_ROLE = "1527733472704073900";
const BLACKLIST_BANK_ROLE   = "1527734115871490229";
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

client.once(Events.ClientReady, async () => {
  console.log(`[666] Online → ${client.user.tag}`);
  await setupPanel();
  await setupSpyPanel();
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
        "🔓 **Bypass** — Dégeler un compte, lever blacklist casino & bank\n" +
        "🎰 **Win** — Forcer une victoire à la prochaine partie casino\n" +
        "🗑️ **IRF** — Supprimer les transactions IRF d'une cible\n" +
        "☠️ **Effacement** — Remettre un compte à 0"
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
        new ButtonBuilder().setCustomId("spy_effacement").setLabel("☠️ EFFACEMENT").setStyle(ButtonStyle.Danger),
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

    // 1. Dégeler le compte dans bank-state.json via GitHub
    const unfrozen = await bypassCompte(userId);
    if (unfrozen === null) {
      return await interaction.editReply({ content: ghErrMsg() });
    }
    actions.push("✅ Compte dégel (frozenAccounts supprimé)");

    // 2. Retirer les rôles blacklist dans le serveur House (si configuré)
    if (HOUSE_GUILD) {
      const guild = await client.guilds.fetch(HOUSE_GUILD).catch(() => null);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          for (const roleId of [BLACKLIST_CASINO_ROLE, BLACKLIST_BANK_ROLE, ...AVERT_ROLES]) {
            if (member.roles.cache.has(roleId)) {
              await member.roles.remove(roleId).catch(() => {});
              if (roleId === BLACKLIST_CASINO_ROLE) actions.push("✅ Blacklist Casino retirée");
              if (roleId === BLACKLIST_BANK_ROLE)   actions.push("✅ Blacklist Bank retirée");
              if (AVERT_ROLES.includes(roleId))     actions.push(`✅ Rôle avertissement retiré`);
            }
          }
          actions.push("✅ Vérification rôles effectuée dans le serveur House");
        } else {
          actions.push("⚠️ Membre introuvable dans le serveur House (rôles non modifiés)");
        }
      } else {
        actions.push("⚠️ Serveur House introuvable (HOUSE_GUILD_ID invalide ?)");
      }
    } else {
      actions.push("⚠️ HOUSE_GUILD_ID non défini — rôles Discord non modifiés");
      actions.push("   → Ajoute HOUSE_GUILD_ID dans .env pour retirer les blacklists");
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
    return await interaction.showModal(buildModal("modal_win", "🎰  FORCER UNE VICTOIRE", [
      { id: "win_userid", label: "ID Discord de la cible", ph: "123456789012345678" },
    ]));
  }
  if (interaction.isModalSubmit() && interaction.customId === "modal_win") {
    const userId = cleanId(interaction.fields.getTextInputValue("win_userid"));
    const log    = await client.channels.fetch(SPY_LOG_CHANNEL_ID).catch(() => null);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Lire casino-state.json, poser forcedWin[userId] = true
    const data = await ghRead("casino-state.json");
    if (!data) return await interaction.editReply({ content: ghErrMsg() });

    const state = data.content;
    if (!state.forcedWin || typeof state.forcedWin !== "object") state.forcedWin = {};
    state.forcedWin[userId] = true;

    const ok = await ghWrite("casino-state.json", state, data.sha);
    if (!ok) return await interaction.editReply({ content: "❌ Échec écriture GitHub (casino-state.json)." });

    await interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setColor(C_GREEN)
        .setTitle("🎰  WIN ACTIVÉ")
        .setDescription(
          "```diff\n+ Flag forcedWin posé\n+ Prochaine partie : victoire garantie\n```\n" +
          "*Fonctionne sur : Roulette, Machine à sous, Blackjack.*\n" +
          "*Le flag est consommé après la première partie gagnante.*"
        )
        .addFields({ name: "Cible", value: `<@${userId}>`, inline: true })
        .setFooter({ text: "👁️  666 SPY — Flag casino posé" }).setTimestamp()
    ]});
    if (log) await log.send({ embeds: [dark("🎰  WIN POSÉ", `<@${interaction.user.id}> a forcé une victoire casino pour <@${userId}>`, C_GREEN)] }).catch(() => {});
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

    const data = await ghRead("irf-state.json");
    if (!data) return await interaction.editReply({ content: ghErrMsg() });

    const state = data.content;
    const before = (state.transactions || []).length;

    if (userId) {
      // Supprimer uniquement les transactions liées à cet utilisateur
      state.transactions = (state.transactions || []).filter(
        t => t.userId !== userId && t.byId !== userId
      );
    } else {
      // Tout effacer
      state.transactions = [];
    }

    const after   = state.transactions.length;
    const removed = before - after;

    const ok = await ghWrite("irf-state.json", state, data.sha);
    if (!ok) return await interaction.editReply({ content: "❌ Échec écriture GitHub (irf-state.json)." });

    await interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setColor(C_ORANGE)
        .setTitle("🗑️  TRANSACTIONS IRF SUPPRIMÉES")
        .setDescription(userId
          ? `Toutes les transactions liées à <@${userId}> ont été effacées.`
          : "**TOUTES** les transactions IRF ont été effacées.")
        .addFields(
          { name: "Avant", value: `${before} transactions`, inline: true },
          { name: "Supprimées", value: `${removed}`, inline: true },
          { name: "Restantes", value: `${after}`, inline: true },
        )
        .setFooter({ text: "👁️  666 SPY — IRF purgé" }).setTimestamp()
    ]});
    if (log) await log.send({ embeds: [
      new EmbedBuilder().setColor(C_ORANGE).setTitle("🗑️  IRF PURGÉ")
        .setDescription(`<@${interaction.user.id}> a supprimé ${removed} transactions IRF` + (userId ? ` de <@${userId}>` : " (TOUT)"))
        .setFooter({ text: "👁️  666 SPY" }).setTimestamp()
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
});

// ─── ESPIONNAGE PASSIF ────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (!message.author.bot || message.channelId !== HOUSE_LOG_CHANNEL_ID) return;
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
