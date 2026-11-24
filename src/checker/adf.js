/**
 * Turn Jira's rich text (Atlassian Document Format, ADF) into plain text lines.
 *
 * Jira Cloud's REST API v3 returns the description and rich-text custom fields
 * as ADF: a JSON tree of nodes. The checker works on plain text, so we walk the
 * tree and write one line per paragraph, heading, list item or table cell.
 * We keep the visible text exactly, so a quote in a flag matches what the user
 * sees in Jira.
 */

// Block nodes that start a new line of text.
const BLOCK_NODES = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'panel', 'tableCell',
  'tableHeader', 'expand', 'nestedExpand', 'decisionItem', 'taskItem',
]);

/**
 * Convert an ADF document (or a plain string) to plain text.
 * @param {object|string|null|undefined} doc ADF document, or a string for older fields.
 * @returns {string} Plain text with one line per block.
 */
export function adfToText(doc) {
  if (doc === null || doc === undefined) return '';
  if (typeof doc === 'string') return doc;
  if (typeof doc !== 'object') return String(doc);

  const lines = [];
  let current = '';

  // Finish the line we are building and start a new one.
  const flush = () => {
    if (current.trim() !== '') lines.push(current.trimEnd());
    current = '';
  };

  // Depth-first walk. `prefix` marks list items so the parser sees bullets.
  const walk = (node, prefix) => {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'text':
        current += node.text || '';
        return;
      case 'hardBreak':
        flush();
        return;
      case 'mention':
        current += (node.attrs && node.attrs.text) || '@someone';
        return;
      case 'emoji':
        current += (node.attrs && (node.attrs.text || node.attrs.shortName)) || '';
        return;
      case 'inlineCard':
      case 'blockCard':
        current += (node.attrs && node.attrs.url) || '';
        return;
      case 'status':
        current += (node.attrs && node.attrs.text) || '';
        return;
      case 'date':
        current += (node.attrs && node.attrs.timestamp) || '';
        return;
      case 'bulletList':
      case 'orderedList': {
        flush();
        let n = (node.attrs && node.attrs.order) || 1;
        for (const item of node.content || []) {
          const marker = node.type === 'orderedList' ? `${n}. ` : '- ';
          n += 1;
          walk(item, marker);
        }
        flush();
        return;
      }
      case 'listItem': {
        // The first paragraph of a list item carries the bullet marker.
        flush();
        let first = true;
        for (const child of node.content || []) {
          if (first && child.type === 'paragraph') {
            current = prefix || '';
            for (const grand of child.content || []) walk(grand, '');
            flush();
          } else {
            walk(child, '- ');
          }
          first = false;
        }
        return;
      }
      default:
        break;
    }

    const isBlock = BLOCK_NODES.has(node.type);
    if (isBlock) flush();
    for (const child of node.content || []) walk(child, prefix);
    if (isBlock) flush();
  };

  walk(doc, '');
  flush();
  return lines.join('\n');
}
