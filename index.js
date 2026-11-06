const fs = require('fs');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  SectionBuilder, ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, ChannelType,
  MessageFlags, PermissionFlagsBits } = require('discord.js');

const TOKEN = 'tkn';
const TOS = 'tos link'; // CHANGE THIS TO YOUR SERVERS RULE CHANNEL LINK
const ICON = 'iconlink'; // CHANGE THIS TO THE DEFAULT IMAGE THAT THE BOT WILL USE
const IMAGE = ICON
const SETTINGS_FILE = './settings.json'; // DO NOT CHANGE 
const KEEP_SERVER_ID = '1533184586853515294'; // YOUR SERVER ID
const MIN_MEMBERS = 25; // CHANGE THIS TO THE MAX AUTO DECLINE MEMBER

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

let settings = {};
try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { settings = {}; }
function saveSettings() { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); }
function guildSettings(guildId) { return settings[guildId] ??= {}; }

const stickyLocks = new Set();

async function safeReply(i, data) {
  try {
    if (i.deferred || i.replied) return await i.editReply(data);
    return await i.reply(data);
  } catch (e) {
    if (e.code !== 10062 && e.code !== 40060) throw e;
  }
}

async function getTextChannel(i) {
  return i.channel
    ?? await i.guild?.channels.fetch(i.channelId).catch(() => null)
    ?? await client.channels.fetch(i.channelId).catch(() => null);
}

const UNITS = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
  w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
  mo: 2_592_000_000, month: 2_592_000_000, months: 2_592_000_000,
  y: 31_536_000_000, yr: 31_536_000_000, year: 31_536_000_000, years: 31_536_000_000,
};

function parseDuration(input) {
  const raw = String(input).trim().toLowerCase();
  if (['forever', 'perm', 'permanent', 'inf', 'infinite', 'never'].includes(raw)) {
    return { ms: null, label: 'forever' };
  }
  let total = 0;
  const re = /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|hr|days?|weeks?|months?|month|years?|yrs?|year|mo|ms|[smhdwy])/g;
  let m;
  let matched = false;
  while ((m = re.exec(raw))) {
    const n = Number(m[1]);
    const unit = m[2];
    const mul = UNITS[unit];
    if (!mul || !Number.isFinite(n)) return null;
    total += n * mul;
    matched = true;
  }
  if (!matched || total <= 0) return null;
  return { ms: total, label: raw.replace(/\s+/g, '') };
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return 'forever';
  return `<t:${Math.floor(expiresAt / 1000)}:R>`;
}

function getBlacklist(guildId) {
  const g = guildSettings(guildId);
  g.blacklist ??= {};
  return g.blacklist;
}

function isBlacklisted(guildId, userId) {
  const bl = getBlacklist(guildId);
  const entry = bl[userId];
  if (!entry) return null;
  if (entry.expiresAt && Date.now() >= entry.expiresAt) {
    delete bl[userId];
    saveSettings();
    return null;
  }
  return entry;
}

const container = ({ title, body, color, button }) => {
  const btn = new ButtonBuilder().setStyle(button.style).setLabel(button.label);
  if (button.style === ButtonStyle.Link) btn.setURL(button.url);
  else btn.setCustomId(button.customId);
  return new ContainerBuilder()
    .setAccentColor(color)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${title}\n${body}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(ICON)))
    .addActionRowComponents(new ActionRowBuilder().addComponents(btn))
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# By using this bot you accept our [Terms of Service](${TOS})`));
};

function inviteCodeFromUrl(invite) {
  try {
    const u = new URL(invite);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last || invite;
  } catch {
    return String(invite).replace(/^https?:\/\/(discord\.gg|discord\.com\/invite)\//i, '');
  }
}

async function guildIconFromInvite(invite, fallback = IMAGE) {
  const code = inviteCodeFromUrl(invite);
  if (!code) return fallback;
  try {
    const inv = await client.fetchInvite(code, { withCounts: true }).catch(() => null);
    return inv?.guild?.iconURL({ size: 256, extension: 'png' }) || fallback;
  } catch {
    return fallback;
  }
}

const acceptedRaid = ({ invite, members, reason, canR4id, icon }) =>
  new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Global R4id\n**Members:** ${members}\n**Reason:** ${reason}\n**Is raidable:** ${canR4id}`
          )
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon || IMAGE))
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Join Server').setURL(invite)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# By using this bot you accept our [Terms of Service](${TOS})`
      ));

