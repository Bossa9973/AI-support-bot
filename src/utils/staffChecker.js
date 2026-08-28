const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

/**
 * Robust staff member identification utility.
 * Checks Support Role ID, Admin permissions, Guild ownership, Owner IDs, and role names.
 * @param {import('discord.js').GuildMember} member 
 * @returns {boolean}
 */
function isStaffMember(member) {
  if (!member) return false;

  // 1. Direct Owner IDs check
  const memberId = member.id || member.user?.id;
  if (memberId) {
    if (config.ownerId && config.ownerId === memberId) return true;
    if (Array.isArray(config.ownerIds) && config.ownerIds.includes(memberId)) return true;
  }

  // 2. Guild Owner check
  if (member.guild && member.guild.ownerId === memberId) return true;

  // 3. Configured Support Role ID check
  if (config.tickets && config.tickets.supportRoleId) {
    if (member.roles && member.roles.cache && member.roles.cache.has(config.tickets.supportRoleId)) {
      return true;
    }
  }

  // 4. Discord Permissions check (Admin, Manage Guild, Manage Channels)
  if (member.permissions) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  }

  // 5. Role Name pattern fallback (Staff, Support, Admin, Mod, Team)
  if (member.roles && member.roles.cache) {
    const isStaffRole = member.roles.cache.some(r =>
      /^(staff|support|administrator|admin|moderator|mod|team|management)$/i.test(r.name) ||
      /\b(staff|support|admin|moderator)\b/i.test(r.name)
    );
    if (isStaffRole) return true;
  }

  return false;
}

module.exports = {
  isStaffMember
};
