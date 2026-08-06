import { parseFragment } from 'parse5';
import { SAXParser } from 'parse5-sax-parser';

const PRIMARY_SLOT = 'data-storefront-primary-navigation-slot';
const MEMBER_SLOT = 'data-storefront-member-auth-slot';
const CART_SLOT = 'data-storefront-cart-slot';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const PRIMARY_ELEMENTS = new Set(['div', 'header', 'nav']);
const FORBIDDEN_ELEMENTS = new Set(['noscript', 'plaintext', 'template']);
const HTML_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'
]);
const INTERACTIVE_ELEMENTS = new Set([
  'a', 'button', 'details', 'label', 'select', 'summary', 'textarea'
]);
const RESERVED_RUNTIME_ATTRIBUTES = new Set([
  'data-storefront-auth-open',
  'data-storefront-auth-modal',
  'data-storefront-cart-root',
  'data-cart-trigger',
  'data-storefront-primary-navigation-runtime',
  'data-storefront-primary-navigation',
  'data-storefront-category-menu',
  'data-storefront-navbar-categories',
  'data-storefront-nav-items',
  'data-storefront-nav-node',
  'data-storefront-nav-trigger',
  'data-storefront-nav-panel',
  'data-storefront-nav-children',
  'data-storefront-nav-depth'
]);

export function validateThemeNavbar(html) {
  preflightStaticThemeHtml(html);
  rejectDocumentWrapperTokens(html);
  const fragment = parseThemeFragment(html);
  const elements = collectAndValidateElements(fragment, html);

  const primaryNode = requireSingleSlot(elements, PRIMARY_SLOT, 'container');
  if (primaryNode.namespaceURI !== HTML_NAMESPACE) {
    throw validationError(`Theme navbar ${PRIMARY_SLOT} required slot must use an HTML namespace structural container.`);
  }
  if (!PRIMARY_ELEMENTS.has(primaryNode.tagName)) {
    throw validationError(`Theme navbar ${PRIMARY_SLOT} must use a supported structural container element.`);
  }
  if (!isStructurallyEmpty(primaryNode)) {
    throw validationError(`Theme navbar ${PRIMARY_SLOT} must be structurally empty.`);
  }

  const memberNode = requireClickableSlot(elements, MEMBER_SLOT);
  const cartNode = requireClickableSlot(elements, CART_SLOT);
  validateAllAnchorHrefs(elements);
  const requiredNodes = [primaryNode, memberNode, cartNode];

  if (new Set(requiredNodes).size !== requiredNodes.length) {
    throw validationError('Theme navbar required slots must use three distinct live elements.');
  }
  for (const [node, slot] of [[primaryNode, PRIMARY_SLOT], [memberNode, MEMBER_SLOT], [cartNode, CART_SLOT]]) {
    if (hasInteractiveAncestor(node)) {
      throw validationError(`Theme navbar ${slot} required slot must not be inside an interactive ancestor.`);
    }
    validateRequiredSlotAvailability(node, slot, slot !== PRIMARY_SLOT);
  }
  for (const node of [memberNode, cartNode]) {
    if (isDescendantOf(node, primaryNode)) {
      throw validationError('Theme navbar member and cart slots must not be descendants of the primary navigation slot.');
    }
  }

  for (const node of elements) {
    for (const attribute of node.attrs) {
      if (RESERVED_RUNTIME_ATTRIBUTES.has(attribute.name)) {
        throw validationError(`Theme navbar contains reserved storefront runtime attribute: ${attribute.name}.`);
      }
    }
  }
}

