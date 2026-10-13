import sanitizeHtml from 'sanitize-html';

/**
 * SPEC §4.6 allowlist for news bodies: `p h2 h3 ul ol li strong em a[href=https|mailto]
 * blockquote code pre br`. Links get `rel="noopener noreferrer" target="_blank"`.
 * Everything else (scripts, styles, event handlers, images, other schemes) is removed.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'blockquote', 'code', 'pre', 'br'],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['https', 'mailto'],
  allowedSchemesByTag: { a: ['https', 'mailto'] },
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Map common editor output to the allowlist instead of dropping the text formatting.
  // Tag names are only changed statically: per-element renames confuse closing tags.
  transformTags: {
    b: 'strong',
    i: 'em',
    h1: 'h2',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
    a: (tagName, attribs): sanitizeHtml.Tag => ({
      tagName,
      attribs: { ...(attribs.href ? { href: attribs.href.trim() } : {}), rel: 'noopener noreferrer', target: '_blank' },
    }),
  },
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object'],
};

/** Links whose href was removed (unsafe scheme) are unwrapped to plain text. */
const ANCHOR_WITHOUT_HREF = /<a(?![^>]*\shref=)[^>]*>([\s\S]*?)<\/a>/g;

export function sanitizeNewsHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).replace(ANCHOR_WITHOUT_HREF, '$1').trim();
}

/** True when the sanitised body has visible text (publish guard, SPEC §5.5). */
export function hasText(html: string): boolean {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim().length > 0;
}