const MESSAGES = {
  nuke: (link) => container({
    title: 'Abyss Nuke',
    body: 'Add the bot to your server with the button below.',
    color: 0x5865f2,
    button: { style: ButtonStyle.Link, label: 'Add Abyss', url: link },
  }),
  raid: (link) => container({
    title: 'Abyss Raid',
    body: 'Add the bot to your bots with the button below.',
    color: 0x2b2d31,
    button: { style: ButtonStyle.Link, label: 'Add Abyss R', url: link },
  }),
  request: () => container({
    title: 'Request',
    body: 'Click the button to request a server to r4id globally.',
    color: 0x0099ff,
    button: { style: ButtonStyle.Primary, label: 'Request', customId: 'request_open_modal' },
  }),
};

const TERMS_TEXT = [
  '## Raid Requirements',
  '',
  '### WARNING!',
  'If you send a request that is not meeting these requirements, you may get blacklisted!',
  '',
  `1. Server MUST have ${MIN_MEMBERS}+ Members, or it will be denied.`,
  '2. Please do not "test" the bot ( give real servers )',
  '3. Check before you  send a server! It MUST be raidable. NO "manual raids"',
  '4. If you send the same server (if it was denied) then you may get blacklisted',
  '5. Be smart, if a server has 35k members, its probably unraidable.',
].join('\n');

const termsMessage = () =>
  new ContainerBuilder()
    .setAccentColor(0x0099ff)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(TERMS_TEXT))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(ICON))
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('terms_accept').setStyle(ButtonStyle.Success).setLabel('Accept & continue'),
        new ButtonBuilder().setCustomId('terms_deny').setStyle(ButtonStyle.Danger).setLabel('Deny'),
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# By using this bot you accept our [Terms of Service](${TOS})`));

function buildRequestModal() {
  return new ModalBuilder().setCustomId('request_modal').setTitle('Request R4id')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('invite').setLabel('Invite link')
          .setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('canR4id').setLabel('Is external bots enabled? (Yes/No)')
          .setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Reason')
          .setStyle(TextInputStyle.Paragraph).setRequired(true)),
    );
}

const cmd = new SlashCommandBuilder()
  .setName('create')
  .setDescription('Get the bot invite link')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(0)
  .addStringOption(o => o.setName('type').setDescription('nuke, raid or request').setRequired(true)
    .addChoices(
      { name: 'nuke', value: 'nuke' },
      { name: 'raid', value: 'raid' },
      { name: 'request', value: 'request' },
    ))
  .addStringOption(o => o.setName('link').setDescription('Link (only required for nuke or raid)'))
  .toJSON();