function preflightStaticThemeHtml(html) {
  const directMarker = firstMarker(html, ['{{', '{!!', '<?', '<%']);
  if (directMarker !== -1) {
    throw staticThemeHtmlError(html, directMarker);
  }

  let atIndex = html.indexOf('@');
  while (atIndex !== -1) {
    if (isForbiddenBladeDirectiveAt(html, atIndex, true)) {
      throw staticThemeHtmlError(html, atIndex);
    }
    atIndex = html.indexOf('@', atIndex + 1);
  }

  const componentMatch = /<\s*\/?\s*x(?:-|:)/i.exec(html);
  if (componentMatch) {
    throw staticThemeHtmlError(html, componentMatch.index);
  }
  const boundAttributeMatch = /<(?:[^"'<>]|"[^"]*"|'[^']*')*\s(?:x-bind:|bind:|:)[^\s=>/]+/i.exec(html);
  if (boundAttributeMatch) {
    throw staticThemeHtmlError(html, boundAttributeMatch.index);
  }
}

function rejectDocumentWrapperTokens(html) {
  const wrappers = new Set(['html', 'head', 'body']);
  const parser = new SAXParser({ sourceCodeLocationInfo: true });
  let wrapper = null;
  parser.on('startTag', (token) => {
    if (!wrapper && wrappers.has(token.tagName)) {
      wrapper = token;
    }
  });
  parser.end(html);

  if (wrapper) {
    const location = wrapper.sourceCodeLocation;
    throw validationError(
      `Theme navbar must be an HTML fragment and must not contain document wrapper <${wrapper.tagName}> tags. Found at line ${location.startLine}, column ${location.startCol}.`
    );
  }
}

function parseThemeFragment(html) {
  const parseErrors = [];
  const fragment = parseFragment(html, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrors.push(error)
  });
  if (parseErrors.length > 0) {
    const error = parseErrors[0];
    throw htmlParseError(error.startLine, error.startCol, humanizeParseError(error.code));
  }
  rejectUnrepresentedClosingTags(fragment, html);
  return fragment;
}

function rejectUnrepresentedClosingTags(fragment, html) {
  const represented = new Set();
  const ignoredRanges = [];
  const rawTextElements = new Set(['iframe', 'noembed', 'noframes', 'script', 'style', 'textarea', 'title', 'xmp']);

  const visit = (node, rawTextParent = false) => {
    const location = node.sourceCodeLocation;
    if (location?.endTag) {
      represented.add(location.endTag.startOffset);
    }
    if (location?.startTag) {
      ignoredRanges.push([location.startTag.startOffset, location.startTag.endOffset]);
    }
    if (node.nodeName === '#comment' && location) {
      ignoredRanges.push([location.startOffset, location.endOffset]);
    }
    if (rawTextParent && location) {
      ignoredRanges.push([location.startOffset, location.endOffset]);
    }
    const isRawText = rawTextElements.has(node.tagName);
    for (const child of node.childNodes ?? []) {
      visit(child, isRawText);
    }
    if (node.content) {
      visit(node.content, false);
    }
  };
  visit(fragment);
  const searchableIgnoredRanges = mergeSourceRanges(ignoredRanges);

  const closingTagPattern = /<\/\s*[a-z][^\s/>]*\s*>/gi;
  let match = closingTagPattern.exec(html);
  while (match) {
    if (!represented.has(match.index) && !sourceRangesContain(searchableIgnoredRanges, match.index)) {
      const location = sourcePosition(html, match.index);
      throw htmlParseError(location.line, location.column, 'unexpected closing tag');
    }
    match = closingTagPattern.exec(html);
  }
}

function mergeSourceRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

function sourceRangesContain(ranges, offset) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const [start, end] = ranges[middle];
    if (offset < start) {
      high = middle - 1;
    } else if (offset >= end) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

function collectAndValidateElements(fragment, html) {
  const elements = [];

  const visit = (node) => {
    if (node.tagName) {
      validateElementSource(node, html);
      if (FORBIDDEN_ELEMENTS.has(node.tagName)) {
        throw validationError(`Theme navbar does not allow the ${node.tagName} element.`);
      }
      elements.push(node);
    }
    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };

  visit(fragment);
  return elements;
}

function validateElementSource(node, html) {
  const location = node.sourceCodeLocation;
  if (!location?.startTag) {
    const parentLocation = node.parentNode?.sourceCodeLocation?.startTag;
    throw htmlParseError(parentLocation?.startLine ?? 1, parentLocation?.startCol ?? 1, `browser-generated <${node.tagName}> element`);
  }

  if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
    if (!location.endTag && !html.slice(location.startTag.startOffset, location.startTag.endOffset).match(/\/\s*>$/)) {
      throw htmlParseError(location.startLine, location.startCol, `unclosed <${node.tagName}> element`);
    }
    return;
  }

  if (!HTML_VOID_ELEMENTS.has(node.tagName) && !location.endTag) {
    throw htmlParseError(location.startLine, location.startCol, `unclosed <${node.tagName}> element`);
  }
}

