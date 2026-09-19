/**
 * tableFormatter.js
 *
 * Utilities for formatting Discord-compatible tables and ensuring
 * proper user pings/mentions in AI responses.
 */

/**
 * Converts raw markdown pipe tables (| col | col |) into clean,
 * beautifully aligned monospace text blocks (```text ... ```) using
 * Unicode box-drawing borders so they render correctly in Discord.
 *
 * Leaves content inside existing code blocks untouched.
 *
 * @param {string} text - The input markdown text from the AI.
 * @returns {string} - The formatted text with Discord-friendly tables.
 */
function formatDiscordTables(text) {
  if (!text || typeof text !== 'string') return text;

  // 1. Protect existing code blocks (fenced ``` and inline `)
  const codeBlocks = [];
  const placeholderPrefix = '___CODE_BLOCK_PLACEHOLDER_';
  let processed = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `${placeholderPrefix}${idx}___`;
  });

  const lines = processed.split(/\r?\n/);
  const resultLines = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Helper: checks if a line looks like a table row (has '|' with at least 2 cells)
    const isTableRow = (l) => {
      const trimmed = l.trim();
      return trimmed.includes('|') && trimmed.replace(/^\||\|$/g, '').split('|').length >= 2;
    };

    // Helper: checks if a line is a markdown delimiter row (e.g. |:---|:---:|---:|)
    const isDelimiterRow = (l) => {
      const trimmed = l.trim();
      if (!trimmed.includes('|')) return false;
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      return cells.length >= 2 && cells.every(c => /^:?-{2,}:?$/.test(c));
    };

    if (isTableRow(line) && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      // Table found starting at line i
      const tableLines = [line, lines[i + 1]];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        tableLines.push(lines[j]);
        j++;
      }

      // Parse table cells
      const parseCells = (rowStr) => {
        let cleaned = rowStr.trim();
        if (cleaned.startsWith('|')) cleaned = cleaned.slice(1);
        if (cleaned.endsWith('|')) cleaned = cleaned.slice(0, -1);
        return cleaned.split('|').map(c => c.trim());
      };

      const headerCells = parseCells(tableLines[0]);
      const dataRows = tableLines.slice(2).map(parseCells);

      const numCols = Math.max(headerCells.length, ...dataRows.map(r => r.length));

      if (numCols >= 2) {
        const padRow = (r) => {
          const copy = [...r];
          while (copy.length < numCols) copy.push('');
          return copy;
        };

        const normHeader = padRow(headerCells);
        const normData = dataRows.map(padRow);

        // Calculate max character width per column (accounting for wide characters)
        const colWidths = [];
        for (let c = 0; c < numCols; c++) {
          let maxW = (normHeader[c] || '').length;
          for (const row of normData) {
            maxW = Math.max(maxW, (row[c] || '').length);
          }
          colWidths.push(Math.max(maxW, 3));
        }

        // Build clean Unicode box-drawing table
        const topBorder = '┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
        const midDivider = '├' + colWidths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
        const bottomBorder = '└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

        const formatRow = (cells) => {
          return '│ ' + cells.map((cell, idx) => cell.padEnd(colWidths[idx])).join(' │ ') + ' │';
        };

        const boxTable = [
          '```text',
          topBorder,
          formatRow(normHeader),
          midDivider,
          ...normData.map(formatRow),
          bottomBorder,
          '```'
        ];

        resultLines.push(...boxTable);
        i = j; // Advance past table
        continue;
      }
    }

    resultLines.push(line);
    i++;
  }

  let finalOutput = resultLines.join('\n');

  // Restore protected code blocks
  for (let idx = 0; idx < codeBlocks.length; idx++) {
    finalOutput = finalOutput.replace(`${placeholderPrefix}${idx}___`, () => codeBlocks[idx]);
  }

  return finalOutput;
}

/**
 * Replaces plain-text user mentions (e.g. @Bossa, @bossa9973, @User) with
 * actual clickable Discord pings (<@userId>). If no mention exists in the reply,
 * prepends the ping so the user receives a Discord notification.
 *
 * @param {string} text - The AI reply text.
 * @param {string} userId - The Discord snowflake ID of the user.
 * @param {string[]} usernames - Known usernames / display names to replace.
 * @returns {string} - Text guaranteed to contain <@userId>.
 */
function ensureUserPing(text, userId, usernames = []) {
  if (!text || !userId) return text;

  let result = text;

  // Replace plain-text mentions like @username, @displayName, @User
  const namesToMatch = [...usernames, 'user', 'User', 'customer', 'Customer'].filter(Boolean);
  for (const name of namesToMatch) {
    if (!name || name.length < 2) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<=^|[\\s(])@${escaped}(?=[\\s.,!?:;)~]|$)`, 'gi');
    result = result.replace(regex, `<@${userId}>`);
  }

  // Also replace any lingering @<username> or @12345
  result = result.replace(new RegExp(`@<${userId}>`, 'g'), `<@${userId}>`);

  // Check if <@userId> or <@!userId> exists anywhere in the text
  const hasPing = result.includes(`<@${userId}>`) || result.includes(`<@!${userId}>`);

  // If there is still no ping at all, prepend the ping to the start of the message
  if (!hasPing) {
    result = `<@${userId}>\n${result.trim()}`;
  }

  return result;
}

module.exports = {
  formatDiscordTables,
  ensureUserPing
};
