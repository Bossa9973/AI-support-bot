const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const config = require('../config');

/**
 * Robust staff member identification utility.
 * Checks Support Role ID, Admin permissions, Guild ownership, Owner IDs, and role names.
 * Handles GuildMember, API member payloads (with string/array roles), and fallback user objects.
 * @param {import('discord.js').GuildMember|object} member 
 * @param {import('discord.js').Guild} [guild]
 * @param {import('discord.js').User} [author]
 * @returns {boolean}
 */
function isStaffMember(member, guild = null, author = null) {
  const memberId = member?.id || member?.user?.id || author?.id;
  const currentGuild = guild || member?.guild;

  // 1. Direct Owner IDs check (Bot configured owners)
  if (memberId) {
    if (config.ownerId && config.ownerId === memberId) return true;
    if (Array.isArray(config.ownerIds) && config.ownerIds.includes(memberId)) return true;
  }

  // 2. Guild Owner check
  if (currentGuild && memberId && currentGuild.ownerId === memberId) return true;

  // 3. Resolve full GuildMember if partial
  let fullMember = member;
  if ((!fullMember || !fullMember.roles) && currentGuild && memberId) {
    fullMember = currentGuild.members?.cache?.get(memberId) || member;
  }

  if (!fullMember) return false;

  // 4. Configured Support Role ID check
  if (config.tickets && config.tickets.supportRoleId) {
    const targetRoleId = String(config.tickets.supportRoleId).trim();
    if (fullMember.roles) {
      if (fullMember.roles.cache && typeof fullMember.roles.cache.has === 'function') {
        if (fullMember.roles.cache.has(targetRoleId)) return true;
      }
      if (Array.isArray(fullMember.roles)) {
        if (fullMember.roles.includes(targetRoleId)) return true;
      }
      if (typeof fullMember.roles.has === 'function') {
        if (fullMember.roles.has(targetRoleId)) return true;
      }
    }
  }

  // 5. Discord Permissions check (Admin, Manage Guild, Manage Channels, Manage Messages, Moderate Members)
  let permissionsBitField = null;
  if (fullMember.permissions) {
    if (typeof fullMember.permissions.has === 'function') {
      permissionsBitField = fullMember.permissions;
    } else if (
      typeof fullMember.permissions === 'string' ||
      typeof fullMember.permissions === 'number' ||
      typeof fullMember.permissions === 'bigint'
    ) {
      try {
        permissionsBitField = new PermissionsBitField(BigInt(fullMember.permissions));
      } catch (_) {}
    }
  }

  if (permissionsBitField) {
    if (
      permissionsBitField.has(PermissionFlagsBits.Administrator) ||
      permissionsBitField.has(PermissionFlagsBits.ManageGuild) ||
      permissionsBitField.has(PermissionFlagsBits.ManageChannels) ||
      permissionsBitField.has(PermissionFlagsBits.ManageMessages) ||
      permissionsBitField.has(PermissionFlagsBits.ModerateMembers) ||
      permissionsBitField.has(PermissionFlagsBits.KickMembers) ||
      permissionsBitField.has(PermissionFlagsBits.BanMembers)
    ) {
      return true;
    }
  }

  // 6. Role Name pattern fallback (Staff, Support, Admin, Mod, Team, Owner, Founder, Dev, Helper, Management, Engineer)
  const staffRoleRegex = /^(staff|support|administrator|admin|moderator|mod|team|management|owner|founder|dev|developer|helper|engineer|tech|host)$/i;
  const staffWordRegex = /\b(staff|support|admin|administrator|moderator|management|team|founder|owner|developer|engineer)\b/i;

  if (fullMember.roles) {
    // If roles is a Collection, Map, or RoleManager with cache
    if (fullMember.roles.cache) {
      let roleList = [];
      if (typeof fullMember.roles.cache.values === 'function') {
        roleList = Array.from(fullMember.roles.cache.values());
      } else if (Array.isArray(fullMember.roles.cache)) {
        roleList = fullMember.roles.cache;
      }
      const hasStaffRole = roleList.some(
        (r) => r && r.name && (staffRoleRegex.test(r.name) || staffWordRegex.test(r.name))
      );
      if (hasStaffRole) return true;
    }

    // If roles is an Array of role IDs, look up in currentGuild roles cache
    if (Array.isArray(fullMember.roles) && currentGuild?.roles?.cache) {
      for (const roleId of fullMember.roles) {
        const role = currentGuild.roles.cache.get ? currentGuild.roles.cache.get(roleId) : null;
        if (role && (staffRoleRegex.test(role.name) || staffWordRegex.test(role.name))) {
          return true;
        }
      }
    }
  }

  return false;
}

module.exports = {
  isStaffMember
};