function requireSingleSlot(elements, slot, kind) {
  const matches = elements.filter((node) => hasAttribute(node, slot));
  if (matches.length === 0) {
    throw validationError(`Theme navbar is missing required ${slot} ${kind} slot.`);
  }
  if (matches.length > 1) {
    throw validationError(`Theme navbar must not contain duplicate ${slot} slots.`);
  }
  return matches[0];
}

function requireClickableSlot(elements, slot) {
  const node = requireSingleSlot(elements, slot, 'clickable');
  if (node.namespaceURI !== HTML_NAMESPACE) {
    throw validationError(`Theme navbar ${slot} required slot must use an HTML namespace anchor or button element.`);
  }
  if (!['a', 'button'].includes(node.tagName)) {
    throw validationError(`Theme navbar ${slot} must use a clickable anchor or button element.`);
  }
  if (node.tagName === 'button' && hasAttribute(node, 'disabled')) {
    throw validationError(`Theme navbar ${slot} must use an enabled button.`);
  }
  if (node.tagName === 'a' && getAttribute(node, 'href')?.trim() === '') {
    throw validationError(`Theme navbar ${slot} anchor must have a usable href.`);
  }
  if (node.tagName === 'a' && !hasAttribute(node, 'href')) {
    throw validationError(`Theme navbar ${slot} anchor must have a usable href.`);
  }
  return node;
}

function validateAllAnchorHrefs(elements) {
  for (const node of elements) {
    if (node.tagName !== 'a') {
      continue;
    }
    const hrefs = node.attrs.filter((attribute) => attribute.name === 'href');
    if (hrefs.length !== 1 || hrefs[0].value.trim() === '') {
      throw validationError('Theme navbar every anchor must have exactly one valued, nonblank href.');
    }
    if (!isSafeHref(hrefs[0].value)) {
      throw validationError('Theme navbar anchor has an unsafe or unsupported href.');
    }
  }
}

function validateRequiredSlotAvailability(node, slot, clickable) {
  for (let current = node; current?.tagName; current = current.parentNode) {
    if (hasAttribute(current, 'hidden')) {
      throw validationError(`Theme navbar ${slot} required slot must remain available and must not be hidden.`);
    }
    if (hasAttribute(current, 'inert')) {
      throw validationError(`Theme navbar ${slot} required slot must remain available and must not be inert.`);
    }
    if (getAttribute(current, 'aria-hidden')?.trim().toLowerCase() === 'true') {
      throw validationError(`Theme navbar ${slot} required slot must remain available and must not be aria-hidden.`);
    }
    if (clickable && getAttribute(current, 'aria-disabled')?.trim().toLowerCase() === 'true') {
      throw validationError(`Theme navbar ${slot} required slot must remain available and must not be aria-disabled.`);
    }
  }

  if (clickable && node.tagName === 'button') {
    for (let ancestor = node.parentNode; ancestor?.tagName; ancestor = ancestor.parentNode) {
      if (ancestor.tagName === 'fieldset' && hasAttribute(ancestor, 'disabled')) {
        throw validationError(`Theme navbar ${slot} required slot must remain available and must not be inside a disabled fieldset.`);
      }
    }
  }
}

