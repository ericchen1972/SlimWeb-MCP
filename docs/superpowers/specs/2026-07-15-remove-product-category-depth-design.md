# Remove Product Category Depth Design

## Goal

Remove the obsolete fixed product-category depth setting from SlimWeb-MCP and Webless so product categories are governed only by the recursive `parent_id` tree.

## Contract

- `slimweb_settings_get` no longer describes or returns `product_category_depth`.
- `slimweb_settings_update` no longer advertises or writes `product_category_depth`.
- `slimweb_categories_list/upsert` remain the category contract: roots use `parent_id: null`, descendants use a category ID, products belong to leaf categories, and cycles remain invalid.

## Webless behavior

- Basic-settings controllers, props, frontend state, response payloads, copy, and tests no longer carry category depth.
- Product import always considers every non-empty leaf category for automatic name matching, regardless of the legacy database value.
- The existing `sites.product_category_depth` database column remains temporarily for migration compatibility, but it is removed from model fillable fields and no active application or MCP behavior reads or writes it.

## Compatibility

Old clients may still send the removed field. It is outside the public schema and is ignored rather than used. No destructive database migration is included.

## Verification

Tests prove the live tool schema and basic-settings output omit the field, settings updates no longer include it in SQL, Webless basic-settings responses omit it, and product import still matches a leaf category even when the legacy column contains `1`.
