const RESERVED = new Set('page_view heatmap_click heatmap_move select_item add_to_cart remove_from_cart product_view view_item_list filter_applied sort_changed search_performed filters_cleared page_changed items_per_page_changed checkout_start view_cart purchase shipping_details login sign_up order_confirmation'.split(' '));
function normalizeName(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, '_'); }
function validateName(value) {
  const name = normalizeName(value);
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(name)) throw new Error('Use 3–64 characters: lowercase letters, numbers and underscores; start with a letter.');
  if (RESERVED.has(name)) throw Object.assign(new Error('This event name is already used by the SDK or frontend. Choose a different name.'), { status: 409 });
  return name;
}
function validateTracking(input, project) {
  if (!input || typeof input.selector !== 'string' || !input.selector.trim() || input.selector.length > 1000) throw new Error('An element selector is required (maximum 1000 characters).');
  const url = new URL(input.pageUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !project.allowedOrigins.includes(url.origin)) throw new Error('Use a page URL from this project’s allowed origins.');
  if (!['exact', 'prefix'].includes(input.match)) throw new Error('Choose an exact path or path prefix.');
  return { selector: input.selector.trim(), pageUrl: url.origin + url.pathname, origin: url.origin, path: url.pathname, match: input.match };
}
module.exports = { normalizeName, validateName, validateTracking, RESERVED };