function isStructurallyEmpty(node) {
  return (node.childNodes ?? []).every((child) => {
    if (child.nodeName === '#comment') {
      return true;
    }
    return child.nodeName === '#text' && child.value.trim() === '';
  });
}

function hasInteractiveAncestor(node) {
  for (let ancestor = node.parentNode; ancestor?.tagName; ancestor = ancestor.parentNode) {
    if (INTERACTIVE_ELEMENTS.has(ancestor.tagName)) {
      return true;
    }
  }
  return false;
}

function isDescendantOf(node, possibleAncestor) {
  for (let ancestor = node.parentNode; ancestor?.tagName; ancestor = ancestor.parentNode) {
    if (ancestor === possibleAncestor) {
      return true;
    }
  }
  return false;
}

function hasAttribute(node, name) {
  return node.attrs.some((attribute) => attribute.name === name);
}

function getAttribute(node, name) {
  return node.attrs.find((attribute) => attribute.name === name)?.value;
}

function isSafeHref(rawHref) {
  const normalizedHref = decodeHrefEntities(rawHref.trim())
    .trim()
    .replace(/[\u0000-\u0020\u007f]+/g, '');

  if (normalizedHref.startsWith('#')) {
    return true;
  }
  if (normalizedHref.startsWith('//')) {
    return isSafeAbsoluteUrl(`https:${normalizedHref}`);
  }
  if (normalizedHref.startsWith('/') || normalizedHref.startsWith('./') || normalizedHref.startsWith('../')) {
    return true;
  }
  if (/^https?:\/\//i.test(normalizedHref)) {
    return isSafeAbsoluteUrl(normalizedHref);
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(normalizedHref) && !normalizedHref.startsWith('\\');
}

function decodeHrefEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (match, digits) => decodeHrefCodePoint(match, Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);?/g, (match, digits) => decodeHrefCodePoint(match, Number.parseInt(digits, 10)))
    .replace(/&(colon|tab|newline);/gi, (match, entityName) => ({
      colon: ':',
      tab: '\t',
      newline: '\n'
    })[entityName.toLowerCase()]);
}

function decodeHrefCodePoint(original, codePoint) {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF
    ? String.fromCodePoint(codePoint)
    : original;
}

function isSafeAbsoluteUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '';
  } catch {
    return false;
  }
}

function isForbiddenBladeDirectiveAt(value, index, detectEmbeddedCall = false) {
  if (value[index] !== '@') {
    return false;
  }
  const previous = value[index - 1] ?? '';
  const hasBoundary = index === 0 || !/[a-z0-9_]/i.test(previous);
  if (!hasBoundary && !detectEmbeddedCall) {
    return false;
  }
  let end = index + 1;
  while (/[a-z0-9_]/i.test(value[end] ?? '')) {
    end += 1;
  }
  if (end === index + 1) {
    return false;
  }
  while (/\s/.test(value[end] ?? '')) {
    end += 1;
  }
  return hasBoundary || (detectEmbeddedCall && value[end] === '(');
}

function firstMarker(value, markers) {
  return markers.reduce((first, marker) => {
    const index = value.indexOf(marker);
    return index !== -1 && (first === -1 || index < first) ? index : first;
  }, -1);
}

function staticThemeHtmlError(html, offset) {
  const location = sourcePosition(html, offset);
  return validationError(
    `Theme navbar must use static HTML and static slot structure and does not allow dynamic Blade attributes inside opening tags, server-template or Blade syntax, including raw Blade output and Blade directives; PHP, components, and bound attributes are forbidden. Escaped Blade expressions are not allowed. Found at line ${location.line}, column ${location.column}.`
  );
}

function htmlParseError(line, column, reason) {
  return validationError(`Theme navbar HTML parse error at line ${line}, column ${column}: ${reason}.`);
}

function humanizeParseError(code) {
  return String(code ?? 'invalid HTML').replaceAll('-', ' ');
}

function sourcePosition(value, offset) {
  const prefix = value.slice(0, offset);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_FAILED';
  return error;
}