const setCmd = new SlashCommandBuilder()
  .setName('set')
  .setDescription('Configure the global r4id request channels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(0)
  .addStringOption(o => o.setName('type').setDescription('Which channel to set').setRequired(true)
    .addChoices(
      { name: 'request channel', value: 'request' },
      { name: 'accepted request channel', value: 'accepted' },
    ))
  .addChannelOption(o => o.setName('channel').setDescription('Channel')
    .addChannelTypes(ChannelType.GuildText).setRequired(true))
  .toJSON();

const stickyCmd = new SlashCommandBuilder()
  .setName('create-sticky')
  .setDescription('Create a sticky message that stays at the bottom of the channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(0)
  .addStringOption(o => o.setName('type').setDescription('embed or message').setRequired(true)
    .addChoices(
      { name: 'embed', value: 'embed' },
      { name: 'message', value: 'message' },
    ))
  .addStringOption(o => o.setName('content').setDescription('Message body').setRequired(true))
  .addStringOption(o => o.setName('title').setDescription('Embed title (embed only)'))
  .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #0099ff (embed only)'))
  .addStringOption(o => o.setName('footer').setDescription('Embed footer (embed only)'))
  .addStringOption(o => o.setName('image').setDescription('Image URL (embed only)'))
  .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail URL (embed only)'))
  .toJSON();

const unstickyCmd = new SlashCommandBuilder()
  .setName('remove-sticky')
  .setDescription('Remove the sticky message from this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(0)
  .toJSON();

const blacklistCmd = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Blacklist a user from submitting requests')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(0)
  .addUserOption(o => o.setName('user').setDescription('User to blacklist').setRequired(true))
  .addStringOption(o => o.setName('time').setDescription('1m, 1h, 1d, 2w, 3d12h, forever').setRequired(true))
  .toJSON();

const unblacklistCmd = new SlashCommandBuilder()
  .setName('unblacklist')
  .setDescription('Remove a user from the request blacklist')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(0)
  .addUserOption(o => o.setName('user').setDescription('User to unblacklist').setRequired(true))
  .toJSON();

function parseColor(hex) {
  if (!hex) return 0x0099ff;
  const n = parseInt(String(hex).replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0x0099ff;
}

function buildStickyPayload(sticky) {
  if (sticky.type === 'embed') {
    const embed = new EmbedBuilder()
      .setColor(sticky.color ?? 0x0099ff)
      .setDescription(sticky.content);
    if (sticky.title) embed.setTitle(sticky.title);
    if (sticky.footer) embed.setFooter({ text: sticky.footer });
    if (sticky.image) embed.setImage(sticky.image);
    if (sticky.thumbnail) embed.setThumbnail(sticky.thumbnail);
    return { embeds: [embed] };
  }
  return { content: sticky.content };
}

async function sendSticky(channel, sticky) {
  if (!channel?.send) return null;
  const msg = await channel.send(buildStickyPayload(sticky));
  sticky.messageId = msg.id;
  saveSettings();
  return msg;
}

async function refreshSticky(channel) {
  if (!channel?.id || !channel.guild) return;
  const g = guildSettings(channel.guild.id);
  const sticky = g.stickies?.[channel.id];
  if (!sticky) return;
  const key = `${channel.guild.id}:${channel.id}`;
  if (stickyLocks.has(key)) return;
  stickyLocks.add(key);
  try {
    if (sticky.messageId) {
      const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    await sendSticky(channel, sticky);
  } finally {
    stickyLocks.delete(key);
  }
}

function buildRequestEmbed({ invite, members, below25, canR4id, reason, requesterId, icon }) {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('New Global R4id Request')
    .addFields(
      { name: 'Invite', value: invite },
      { name: 'Members', value: String(members) },
      { name: `Below ${MIN_MEMBERS} members`, value: below25 },
      { name: 'Is r4idable?', value: canR4id },
      { name: 'Reason', value: reason },
      { name: 'Requested by', value: `<@${requesterId}>` },
    );
  if (icon) embed.setThumbnail(icon);
  return embed;
}

function requestReviewRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('request_accept').setStyle(ButtonStyle.Success).setLabel('Accept'),
    new ButtonBuilder().setCustomId('request_deny').setStyle(ButtonStyle.Danger).setLabel('Deny'),
  );
}

function isValidHttpUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getRequesterId(embed) {
  const field = embed.fields.find(f => f.name === 'Requested by');
  return field?.value.match(/<@(\d+)>/)?.[1];
}

function autoDeclineEmbed(members) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Request Auto-Declined')
    .setDescription('Your server was auto declined for: Insufficient members.')
    .addFields(
      { name: 'Members', value: String(members), inline: true },
      { name: 'Required', value: `${MIN_MEMBERS}+`, inline: true },
    );
}

client.on('messageCreate', async (msg) => {
  try {
    if (!msg.guild || msg.author.bot) return;
    const sticky = guildSettings(msg.guild.id).stickies?.[msg.channel.id];
    if (!sticky) return;
    if (sticky.messageId && msg.id === sticky.messageId) return;
    await refreshSticky(msg.channel);
  } catch (err) {
    console.error('sticky refresh error:', err);
  }
});

client.on('interactionCreate', async (i) => {
  try {
    if (i.guildId && i.guildId !== KEEP_SERVER_ID) {
      await i.reply({
        content: 'This bot is only available in its home server.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (i.isChatInputCommand() && i.commandName === 'blacklist') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const user = i.options.getUser('user');
      const parsed = parseDuration(i.options.getString('time'));
      if (!parsed) {
        await safeReply(i, { content: 'Invalid time. Use `1m`, `1h`, `1d`, `2w`, `3d12h`, or `forever`.' });
        return;
      }
      const expiresAt = parsed.ms == null ? null : Date.now() + parsed.ms;
      getBlacklist(i.guildId)[user.id] = {
        expiresAt,
        by: i.user.id,
        at: Date.now(),
        label: parsed.label,
      };
      saveSettings();
      await safeReply(i, { content: `Blacklisted <@${user.id}> ${expiresAt ? `until ${formatExpiry(expiresAt)}` : 'forever'}.` });
      return;
    }

    if (i.isChatInputCommand() && i.commandName === 'unblacklist') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const user = i.options.getUser('user');
      const bl = getBlacklist(i.guildId);
      if (!bl[user.id]) {
        await safeReply(i, { content: `<@${user.id}> is not blacklisted.` });
        return;
      }
      delete bl[user.id];
      saveSettings();
      await safeReply(i, { content: `Removed <@${user.id}> from the blacklist.` });
      return;
    }

    if (i.isChatInputCommand() && i.commandName === 'create-sticky') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const channel = await getTextChannel(i);
      if (!channel?.send) {
        await safeReply(i, { content: 'Could not access this channel.' });
        return;
      }
      const type = i.options.getString('type');
      const content = i.options.getString('content');
      const g = guildSettings(i.guildId);
      g.stickies ??= {};
      const prev = g.stickies[channel.id];
      if (prev?.messageId) {
        const old = await channel.messages.fetch(prev.messageId).catch(() => null);
        if (old) await old.delete().catch(() => {});
      }
      const sticky = {
        type,
        content,
        title: i.options.getString('title') || null,
        color: parseColor(i.options.getString('color')),
        footer: i.options.getString('footer') || null,
        image: i.options.getString('image') || null,
        thumbnail: i.options.getString('thumbnail') || null,
        messageId: null,
      };
      g.stickies[channel.id] = sticky;
      saveSettings();
      await sendSticky(channel, sticky);
      await safeReply(i, { content: 'Sticky created.' });
      return;
    }

    if (i.isChatInputCommand() && i.commandName === 'remove-sticky') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const channel = await getTextChannel(i);
      const g = guildSettings(i.guildId);
      const sticky = g.stickies?.[channel?.id];
      if (!sticky) {
        await safeReply(i, { content: 'No sticky in this channel.' });
        return;
      }
      if (sticky.messageId && channel) {
        const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
        if (old) await old.delete().catch(() => {});
      }
      if (channel) delete g.stickies[channel.id];
      saveSettings();
      await safeReply(i, { content: 'Sticky removed.' });
      return;
    }

    if (i.isChatInputCommand() && i.commandName === 'create') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const type = i.options.getString('type');
      const channel = await getTextChannel(i);
      if (!channel?.send) {
        await safeReply(i, { content: 'Could not access this channel.' });
        return;
      }
      if (type === 'nuke' || type === 'raid') {
        const link = i.options.getString('link');
        if (!link) {
          await safeReply(i, { content: 'Link is required for nuke/raid commands' });
          return;
        }
        if (!isValidHttpUrl(link)) {
          await safeReply(i, { content: 'Please provide a valid HTTP/HTTPS link' });
          return;
        }
        await channel.send({
          components: [MESSAGES[type](link)],
          flags: MessageFlags.IsComponentsV2,
        });
      } else {
        await channel.send({
          components: [MESSAGES[type]()],
          flags: MessageFlags.IsComponentsV2,
        });
      }
      await safeReply(i, { content: 'Message created' });
      return;
    }

    if (i.isChatInputCommand() && i.commandName === 'set') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const type = i.options.getString('type');
      const channel = i.options.getChannel('channel');
      guildSettings(i.guildId)[type === 'request' ? 'requestChannelId' : 'acceptedChannelId'] = channel.id;
      saveSettings();
      await safeReply(i, { content: `${type === 'request' ? 'Request' : 'Accepted request'} channel set to <#${channel.id}>.` });
      return;
    }

    if (i.isButton() && i.customId === 'request_open_modal') {
      const banned = isBlacklisted(i.guildId, i.user.id);
      if (banned) {
        await safeReply(i, {
          content: `You are blacklisted ${banned.expiresAt ? `until ${formatExpiry(banned.expiresAt)}` : 'forever'}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await i.reply({
        components: [termsMessage()],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });
      return;
    }

    if (i.isButton() && i.customId === 'terms_accept') {
      await i.showModal(buildRequestModal());
      return;
    }

    if (i.isButton() && i.customId === 'terms_deny') {
      await i.deferUpdate().catch(() => {});
      await i.message.delete().catch(() => {});
      return;
    }

    if (i.isModalSubmit() && i.customId === 'request_modal') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const banned = isBlacklisted(i.guildId, i.user.id);
      if (banned) {
        await safeReply(i, { content: `You are blacklisted ${banned.expiresAt ? `until ${formatExpiry(banned.expiresAt)}` : 'forever'}.` });
        return;
      }

      const invite = i.fields.getTextInputValue('invite').trim();

      const code = inviteCodeFromUrl(invite);
      const inv = code
        ? await client.fetchInvite(code, { withCounts: true }).catch(() => null)
        : null;
      if (!inv) {
        await safeReply(i, { content: 'That invite link is invalid or expired, so your request was auto-declined. Double-check the link and try again.' });
        return;
      }

      const members = inv.approximateMemberCount ?? inv.memberCount ?? null;

      // Hard gate: below the minimum is auto-declined, no review needed
      if (members != null && members < MIN_MEMBERS) {
        await safeReply(i, { embeds: [autoDeclineEmbed(members)] });
        return;
      }

      const below25 = members == null ? 'Unknown' : (members < MIN_MEMBERS ? 'Yes' : 'No');

      const requestChannelId = guildSettings(i.guildId).requestChannelId;
      if (!requestChannelId) {
        await safeReply(i, { content: 'Request channel is not configured yet. Ask an admin to run `/set` first.' });
        return;
      }
      const channel = await i.guild.channels.fetch(requestChannelId).catch(() => null);
      if (!channel?.send) {
        await safeReply(i, { content: 'The configured request channel could not be found.' });
        return;
      }
      const icon = inv.guild?.iconURL({ size: 256, extension: 'png' }) || IMAGE;
      const embed = buildRequestEmbed({
        invite,
        members: members ?? 'Unknown',
        below25,
        canR4id: i.fields.getTextInputValue('canR4id'),
        reason: i.fields.getTextInputValue('reason'),
        requesterId: i.user.id,
        icon,
      });
      await channel.send({ embeds: [embed], components: [requestReviewRow()] });
      await safeReply(i, { content: 'Your request has been submitted for review.' });
      return;
    }

    if (i.isButton() && (i.customId === 'request_accept' || i.customId === 'request_deny')) {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await safeReply(i, { content: 'You do not have permission to do that.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (i.customId === 'request_accept') {
        await i.deferUpdate();
        const embed = i.message.embeds[0];
        const field = (name) => embed.fields.find(f => f.name === name)?.value ?? 'N/A';
        const invite = field('Invite');
        const members = field('Members');
        const canR4id = field('Is r4idable?');
        const reason = field('Reason');
        const acceptedChannelId = guildSettings(i.guildId).acceptedChannelId;
        if (!acceptedChannelId) {
          await i.followUp({ content: 'Accepted request channel is not configured yet. Ask an admin to run `/set` first.', flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        const acceptedChannel = await i.guild.channels.fetch(acceptedChannelId).catch(() => null);
        if (!acceptedChannel?.send) {
          await i.followUp({ content: 'The configured accepted request channel could not be found.', flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        const icon = embed.thumbnail?.url || IMAGE;
        await acceptedChannel.send('<@&1540544259386638380>').catch(() => {});
        await acceptedChannel.send({
          components: [acceptedRaid({ invite, members, reason, canR4id, icon })],
          flags: MessageFlags.IsComponentsV2,
        });
        const updated = EmbedBuilder.from(embed).setColor(0x57f287).setTitle('Global R4id Request (Accepted)');
        await i.message.edit({ embeds: [updated], components: [] }).catch(() => {});
        return;
      }
      if (i.customId === 'request_deny') {
        const modal = new ModalBuilder().setCustomId(`request_deny_modal:${i.message.id}`).setTitle('Deny Request')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)')
                .setStyle(TextInputStyle.Paragraph).setRequired(false)),
          );
        await i.showModal(modal);
        return;
      }
    }

    if (i.isModalSubmit() && i.customId.startsWith('request_deny_modal:')) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const messageId = i.customId.split(':')[1];
      const channel = await getTextChannel(i);
      if (!channel) {
        await safeReply(i, { content: 'Could not access this channel.' });
        return;
      }
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        await safeReply(i, { content: 'Original request message not found.' });
        return;
      }
      const embed = message.embeds[0];
      const requesterId = getRequesterId(embed);
      const reason = i.fields.getTextInputValue('reason') || 'No reason provided';
      if (requesterId) {
        const user = await client.users.fetch(requesterId).catch(() => null);
        if (user) {
          const dm = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('Request Declined')
            .setDescription(`Your request was declined for: **${reason}**`)
            .addFields(
              { name: 'Invite', value: embed.fields.find(f => f.name === 'Invite')?.value ?? 'N/A' },
              { name: 'Declined by', value: i.user.tag },
            );
          await user.send({ embeds: [dm] }).catch(() => {});
        }
      }
      const updated = EmbedBuilder.from(embed).setColor(0x0099ff).setTitle('Global R4id Request (Denied)');
      await message.edit({ embeds: [updated], components: [] }).catch(() => {});
      await safeReply(i, { content: 'Request denied.' });
      return;
    }
  } catch (err) {
    console.error('interactionCreate error:', err);
    await safeReply(i, { content: 'Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.on('guildCreate', async (guild) => {
  if (guild.id === KEEP_SERVER_ID) return;
  try {
    await guild.leave();
    console.log(`Left new guild: ${guild.id}`);
  } catch (err) {
    console.error(`Failed to leave ${guild.id}:`, err.message);
  }
});

client.once('ready', async () => {
  try {
    const rest = new REST().setToken(TOKEN);

    // Commands live only in the keep server
    await rest.put(
      Routes.applicationGuildCommands(client.application.id, KEEP_SERVER_ID),
      { body: [cmd, setCmd, stickyCmd, unstickyCmd, blacklistCmd, unblacklistCmd] },
    );

    // Wipe global commands so nothing leaks into other servers
    await rest.put(Routes.applicationCommands(client.application.id), { body: [] });

    console.log('ready as', client.user.tag, '| app', client.application.id);

    const queue = [...client.guilds.cache.values()].filter(g => g.id !== KEEP_SERVER_ID);
    const workerCount = Math.min(5, queue.length);
    const worker = async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        try {
          await g.leave();
          console.log(`Left: ${g.id}`);
        } catch (error) {
          console.error(`Failed to leave ${g.id}:`, error.message);
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
  } catch (err) {
    console.error('command registration error:', err);
  }
});

client.on('error', (err) => console.error('client error:', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

client.login(TOKEN);