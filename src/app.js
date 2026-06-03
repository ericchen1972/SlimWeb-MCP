import { createHash, randomBytes } from 'node:crypto';

import { GoogleIdentityVerifier } from './googleVerifier.js';
import {
  createSessionToken,
  createSignedToken,
  readSessionToken,
  sessionCookie,
  verifySessionToken,
  verifySignedToken
} from './session.js';
import { WeblessAccountRepository } from './weblessRepository.js';

const SERVICE_NAME = 'slimweb-mcp';
const SERVICE_VERSION = '0.1.0';
const OAUTH_CODE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {}
};
function orderIdentityInputSchema() {
  return {
    type: 'object',
    properties: {
      site_id: { type: 'integer' },
      order_id: { type: 'integer' },
      order_no: { type: 'string' }
    },
    required: ['site_id']
  };
}

function orderListInputSchema() {
  return {
    type: 'object',
    properties: {
      site_id: { type: 'integer' },
      search_order_no: { type: 'string' },
      statuses: {
        type: 'array',
        items: { type: 'string', enum: ['pending', 'confirmed', 'returning', 'returned', 'cancelled'] }
      },
      limit: { type: 'integer' },
      offset: { type: 'integer' }
    },
    required: ['site_id']
  };
}

const SIGNED_UPLOAD_RUNTIME_GUIDANCE = 'Before using signed image upload, the AI must identify its own runtime. Continue only when the runtime can both read the source image bytes and make outbound HTTPS PUT requests, such as Codex or Hermes with local/code execution access. In ChatGPT Remote MCP, conversation attachments, /mnt/data paths, and hidden attachment rewrite are not reliable for remote MCP tools; if no downloadable URL or accessible local file bytes are available, explain that this client cannot upload the image and ask the user to use Codex/Hermes or provide a directly downloadable image URL.';
const IMAGE_SOURCE_SCHEMA = {
  type: 'object',
  description: `Committed SlimWeb media source. First call slimweb_uploads_create, use a capable AI runtime to PUT the uploaded or generated image bytes to upload_url, then call slimweb_uploads_commit and pass the returned media_path here. ${SIGNED_UPLOAD_RUNTIME_GUIDANCE} Do not pass base64, URLs, /mnt/data paths, local sandbox paths, attachment handles, or invented placeholder URLs.`,
  properties: {
    media_path: {
      type: 'string',
      description: 'Committed media path returned by slimweb_uploads_commit, such as sites/1/mcp-uploads/committed/<upload_id>.webp.'
    }
  },
  anyOf: [
    { required: ['media_path'] }
  ],
  additionalProperties: false
};
const PRODUCT_IMAGE_ITEM_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      description: `Product image entry. Use source.media_path from slimweb_uploads_commit. Uploaded user images and AI-generated images use the same signed upload flow when the AI runtime can access the image bytes. ${SIGNED_UPLOAD_RUNTIME_GUIDANCE}`,
      properties: {
        source: IMAGE_SOURCE_SCHEMA,
        suggested_filename: {
          type: 'string',
          description: 'Optional filename such as product-main.png.'
        },
        alt_text: {
          type: 'string',
          description: 'Optional image alt text.'
        }
      },
      required: ['source'],
      additionalProperties: false
    }
  ]
};
const UPLOAD_TARGET_USAGE_ENUM = ['product_image', 'article_image', 'page_asset', 'theme_asset', 'brand_asset', 'reference'];
const MCP_TOOLS = [
  {
    name: 'slimweb_auth_status',
    description: 'Return the authenticated SlimWeb MCP account status.',
    inputSchema: EMPTY_INPUT_SCHEMA
  },
  {
    name: 'slimweb_sites_list',
    description: 'List SlimWeb sites available to the authenticated account.',
    inputSchema: EMPTY_INPUT_SCHEMA
  },
  {
    name: 'slimweb_site_select',
    description: 'Validate and return a SlimWeb site selected from slimweb_sites_list. Use this before write operations when the user owns multiple sites.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Stable SlimWeb site ID selected from slimweb_sites_list.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_themes_list',
    description: 'List page style schemes/themes for a SlimWeb site, including Default and the currently active theme.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_themes_create_from_default',
    description: 'Create a new non-Default theme/page style scheme by copying only Default shell/root-element template files. Page content remains separated and falls back to Default unless explicitly created for the theme.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        name: {
          type: 'string',
          description: 'Human-readable theme name, such as 可愛版型.'
        },
        theme_mode: {
          type: 'string',
          enum: ['light', 'dark', 'system']
        }
      },
      required: ['site_id', 'name']
    }
  },
  {
    name: 'slimweb_themes_delete',
    description: 'Delete a non-Default theme/page style scheme and its stored template contents. The Default theme cannot be deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        theme_id: { type: 'integer' }
      },
      required: ['site_id', 'theme_id']
    }
  },
  {
    name: 'slimweb_theme_shell_get_context',
    description: 'Return reference-only JSON describing real storefront shell data such as nav items, category counts, cart/login buttons, footer contact items, and online support state. Call before creating or modifying visual theme elements.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Target theme ID or default.'
        }
      },
      required: ['site_id', 'theme_id']
    }
  },
  {
    name: 'slimweb_themes_update_root_elements',
    description: 'Update root-level theme fragments such as navbar, footer, online support, and theme-level CSS for a non-Default theme. Do not use this to overwrite page body content.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Target non-Default theme ID.'
        },
        fragments: {
          type: 'object',
          description: 'Optional root element HTML fragments keyed by navbar, footer, or online_support.'
        },
        css: {
          type: 'string',
          description: 'Optional theme CSS stored under root-elements assets.'
        }
      },
      required: ['site_id', 'theme_id']
    }
  },
  {
    name: 'slimweb_theme_style_profile_get',
    description: 'Read the editable style summary/profile for a theme so visual design can stay consistent with prior user requests.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        theme_id: { type: ['integer', 'string'] }
      },
      required: ['site_id', 'theme_id']
    }
  },
  {
    name: 'slimweb_theme_style_profile_upsert',
    description: 'Create or update a theme style summary/profile with user intent, visual keywords, color, typography, layout, illustration, and avoid notes.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        theme_id: { type: ['integer', 'string'] },
        summary: { type: 'string' },
        target_audience: { type: 'string' },
        visual_keywords: { type: 'array', items: { type: 'string' } },
        color_notes: { type: 'string' },
        typography_notes: { type: 'string' },
        layout_notes: { type: 'string' },
        illustration_notes: { type: 'string' },
        avoid_notes: { type: 'string' },
        user_request: { type: 'string' },
        user_requests: { type: 'array', items: { type: 'object' } },
        ai_design_notes: { type: 'string' }
      },
      required: ['site_id', 'theme_id']
    }
  },
  {
    name: 'slimweb_theme_style_profile_append_request',
    description: 'Append one user request/change note to a theme style profile history without replacing the existing profile.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        theme_id: { type: ['integer', 'string'] },
        request: { type: 'string' },
        ai_notes: { type: 'string' }
      },
      required: ['site_id', 'theme_id', 'request']
    }
  },
  {
    name: 'slimweb_site_readiness_get',
    description: 'Read a site readiness report listing incomplete or missing setup areas so AI can proactively tell the user what still needs to be configured.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        include_optional: {
          type: 'boolean',
          description: 'When true, include optional growth/marketing gaps such as coupons and discount codes. Defaults to false.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_seo_settings_get',
    description: 'Read site-level SEO, AEO, and GEO settings that are also visible in the SlimWeb admin SEO settings page.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_seo_settings_update',
    description: 'Update site-level SEO, AEO, and GEO settings. Use this when a user asks the AI to configure search, answer-engine, generative-engine, llms.txt, or social preview metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        seo_title: { type: 'string' },
        seo_description: { type: 'string' },
        seo_keywords: { type: 'string' },
        canonical_url: { type: 'string' },
        robots_policy: {
          type: 'string',
          enum: ['index,follow', 'noindex,follow', 'noindex,nofollow']
        },
        og_title: { type: 'string' },
        og_description: { type: 'string' },
        og_image_url: { type: 'string' },
        llms_txt: {
          type: 'string',
          description: 'Plain-text llms.txt summary for AI crawlers and answer engines.'
        },
        aeo_business_summary: {
          type: 'string',
          description: 'Concise business/entity summary for answer-engine responses.'
        },
        aeo_target_audience: {
          type: 'string',
          description: 'Primary audience and buyer intent.'
        },
        aeo_products_services: {
          type: 'string',
          description: 'Core products or services that answer engines should associate with this site.'
        },
        aeo_customer_questions: {
          type: 'string',
          description: 'Common customer questions, one per line when possible.'
        },
        aeo_answer_style: {
          type: 'string',
          description: 'Preferred answer style, tone, and constraints for AI answers.'
        },
        aeo_entity_facts: {
          type: 'string',
          description: 'Stable factual claims about brand, service area, shipping, returns, or contact points.'
        },
        geo_citation_targets: {
          type: 'string',
          description: 'Pages, policies, articles, and assets that generative engines should use as citation targets.'
        },
        geo_verifiable_claims: {
          type: 'string',
          description: 'Verifiable claims that AI-generated answers may repeat only when supported by site content.'
        },
        geo_trust_signals: {
          type: 'string',
          description: 'Trust signals such as company identity, support channels, policies, reviews, certifications, or guarantees.'
        },
        geo_same_as_profiles: {
          type: 'string',
          description: 'Official same-as URLs and profiles, one per line when possible.'
        },
        geo_comparison_positioning: {
          type: 'string',
          description: 'How the site should be positioned in AI comparisons against alternatives.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_integration_settings_get',
    description: 'Read site integration settings. Google and LINE fields are for member login; Facebook also supports member login, Messenger/Page ID, and Facebook comments; AI API and Notion are separate integration tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_integration_settings_update',
    description: 'Update site integration settings. Google and LINE are member-login integrations; Facebook can also configure Messenger/Page ID and Facebook comments; AI API and Notion credentials are separate integration tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        sms_account: { type: 'string' },
        sms_password: { type: 'string' },
        facebook_app_id: {
          type: 'string',
          description: 'Facebook App ID for member Facebook login.'
        },
        facebook_page_id: {
          type: 'string',
          description: 'Facebook Page ID for Messenger/customer-service connection.'
        },
        facebook_comment_on_products: {
          type: 'boolean',
          description: 'Enable Facebook comments on product pages.'
        },
        facebook_comment_on_posts: {
          type: 'boolean',
          description: 'Enable Facebook comments on article pages.'
        },
        line_login_channel_id: {
          type: 'string',
          description: 'LINE Login Channel ID for member LINE login.'
        },
        line_login_channel_secret: {
          type: 'string',
          description: 'LINE Login Channel Secret for member LINE login.'
        },
        google_login_client_id: {
          type: 'string',
          description: 'Google OAuth Client ID for member Google login.'
        },
        use_ai_customer_service: { type: 'boolean' },
        ai_provider: { type: 'string', enum: ['openai_gpt', 'google_gemini'] },
        ai_api_key: { type: 'string' },
        ai_model_name: { type: 'string' },
        notion_token: { type: 'string' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_mail_templates_get',
    description: 'Read SlimWeb event-specific email subjects and contents. These contents are rendered inside the single shared email layout.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_mail_templates_update',
    description: 'Update event-specific email subjects, HTML contents, or enabled state. Do not use this for the shared layout wrapper.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        templates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              trigger_event: {
                type: 'string',
                enum: ['order_created', 'order_shipped', 'store_arrived', 'return_requested', 'return_logistics', 'registration_code', 'password_reset']
              },
              subject: { type: 'string' },
              content: { type: 'string' },
              is_active: { type: 'boolean' }
            },
            required: ['trigger_event']
          }
        }
      },
      required: ['site_id', 'templates']
    }
  },
  {
    name: 'slimweb_mail_layout_get',
    description: 'Read the single shared SlimWeb email layout wrapper. Every event-specific mail content is inserted into {content}.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_mail_layout_update',
    description: 'Update the single shared SlimWeb email layout wrapper. The layout should include {content}; otherwise SlimWeb appends content after the layout.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        html: { type: 'string' },
        is_active: { type: 'boolean' }
      },
      required: ['site_id', 'html', 'is_active']
    }
  },
  {
    name: 'slimweb_payment_logistics_get',
    description: 'Read supported SlimWeb payment/logistics providers and current site settings. Use this to answer SlimWeb-specific payment/logistics questions from supported providers only.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_payment_logistics_update',
    description: 'Update supported SlimWeb payment/logistics provider credentials and enabled state. Only ECPay or NewebPay can be the enabled online card provider at one time; LINE Pay is exempt.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        payments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['ecpay', 'newebpay', 'linepay'] },
              mode: { type: 'string', enum: ['test', 'production'] },
              is_enabled: { type: 'boolean' },
              merchant_id: { type: 'string' },
              hash_key: { type: 'string' },
              hash_iv: { type: 'string' },
              language: { type: 'string', enum: ['zh-tw', 'zh-cn', 'en', 'jp', 'ko', 'th'] }
            },
            required: ['provider']
          }
        },
        logistics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['ecpay', 'newebpay', 'hct'] },
              mode: { type: 'string', enum: ['test', 'production'] },
              is_enabled: { type: 'boolean', description: 'HCT only. ECPay and NewebPay logistics follow the same payment provider enabled state.' },
              merchant_id: { type: 'string' },
              password: { type: 'string', description: 'HCT only. Encrypted after save.' },
              customer_id: { type: 'string', description: 'HCT only. Optional customer ID.' },
              sender_name: { type: 'string' },
              sender_phone: { type: 'string' },
              sender_zip: { type: 'string' },
              sender_address: { type: 'string' },
              store_types: {
                type: 'array',
                items: { type: 'string', enum: ['seven', 'family', 'hilife', 'ok'] },
                description: 'ECPay supports seven/family/hilife/ok. NewebPay supports seven/family/hilife only.'
              },
              logistics_type: {
                type: 'string',
                enum: ['c2c', 'b2c'],
                description: 'ECPay only. Must match ECPay backend setting. Use b2c for reverse logistics.'
              },
              collect_payment_enabled: { type: 'boolean', description: 'HCT only. Shows cash on delivery on checkout when enabled.' }
            },
            required: ['provider']
          }
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_orders_list',
    description: 'List normal SlimWeb orders with payment/logistics/refund state and available_actions for AI-safe order operations.',
    inputSchema: orderListInputSchema()
  },
  {
    name: 'slimweb_orders_pending_list',
    description: 'List pending normal SlimWeb orders that need admin handling. Each order includes available_actions.',
    inputSchema: orderListInputSchema()
  },
  {
    name: 'slimweb_orders_get',
    description: 'Get one SlimWeb order by order_id or order_no, including line items and available_actions.',
    inputSchema: orderIdentityInputSchema()
  },
  {
    name: 'slimweb_orders_create_logistics',
    description: 'Create a forward logistics order only when the exact provider/store_type appears in available_actions.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        order_id: { type: 'integer' },
        order_no: { type: 'string' },
        provider: { type: 'string', enum: ['ecpay', 'newebpay', 'hct'] },
        store_type: { type: 'string', enum: ['seven', 'family', 'hilife', 'ok'] },
        temperature: { type: 'string', enum: ['normal', 'refrigerated', 'frozen'] },
        carrier: { type: 'string', enum: ['tcat', 'post'] }
      },
      required: ['site_id', 'provider']
    }
  },
  {
    name: 'slimweb_orders_mark_shipped',
    description: 'Manually mark an order as shipped/completed when no logistics order was created.',
    inputSchema: orderIdentityInputSchema()
  },
  {
    name: 'slimweb_returns_pending_list',
    description: 'List active return orders that still need handling. Each return includes available_actions.',
    inputSchema: orderListInputSchema()
  },
  {
    name: 'slimweb_returns_create_logistics',
    description: 'Create reverse logistics only when the exact provider/type appears in available_actions.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        order_id: { type: 'integer' },
        order_no: { type: 'string' },
        provider: { type: 'string', enum: ['ecpay', 'newebpay', 'hct'] },
        type: { type: 'string', enum: ['home_delivery', 'cvs'] }
      },
      required: ['site_id', 'provider']
    }
  },
  {
    name: 'slimweb_returns_cancel',
    description: 'Cancel an active return and move it back to a normal completed order.',
    inputSchema: orderIdentityInputSchema()
  },
  {
    name: 'slimweb_returns_complete',
    description: 'Manually mark a return completed when no reverse logistics exists.',
    inputSchema: orderIdentityInputSchema()
  },
  {
    name: 'slimweb_refunds_complete',
    description: 'Manually mark an order as refunded for offline/manual refunds.',
    inputSchema: orderIdentityInputSchema()
  },
  {
    name: 'slimweb_refunds_create',
    description: 'Create an online card refund request for ECPay or NewebPay only when available_actions includes create_refund.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        order_id: { type: 'integer' },
        order_no: { type: 'string' },
        provider: { type: 'string', enum: ['ecpay', 'newebpay'] }
      },
      required: ['site_id', 'provider']
    }
  },
  {
    name: 'slimweb_dashboard_summary',
    description: 'Read dashboard KPI summary, recent orders, recent members, and low-stock products for a SlimWeb site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_settings_get',
    description: 'Read basic SlimWeb site settings such as status, website type, default country, product load mode, return days, and category depth.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_settings_update',
    description: 'Update basic SlimWeb site settings. Only send fields the user explicitly provided or confirmed.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        site_status: { type: 'string', enum: ['active', 'maintenance'] },
        member_verification: { type: 'string', enum: ['none', 'email'] },
        website_type: { type: 'string', enum: ['ecommerce', 'brand'] },
        default_country_code: { type: 'string', enum: ['TW', 'JP', 'KR', 'SG', 'HK', 'CN', 'US', 'CA', 'GB', 'AU'] },
        product_load_mode: { type: 'string', enum: ['pagination', 'dynamic'] },
        return_days_allowed: { type: 'integer' },
        product_category_depth: { type: 'integer', enum: [1, 2, 3] }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_admins_list',
    description: 'List site admins and permission keys. The first admin is the protected system administrator.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_admins_upsert',
    description: 'Create or update a site admin. The first admin always keeps system_admin permission.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        admin_id: { type: 'integer' },
        google_email: {
          type: 'string',
          description: 'Google account email allowed to access this site admin.'
        },
        permissions: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['site_id', 'google_email', 'permissions']
    }
  },
  {
    name: 'slimweb_admins_delete',
    description: 'Delete a site admin. The first system administrator cannot be deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        admin_id: { type: 'integer' }
      },
      required: ['site_id', 'admin_id']
    }
  },
  {
    name: 'slimweb_external_assets_list',
    description: 'List external CSS/JS assets by site, theme, or page scope.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_external_assets_upsert',
    description: 'Create or update an external CSS/JS asset. Use scope=site for global assets, scope=theme for template assets, and scope=page for one page key.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        asset_id: { type: 'integer' },
        scope: { type: 'string', enum: ['site', 'theme', 'page'] },
        asset_type: { type: 'string', enum: ['css', 'js'] },
        url: { type: 'string' },
        placement: { type: 'string', enum: ['head', 'body_end'] },
        load_mode: { type: 'string', enum: ['normal', 'defer', 'async'] },
        site_page_id: { type: 'integer' },
        page_key: { type: 'string' },
        sort_order: { type: 'integer' },
        is_enabled: { type: 'boolean' },
        purpose: { type: 'string' },
        attributes: { type: 'object' }
      },
      required: ['site_id', 'scope', 'asset_type', 'url']
    }
  },
  {
    name: 'slimweb_external_assets_delete',
    description: 'Delete one external CSS/JS asset.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        asset_id: { type: 'integer' }
      },
      required: ['site_id', 'asset_id']
    }
  },
  {
    name: 'slimweb_external_assets_reorder',
    description: 'Reorder external CSS/JS assets by asset IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        asset_ids: {
          type: 'array',
          items: { type: 'integer' }
        }
      },
      required: ['site_id', 'asset_ids']
    }
  },
  {
    name: 'slimweb_images_import_chatgpt_attachment',
    description: 'Import one image from a ChatGPT web/desktop conversation attachment using OpenAI fileParams. Use this only when you are ChatGPT and the image was uploaded in the conversation. Codex, Hermes, Gemini, Claude, Grok, DeepSeek, and clients that can read image bytes should use slimweb_uploads_create plus slimweb_uploads_commit instead.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        target_usage: {
          type: 'string',
          enum: UPLOAD_TARGET_USAGE_ENUM
        },
        filename: {
          type: 'string',
          description: 'Optional desired filename. If omitted, the OpenAI file name is used.'
        },
        image: {
          type: 'object',
          description: 'OpenAI fileParams object supplied by ChatGPT. Expected fields include download_url, file_id, name or file_name, mime_type, and size.',
          additionalProperties: true
        }
      },
      required: ['site_id', 'target_usage', 'image']
    },
    _meta: {
      'openai/fileParams': ['image']
    }
  },
  {
    name: 'slimweb_uploads_create',
    description: `Create a short-lived Webless signed upload URL for an image. After this call, a capable AI runtime must PUT the raw image bytes to upload_url with the returned headers, then call slimweb_uploads_commit. This replaces base64 image transport. ${SIGNED_UPLOAD_RUNTIME_GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        filename: {
          type: 'string',
          description: 'Original or desired image filename, such as product-main.png.'
        },
        mime_type: {
          type: 'string',
          enum: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
        },
        size_bytes: {
          type: 'integer',
          description: 'Exact source image byte size before upload.'
        },
        target_usage: {
          type: 'string',
          enum: UPLOAD_TARGET_USAGE_ENUM
        }
      },
      required: ['site_id', 'filename', 'mime_type', 'size_bytes', 'target_usage']
    }
  },
  {
    name: 'slimweb_uploads_commit',
    description: 'Commit a completed signed image upload. Call only after a capable AI runtime has PUT the image bytes to upload_url. Returns media_path/public_url for products, articles, page assets, and generated images.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        upload_id: { type: 'string' },
        upload_token: { type: 'string' }
      },
      required: ['site_id', 'upload_id', 'upload_token']
    }
  },
  {
    name: 'slimweb_articles_list',
    description: 'List articles for a SlimWeb site so the AI can choose an article to edit or avoid duplicates.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        page: { type: 'integer' },
        per_page: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_articles_upsert',
    description: 'Create or update an article with HTML layout, required 16:9 cover image when creating a new article, and optional content images. Creative article requests must draft the article and cover-image concept first, generate or propose the 16:9 main image, and ask for user confirmation before calling this write tool. If ChatGPT generated the selected cover image, ask the user to paste or re-upload the selected image so it becomes a user attachment, then call slimweb_images_import_chatgpt_attachment to get media_path before creating the article. The article title is rendered by SlimWeb from the title field, so content_html must start with the article body and must not repeat the same title as an h1. Image sources must be committed media_path values from slimweb_uploads_commit or slimweb_images_import_chatgpt_attachment; use returned media URLs inside content_html for article body layout. Non-creative updates using user-provided final text and images may proceed directly.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        article_id: { type: 'integer' },
        notion_page_id: { type: 'string' },
        title: { type: 'string' },
        content_html: {
          type: 'string',
          description: 'Safe article body HTML. Do not include the article title as an h1 because SlimWeb renders title separately. Do not include script/link/iframe tags or inline event handlers.'
        },
        cover_image: {
          ...IMAGE_SOURCE_SCHEMA,
          description: 'Required when creating a new article. Use a 16:9 main image media_path returned by slimweb_uploads_commit or slimweb_images_import_chatgpt_attachment. If the image was generated by ChatGPT, ask the user to paste or re-upload the selected image first so fileParams can import it.'
        },
        content_images: {
          type: 'array',
          description: 'Optional reusable content images for the article body.',
          items: {
            type: 'object',
            properties: {
              source: IMAGE_SOURCE_SCHEMA,
              suggested_filename: { type: 'string' },
              alt_text: { type: 'string' }
            },
            required: ['source'],
            additionalProperties: false
          }
        }
      },
      required: ['site_id', 'title', 'content_html']
    }
  },
  {
    name: 'slimweb_categories_list',
    description: 'List product categories as a tree for a SlimWeb site. Use this before creating categories or assigning a product to a category.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_categories_upsert',
    description: 'Create or update a product category using site_categories fields. When creating, the AI must generate a semantic SVG icon from the user wording and pass it as icon_svg_base64. If no parent category is specified, create or move it as a root category.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        category_id: {
          type: 'integer',
          description: 'Existing category ID when updating. Omit to create.'
        },
        parent_id: {
          type: ['integer', 'null'],
          description: 'Parent category ID. When creating, omit or pass null for a root category. When updating, omit to keep the current parent, or pass null to move to root.'
        },
        name: { type: 'string' },
        icon_svg_base64: {
          type: 'string',
          description: 'Base64-encoded SVG markup generated by the AI for this category icon. Required when creating a category. If the user did not specify a color, use #9ca3af.'
        },
        sort_order: { type: 'integer' }
      },
      required: ['site_id', 'name']
    }
  },
  {
    name: 'slimweb_categories_delete',
    description: 'Delete a product category only when it and its child categories contain no products.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        category_id: { type: 'integer' }
      },
      required: ['site_id', 'category_id']
    }
  },
  {
    name: 'slimweb_nav_items_list',
    description: 'List storefront navigation items as a tree for a SlimWeb site, including item type, URL, icon state, and children.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_nav_items_upsert',
    description: 'Create or update a storefront navigation item. When creating, the AI must generate a semantic SVG icon from the user wording and pass it as icon_svg_base64. If the user did not specify a color, use #9ca3af.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        nav_item_id: {
          type: 'integer',
          description: 'Existing navigation item ID when updating. Omit to create.'
        },
        parent_id: {
          type: ['integer', 'null'],
          description: 'Parent dropdown item ID. When creating, omit or pass null for a root item. When updating, omit to keep the current parent, or pass null to move to root.'
        },
        name: { type: 'string' },
        item_type: {
          type: 'string',
          enum: ['dropdown', 'link']
        },
        url: {
          type: 'string',
          description: 'Required when item_type is link. Ignored for dropdown items.'
        },
        icon_svg_base64: {
          type: 'string',
          description: 'Base64-encoded SVG markup generated by the AI. Required when creating a navigation item; pass a new value to redraw the icon.'
        },
        sort_order: { type: 'integer' }
      },
      required: ['site_id', 'name', 'item_type']
    }
  },
  {
    name: 'slimweb_nav_items_delete',
    description: 'Delete a storefront navigation item and its child navigation items.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        nav_item_id: { type: 'integer' }
      },
      required: ['site_id', 'nav_item_id']
    }
  },
  {
    name: 'slimweb_products_list',
    description: 'List products by category, status, keyword, or low stock so the AI can avoid duplicate products or choose a product to edit.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        category_id: { type: 'integer' },
        keyword: { type: 'string' },
        status: { type: 'string', enum: ['all', 'active', 'hidden', 'sold_out'] },
        max_stock: { type: 'integer' },
        page: { type: 'integer' },
        per_page: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_products_get',
    description: 'Read one product including images, variants, and quantity discounts.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        product_id: { type: 'integer' }
      },
      required: ['site_id', 'product_id']
    }
  },
  {
    name: 'slimweb_products_upsert',
    description: 'Create or update one product using Webless product database fields. The AI must call slimweb_categories_list first and ask the user to choose an existing leaf category when category is not explicitly specified. Do not create an inferred category for a product unless the user confirms it through slimweb_categories_upsert. A product must have at least one primary image. If name, site_category_id, base_price, or primary image is missing, ask the user before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        product_id: { type: 'integer' },
        site_category_id: {
          type: 'integer',
          description: 'Leaf product category ID.'
        },
        sku: {
          type: 'string',
          description: 'Optional. If omitted when creating, MCP generates an import-style SKU.'
        },
        name: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        base_price: { type: 'integer' },
        sale_price: { type: 'integer' },
        sale_ends_at: { type: 'string' },
        cost_price: { type: 'integer' },
        stock: { type: 'integer' },
        buy_limit: { type: 'integer' },
        status: { type: 'string', enum: ['active', 'hidden', 'sold_out'] },
        is_service: { type: 'boolean' },
        gift_coupon_template_id: { type: 'integer' },
        variant_mode: { type: 'string', enum: ['none', 'same_price', 'different_price'] },
        replace_image_by_variant: { type: 'boolean' },
        primary_images: {
          type: 'array',
          description: `Required with at least one entry when creating. Use source.media_path values returned by slimweb_uploads_commit. ${SIGNED_UPLOAD_RUNTIME_GUIDANCE} Never pass base64, URLs, /mnt/data paths, attachment handles, or invented placeholder URLs.`,
          items: PRODUCT_IMAGE_ITEM_SCHEMA
        },
        content_images: {
          type: 'array',
          description: 'Optional product content/detail images. Use the same image source rules as primary_images.',
          items: PRODUCT_IMAGE_ITEM_SCHEMA
        },
        videos: {
          type: 'array',
          items: { type: 'string' }
        },
        same_price_spec_values: {
          type: 'array',
          items: { type: 'object' }
        },
        different_price_variants: {
          type: 'array',
          items: { type: 'object' }
        },
        quantity_discounts: {
          type: 'array',
          items: { type: 'object' }
        },
        confirmation_token: { type: 'string' }
      },
      required: ['site_id', 'site_category_id', 'name', 'base_price']
    }
  },
  {
    name: 'slimweb_products_delete',
    description: 'Delete one product and its stored product images.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        product_id: { type: 'integer' }
      },
      required: ['site_id', 'product_id']
    }
  },
  {
    name: 'slimweb_products_import_inspect',
    description: 'Parse a CSV, XLSX, or SQL product import source and return columns, sample rows, category context, and target schema for the AI client to create a mapping. This tool does not call OpenAI and does not write products.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        source: {
          type: 'object',
          description: 'Import source. Provide data_base64, file_url, or image_url/file-like URL plus filename/original_name and mime_type when available.',
          properties: {
            data_base64: { type: 'string' },
            file_url: { type: 'string' },
            image_url: { type: 'string' },
            mime_type: { type: 'string' },
            filename: { type: 'string' },
            original_name: { type: 'string' }
          }
        }
      },
      required: ['site_id', 'source']
    }
  },
  {
    name: 'slimweb_products_import_validate',
    description: 'Validate AI-client generated product import mapping against parsed CSV, XLSX, or SQL rows. If validation is not convertible, return failure reasons for the AI to explain to the user.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        source: { type: 'object' },
        mapping: {
          type: 'object',
          description: 'AI-generated mapping with field_mapping and image_mapping. Required field_mapping keys include name and base_price.'
        }
      },
      required: ['site_id', 'source', 'mapping']
    }
  },
  {
    name: 'slimweb_products_import_commit',
    description: 'Import products using an AI-client generated mapping after user confirmation. This uses the same product import rules as the admin import flow, without backend OpenAI analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        source: { type: 'object' },
        mapping: {
          type: 'object',
          description: 'Confirmed mapping produced by the AI client and validated by slimweb_products_import_validate.'
        },
        confirmation_token: {
          type: 'string',
          description: 'Optional AI-side marker that user confirmed the import.'
        }
      },
      required: ['site_id', 'source', 'mapping']
    }
  },
  {
    name: 'slimweb_coupon_templates_list',
    description: 'List coupon templates visible in the SlimWeb admin coupon page. Use this before editing or issuing coupons.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        issue_trigger: {
          type: 'string',
          enum: ['manual', 'all_members', 'order_threshold', 'birthday', 'product_bundle']
        },
        keyword: { type: 'string' },
        status: {
          type: 'string',
          enum: ['all', 'active', 'expired']
        },
        page: { type: 'integer' },
        per_page: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_coupon_templates_upsert',
    description: 'Create or update a SlimWeb coupon template using the same issue_trigger rules as the admin UI. Ask the user before calling when the coupon type is unclear, when manual vs all-members targeting is unclear, or when date range is missing for non-birthday coupons.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        coupon_template_id: {
          type: 'integer',
          description: 'Existing coupon template ID when updating. Omit to create.'
        },
        name: { type: 'string' },
        discount_amount: {
          type: 'integer',
          description: 'Fixed discount amount. Must be greater than 0.'
        },
        minimum_spend: {
          type: 'integer',
          description: 'Minimum spend. Ignored and stored as 0 for product_bundle coupons.'
        },
        issue_trigger: {
          type: 'string',
          enum: ['manual', 'all_members', 'order_threshold', 'birthday', 'product_bundle'],
          description: 'manual=手動發放給個別會員, all_members=發給所有會員, order_threshold=消費滿額自動送, birthday=生日禮券, product_bundle=搭配商品.'
        },
        trigger_amount: {
          type: 'integer',
          description: 'Required for order_threshold coupons.'
        },
        starts_at: {
          type: 'string',
          description: 'YYYY-MM-DD. Required for every issue_trigger except birthday.'
        },
        ends_at: {
          type: 'string',
          description: 'YYYY-MM-DD. Required for every issue_trigger except birthday.'
        },
        confirmation_token: {
          type: 'string',
          description: 'Optional AI-side confirmation marker after the user confirms campaign details.'
        }
      },
      required: ['site_id', 'name', 'discount_amount', 'issue_trigger']
    }
  },
	  {
	    name: 'slimweb_members_coupons_issue',
	    description: 'Assign an active manual coupon template to one member. Use only after the user confirms the target member and coupon; do not use for all-members, birthday, order-threshold, or product-bundle coupons.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        member_id: { type: 'integer' },
        coupon_template_id: { type: 'integer' },
        reason: {
          type: 'string',
          description: 'Optional note; stored as manual by current SlimWeb rules.'
        },
        confirmation_token: {
          type: 'string'
        }
      },
	      required: ['site_id', 'member_id', 'coupon_template_id']
	    }
	  },
	  {
	    name: 'slimweb_members_list',
	    description: 'List storefront members by keyword, status, tier, or spending range.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        keyword: { type: 'string' },
	        status: { type: 'string', enum: ['all', 'active', 'disabled'] },
	        min_spent: { type: 'integer' },
	        max_spent: { type: 'integer' },
	        page: { type: 'integer' },
	        per_page: { type: 'integer' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_members_get',
	    description: 'Read one member summary with recent orders and active manual coupons.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        member_id: { type: 'integer' }
	      },
	      required: ['site_id', 'member_id']
	    }
	  },
	  {
	    name: 'slimweb_discount_codes_list',
	    description: 'List discount codes for campaign tracking and storefront checkout rules.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        keyword: { type: 'string' },
	        platform: { type: 'string' },
	        page: { type: 'integer' },
	        per_page: { type: 'integer' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_discount_codes_upsert',
	    description: 'Create or update one discount code. discount_percent is the charged discount ratio, for example 0.05 means 5% off.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        discount_code_id: { type: 'integer' },
	        code: { type: 'string' },
	        discount_percent: { type: 'number' },
	        platform: { type: 'string' },
	        confirmation_token: { type: 'string' }
	      },
	      required: ['site_id', 'code', 'discount_percent']
	    }
	  },
	  {
	    name: 'slimweb_member_tiers_list',
	    description: 'List member tiers and spending thresholds.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_member_tiers_upsert',
	    description: 'Create or update one member tier.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        member_tier_id: { type: 'integer' },
	        name: { type: 'string' },
	        threshold_amount: { type: 'integer' },
	        min_spend: { type: 'integer' },
	        discount_percent: { type: 'number' },
	        confirmation_token: { type: 'string' }
	      },
	      required: ['site_id', 'name']
	    }
	  },
	  {
	    name: 'slimweb_threshold_gifts_list',
	    description: 'List threshold gift rules and linked service products.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        is_active: { type: 'boolean' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_threshold_gifts_upsert',
	    description: 'Create or update a threshold gift rule. product_id should reference a service product.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        threshold_gift_id: { type: 'integer' },
	        name: { type: 'string' },
	        threshold_amount: { type: 'integer' },
	        product_id: { type: 'integer' },
	        sort_order: { type: 'integer' },
	        is_active: { type: 'boolean' },
	        confirmation_token: { type: 'string' }
	      },
	      required: ['site_id', 'threshold_amount']
	    }
	  },
	  {
	    name: 'slimweb_product_add_ons_list',
	    description: 'List single-product add-on rules.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        product_id: { type: 'integer' },
	        is_active: { type: 'boolean' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_product_add_ons_upsert',
	    description: 'Create or update one single-product add-on rule.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        product_add_on_id: { type: 'integer' },
	        name: { type: 'string' },
	        product_id: { type: 'integer' },
	        add_on_product_id: { type: 'integer' },
	        add_on_price: { type: 'integer' },
	        max_quantity: { type: 'integer' },
	        sort_order: { type: 'integer' },
	        is_active: { type: 'boolean' },
	        confirmation_token: { type: 'string' }
	      },
	      required: ['site_id', 'product_id', 'add_on_product_id']
	    }
	  },
	  {
	    name: 'slimweb_faqs_list',
	    description: 'List storefront FAQ entries.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        keyword: { type: 'string' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_faqs_upsert',
	    description: 'Create or update one storefront FAQ entry.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        faq_id: { type: 'integer' },
	        question: { type: 'string' },
	        answer: { type: 'string' }
	      },
	      required: ['site_id', 'question', 'answer']
	    }
	  },
	  {
	    name: 'slimweb_customer_service_logs_list',
	    description: 'List recent AI customer-service logs with member context when available.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        member_id: { type: 'integer' },
	        keyword: { type: 'string' },
	        page: { type: 'integer' },
	        per_page: { type: 'integer' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_customer_service_settings_get',
	    description: 'Read AI customer-service settings for a SlimWeb site.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_customer_service_settings_update',
	    description: 'Update AI customer-service settings. Only send fields the user explicitly confirmed.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        use_ai_customer_service: { type: 'boolean' },
	        ai_customer_service_question_limit: { type: 'integer' },
	        ai_customer_service_retention_days: { type: 'integer' },
	        ai_customer_service_prompt: { type: 'string' },
	        confirmation_token: { type: 'string' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_exports_create',
	    description: 'Create an immediate structured export for members, orders, or returns. The MCP response includes rows and export metadata.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        export_type: { type: 'string', enum: ['members', 'orders', 'returns'] },
	        format: { type: 'string', enum: ['json', 'csv'] },
	        limit: { type: 'integer' }
	      },
	      required: ['site_id', 'export_type']
	    }
	  },
	  {
	    name: 'slimweb_audit_list',
	    description: 'List recent MCP tool execution records when the audit table exists, otherwise return an empty audit list with availability metadata.',
	    inputSchema: {
	      type: 'object',
	      properties: {
	        site_id: { type: 'integer' },
	        tool_name: { type: 'string' },
	        limit: { type: 'integer' }
	      },
	      required: ['site_id']
	    }
	  },
	  {
	    name: 'slimweb_assets_upload',
    description: 'Register a committed reusable asset such as an image for page, theme, product, or site use. Image bytes must already be uploaded through slimweb_uploads_create and slimweb_uploads_commit; use returned URLs/paths in page content instead of embedding file bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        source: {
          ...IMAGE_SOURCE_SCHEMA
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Optional target theme/page scheme. Omit to use the active theme.'
        },
        target_usage: {
          type: 'string',
          enum: ['reference', 'home_page', 'custom_page', 'theme_asset', 'product_image', 'brand_asset']
        },
        asset_scope: {
          type: 'string',
          enum: ['site', 'theme', 'page', 'product']
        },
        target_id: {
          type: ['integer', 'string'],
          description: 'Optional stable target ID, such as page ID, theme ID, or product ID.'
        },
        suggested_filename: {
          type: 'string'
        },
        alt_text: {
          type: 'string'
        }
      },
      required: ['site_id', 'source', 'target_usage', 'asset_scope']
    }
  },
  {
    name: 'slimweb_pages_get_home_content',
    description: 'Read the current homepage content for a site, including Default/theme context.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Optional target theme. Omit for currently active theme context.'
        },
        include_default: {
          type: 'boolean',
          description: 'Include Default homepage content when reading a non-Default theme.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_pages_update_home_content',
    description: 'Replace homepage content using structured page content and uploaded assets. Do not include script/link tags; manage external CSS/JS with external asset tools.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Target theme. Use Default only for allowed homepage content edits.'
        },
        content: {
          type: 'object',
          description: 'Structured homepage content. Do not include script/link tags; use external asset tools for CSS/JS.'
        },
        replacement_mode: {
          type: 'string',
          enum: ['replace_all', 'patch_sections']
        },
        confirmation_token: {
          type: 'string'
        }
      },
      required: ['site_id', 'content']
    }
  },
  {
    name: 'slimweb_pages_upsert',
    description: 'Create or update a non-fixed custom page body in Default or a selected theme. Use uploaded media_path URLs for reusable images; do not embed base64 images.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        page_key: {
          type: 'string',
          description: 'Custom page slug/key such as about-us. Fixed system page keys are reserved.'
        },
        title: {
          type: 'string',
          description: 'Human-readable page title.'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Optional target theme. Omit or use default to write Default page content.'
        },
        content: {
          type: 'object',
          description: 'Structured page body. Provide content.html or content.body_html. HTML must not include script/link/iframe tags or inline event handlers.'
        },
        confirmation_token: { type: 'string' }
      },
      required: ['site_id', 'page_key', 'title', 'content']
    }
  },
  {
    name: 'slimweb_pages_delete',
    description: 'Delete a custom template page from Default and all non-Default themes. Fixed system pages cannot be deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        page_key: { type: 'string' }
      },
      required: ['site_id', 'page_key']
    }
  },
  {
    name: 'slimweb_preview_get_page_url',
    description: 'Return a preview URL for a page with explicit site, theme, and page parameters so the AI can inspect the page visually before editing.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer'
        },
        page_key: {
          type: 'string',
          description: 'Page identifier such as home, about, or a custom page slug.'
        },
        theme_id: {
          type: ['integer', 'string']
        },
        mode: {
          type: 'string',
          enum: ['published', 'preview']
        }
      },
      required: ['site_id', 'page_key']
    }
  }
];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jsonResponse(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers
  });
  response.end(body);
}

function notFound(response) {
  jsonResponse(response, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found'
    }
  });
}

function methodNotAllowed(response) {
  jsonResponse(response, 405, {
    ok: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed'
    }
  });
}

async function readJsonRequest(request) {
  let rawBody = '';

  for await (const chunk of request) {
    rawBody += chunk;

    if (rawBody.length > 1024 * 1024) {
      const error = new Error('Request body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
  }

  if (rawBody.trim() === '') {
    return {};
  }

  return JSON.parse(rawBody);
}

async function readTextRequest(request) {
  let rawBody = '';

  for await (const chunk of request) {
    rawBody += chunk;

    if (rawBody.length > 1024 * 1024) {
      const error = new Error('Request body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
  }

  return rawBody;
}

async function readOAuthBody(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (contentType.includes('application/json')) {
    return readJsonRequest(request);
  }

  const rawBody = await readTextRequest(request);
  return Object.fromEntries(new URLSearchParams(rawBody));
}

function htmlResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}

function redirectResponse(response, location) {
  response.writeHead(302, { location });
  response.end();
}

function oauthErrorResponse(response, statusCode, code, message) {
  jsonResponse(response, statusCode, {
    error: code,
    error_description: message
  });
}

function mcpResult(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

function mcpError(id, code, message, data = undefined) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {})
    }
  };
}

function mcpJsonContent(json) {
  return {
    structuredContent: json,
    content: [
      {
        type: 'text',
        text: JSON.stringify(json)
      }
    ]
  };
}

function toolArgs(message) {
  return message?.params?.arguments && typeof message.params.arguments === 'object'
    ? message.params.arguments
    : {};
}

function toolExceptionToMcpError(id, error) {
  const codeByReason = {
    VALIDATION_FAILED: -32602,
    NOT_FOUND: -32002,
    FORBIDDEN: -32003,
    UPSTREAM_NOT_CONFIGURED: -32005,
    UPSTREAM_ERROR: -32007,
    UNSAFE_CONTENT: -32006,
    NOT_IMPLEMENTED: -32004
  };
  const reason = error.code ?? 'TOOL_FAILED';
  const code = codeByReason[reason] ?? -32000;

  return mcpError(id, code, error.message || 'MCP tool failed.', {
    reason,
    ...(error.data && typeof error.data === 'object' ? error.data : {})
  });
}

const BASE_TOOL_NAMES = new Set([
  'slimweb_auth_status',
  'slimweb_sites_list',
  'slimweb_site_select'
]);

const TOOL_PERMISSION_RULES = {
  slimweb_themes_list: ['page_management', 'page_management_templates'],
  slimweb_themes_create_from_default: ['page_management', 'page_management_templates'],
  slimweb_themes_delete: ['page_management', 'page_management_templates'],
  slimweb_theme_shell_get_context: ['page_management', 'page_management_templates'],
  slimweb_themes_update_root_elements: ['page_management', 'page_management_templates'],
  slimweb_theme_style_profile_get: ['page_management', 'page_management_templates'],
  slimweb_theme_style_profile_upsert: ['page_management', 'page_management_templates'],
  slimweb_theme_style_profile_append_request: ['page_management', 'page_management_templates'],
  slimweb_site_readiness_get: [],
  slimweb_seo_settings_get: ['seo_settings'],
  slimweb_seo_settings_update: ['seo_settings'],
  slimweb_integration_settings_get: ['integration_settings'],
  slimweb_integration_settings_update: ['integration_settings'],
  slimweb_mail_templates_get: ['mail_settings'],
  slimweb_mail_templates_update: ['mail_settings'],
  slimweb_mail_layout_get: ['mail_settings'],
  slimweb_mail_layout_update: ['mail_settings'],
  slimweb_payment_logistics_get: ['payment_logistics'],
  slimweb_payment_logistics_update: ['payment_logistics'],
  slimweb_orders_list: ['orders_management'],
  slimweb_orders_pending_list: ['orders_management'],
  slimweb_orders_get: ['orders_management'],
  slimweb_orders_create_logistics: ['orders_management'],
  slimweb_orders_mark_shipped: ['orders_management'],
  slimweb_returns_pending_list: ['orders_management'],
  slimweb_returns_create_logistics: ['orders_management'],
  slimweb_returns_cancel: ['orders_management'],
  slimweb_returns_complete: ['orders_management'],
  slimweb_refunds_complete: ['orders_management'],
  slimweb_refunds_create: ['orders_management'],
  slimweb_dashboard_summary: [],
  slimweb_settings_get: ['basic_settings'],
  slimweb_settings_update: ['basic_settings'],
  slimweb_admins_list: ['system_admin'],
  slimweb_admins_upsert: ['system_admin'],
  slimweb_admins_delete: ['system_admin'],
  slimweb_external_assets_list: ['page_management', 'page_management_external_assets'],
  slimweb_external_assets_upsert: ['page_management', 'page_management_external_assets'],
  slimweb_external_assets_delete: ['page_management', 'page_management_external_assets'],
  slimweb_external_assets_reorder: ['page_management', 'page_management_external_assets'],
  slimweb_images_import_chatgpt_attachment: [],
  slimweb_uploads_create: [],
  slimweb_uploads_commit: [],
  slimweb_articles_list: ['article_management', 'article_list'],
  slimweb_articles_upsert: ['article_management', 'article_list'],
  slimweb_categories_list: ['product_management', 'product_management_categories'],
  slimweb_categories_upsert: ['product_management', 'product_management_categories'],
  slimweb_categories_delete: ['product_management', 'product_management_categories'],
  slimweb_nav_items_list: ['page_management', 'page_management_navbar'],
  slimweb_nav_items_upsert: ['page_management', 'page_management_navbar'],
  slimweb_nav_items_delete: ['page_management', 'page_management_navbar'],
  slimweb_products_list: ['product_management', 'product_management_products'],
  slimweb_products_get: ['product_management', 'product_management_products'],
  slimweb_products_upsert: ['product_management', 'product_management_products'],
  slimweb_products_delete: ['product_management', 'product_management_products'],
  slimweb_products_import_inspect: ['product_management', 'product_management_import'],
  slimweb_products_import_validate: ['product_management', 'product_management_import'],
  slimweb_products_import_commit: ['product_management', 'product_management_import'],
  slimweb_coupon_templates_list: ['discount_management', 'coupon_templates'],
  slimweb_coupon_templates_upsert: ['discount_management', 'coupon_templates'],
  slimweb_members_coupons_issue: ['discount_management', 'coupon_templates'],
  slimweb_members_list: ['member_management', 'member_list'],
  slimweb_members_get: ['member_management', 'member_list'],
  slimweb_discount_codes_list: ['discount_management', 'discount_codes'],
  slimweb_discount_codes_upsert: ['discount_management', 'discount_codes'],
  slimweb_member_tiers_list: ['member_management', 'member_tiers'],
  slimweb_member_tiers_upsert: ['member_management', 'member_tiers'],
  slimweb_threshold_gifts_list: ['discount_management', 'threshold_gifts'],
  slimweb_threshold_gifts_upsert: ['discount_management', 'threshold_gifts'],
  slimweb_product_add_ons_list: ['product_management', 'product_management_add_ons'],
  slimweb_product_add_ons_upsert: ['product_management', 'product_management_add_ons'],
  slimweb_faqs_list: ['faq_management'],
  slimweb_faqs_upsert: ['faq_management'],
  slimweb_customer_service_logs_list: ['customer_service_logs'],
  slimweb_customer_service_settings_get: ['ai_management', 'ai_customer_service'],
  slimweb_customer_service_settings_update: ['ai_management', 'ai_customer_service'],
  slimweb_exports_create: ['system_admin'],
  slimweb_audit_list: ['system_admin'],
  slimweb_assets_upload: [],
  slimweb_pages_get_home_content: ['page_management', 'page_management_pages'],
  slimweb_pages_update_home_content: ['page_management', 'page_management_pages'],
  slimweb_pages_upsert: ['page_management', 'page_management_pages'],
  slimweb_preview_get_page_url: ['page_management', 'page_management_pages'],
  slimweb_pages_delete: ['page_management', 'page_management_pages']
};

function permissionSet(permissions) {
  return new Set(Array.isArray(permissions) ? permissions.filter((permission) => typeof permission === 'string') : []);
}

function hasAnyPermission(permissions, required) {
  if (required.length === 0) {
    return true;
  }

  const available = permissionSet(permissions);
  return required.some((permission) => available.has(permission) || available.has('system_admin'));
}

function sessionIdentity(session) {
  return {
    account_id: session.account_id ?? null,
    email: session.email,
    name: session.name,
    google_id: session.google_id,
    site_id: session.site_id ?? null
  };
}

async function toolsForSession(session, context) {
  if (!session) {
    return MCP_TOOLS;
  }

  const identity = sessionIdentity(session);
  const sites = await context.accountRepository.listSitesForAdminIdentity(identity);
  const scopedSites = identity.site_id
    ? sites.filter((site) => String(site.site_id ?? site.id) === String(identity.site_id))
    : sites;
  const union = new Set();

  for (const site of scopedSites) {
    for (const permission of site.permissions ?? []) {
      union.add(permission);
    }
  }

  return MCP_TOOLS.filter((tool) => {
    if (BASE_TOOL_NAMES.has(tool.name)) {
      return true;
    }

    const required = TOOL_PERMISSION_RULES[tool.name] ?? [];
    return hasAnyPermission(Array.from(union), required);
  });
}

function forbiddenError(message) {
  const error = new Error(message);
  error.code = 'FORBIDDEN';
  return error;
}

async function actorForTool(session, name, args, context) {
  if (BASE_TOOL_NAMES.has(name)) {
    return sessionIdentity(session);
  }

  const identity = sessionIdentity(session);
  const actor = typeof context.accountRepository.resolveAdminSiteForIdentity === 'function'
    ? await context.accountRepository.resolveAdminSiteForIdentity(identity, args)
    : {
        ...identity,
        ...(await context.accountRepository.listSitesForAdminIdentity(identity))
          .find((site) => String(site.site_id ?? site.id) === String(args.site_id))
      };

  if (!hasAnyPermission(actor.permissions, ['backend_ai_assistant'])) {
    throw forbiddenError('This web admin does not have backend AI assistant permission.');
  }

  const required = TOOL_PERMISSION_RULES[name] ?? [];
  if (!hasAnyPermission(actor.permissions, required)) {
    throw forbiddenError(`This web admin does not have permission to use ${name}.`);
  }

  return actor;
}

async function toolResultForCall(message, request, context) {
  const name = message?.params?.name;
  const session = verifySessionToken(readSessionToken(request), context.sessionSecret);

  if (!session) {
    return mcpError(message?.id ?? null, -32001, 'Authentication required.', {
      reason: 'AUTH_REQUIRED'
    });
  }

  switch (name) {
    case 'slimweb_auth_status':
      return mcpResult(message.id ?? null, mcpJsonContent({
        authenticated: true,
        admin: {
          id: session.account_id,
          email: session.email,
          name: session.name,
          google_id: session.google_id
        },
        account: {
          id: session.account_id,
          email: session.email,
          name: session.name,
          google_id: session.google_id
        }
      }));

    case 'slimweb_sites_list': {
      const sites = await context.accountRepository.listSitesForAdminIdentity(sessionIdentity(session));

      return mcpResult(message.id ?? null, mcpJsonContent({
        google_email: session.email,
        requires_selection: sites.length > 1,
        selection_instruction: sites.length > 1
          ? 'Multiple sites are available. Ask the user which site to operate before calling site-scoped tools. Do not guess.'
          : 'Use the single available site_id for site-scoped tools.',
        sites
      }));
    }

    case 'slimweb_site_select': {
      try {
        const result = await context.accountRepository.selectSiteForAdminIdentity(sessionIdentity(session), toolArgs(message));

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_themes_list': {
      try {
        const result = await context.accountRepository.listThemesForAccountSite(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_themes_create_from_default': {
      try {
        const result = await context.accountRepository.createThemeFromDefault(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_themes_delete': {
      try {
        const result = await context.accountRepository.deleteTheme(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_theme_shell_get_context': {
      try {
        const result = await context.accountRepository.getThemeShellContext(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_themes_update_root_elements': {
      try {
        const result = await context.accountRepository.updateThemeRootElements(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_theme_style_profile_get': {
      try {
        const result = await context.accountRepository.getThemeStyleProfile(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_theme_style_profile_upsert': {
      try {
        const result = await context.accountRepository.upsertThemeStyleProfile(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_theme_style_profile_append_request': {
      try {
        const result = await context.accountRepository.appendThemeStyleProfileRequest(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_site_readiness_get': {
      try {
        const result = await context.accountRepository.getSiteReadiness(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_seo_settings_get': {
      try {
        const result = await context.accountRepository.getSeoSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_seo_settings_update': {
      try {
        const result = await context.accountRepository.updateSeoSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_integration_settings_get': {
      try {
        const result = await context.accountRepository.getIntegrationSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_integration_settings_update': {
      try {
        const result = await context.accountRepository.updateIntegrationSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_mail_templates_get': {
      try {
        const result = await context.accountRepository.getMailTemplates(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_mail_templates_update': {
      try {
        const result = await context.accountRepository.updateMailTemplates(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_mail_layout_get': {
      try {
        const result = await context.accountRepository.getMailLayout(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_mail_layout_update': {
      try {
        const result = await context.accountRepository.updateMailLayout(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_payment_logistics_get': {
      try {
        const result = await context.accountRepository.getPaymentLogisticsSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_payment_logistics_update': {
      try {
        const result = await context.accountRepository.updatePaymentLogisticsSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_orders_list': {
      try {
        const result = await context.accountRepository.listOrders(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_orders_pending_list': {
      try {
        const result = await context.accountRepository.listPendingOrders(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_orders_get': {
      try {
        const result = await context.accountRepository.getOrder(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_orders_create_logistics': {
      try {
        const result = await context.accountRepository.createOrderLogistics(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_orders_mark_shipped': {
      try {
        const result = await context.accountRepository.markOrderShipped(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_returns_pending_list': {
      try {
        const result = await context.accountRepository.listPendingReturns(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_returns_create_logistics': {
      try {
        const result = await context.accountRepository.createReturnLogistics(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_returns_cancel': {
      try {
        const result = await context.accountRepository.cancelReturn(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_returns_complete': {
      try {
        const result = await context.accountRepository.completeReturn(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_refunds_complete': {
      try {
        const result = await context.accountRepository.completeRefund(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_refunds_create': {
      try {
        const result = await context.accountRepository.createRefund(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_dashboard_summary': {
      try {
        const result = await context.accountRepository.getDashboardSummary(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_settings_get': {
      try {
        const result = await context.accountRepository.getBasicSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_settings_update': {
      try {
        const result = await context.accountRepository.updateBasicSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_admins_list': {
      try {
        const result = await context.accountRepository.listAdmins(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_admins_upsert': {
      try {
        const result = await context.accountRepository.upsertAdmin(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_admins_delete': {
      try {
        const result = await context.accountRepository.deleteAdmin(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_external_assets_list': {
      try {
        const result = await context.accountRepository.listExternalAssets(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_external_assets_upsert': {
      try {
        const result = await context.accountRepository.upsertExternalAsset(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_external_assets_delete': {
      try {
        const result = await context.accountRepository.deleteExternalAsset(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_external_assets_reorder': {
      try {
        const result = await context.accountRepository.reorderExternalAssets(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_uploads_create': {
      try {
        const result = await context.accountRepository.createUpload(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_images_import_chatgpt_attachment': {
      try {
        const result = await context.accountRepository.importChatGptAttachment(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_uploads_commit': {
      try {
        const result = await context.accountRepository.commitUpload(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_articles_list': {
      try {
        const result = await context.accountRepository.listArticles(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_articles_upsert': {
      try {
        const result = await context.accountRepository.upsertArticle(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_categories_list': {
      try {
        const result = await context.accountRepository.listCategories(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_categories_upsert': {
      try {
        const result = await context.accountRepository.upsertCategory(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_categories_delete': {
      try {
        const result = await context.accountRepository.deleteCategory(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_nav_items_list': {
      try {
        const result = await context.accountRepository.listNavItems(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_nav_items_upsert': {
      try {
        const result = await context.accountRepository.upsertNavItem(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_nav_items_delete': {
      try {
        const result = await context.accountRepository.deleteNavItem(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_products_list': {
      try {
        const result = await context.accountRepository.listProducts(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_products_get': {
      try {
        const result = await context.accountRepository.getProduct(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_products_upsert': {
      try {
        const result = await context.accountRepository.upsertProduct(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_products_delete': {
      try {
        const result = await context.accountRepository.deleteProduct(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_products_import_inspect': {
      try {
        const result = await context.accountRepository.inspectProductImport(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_products_import_validate': {
      try {
        const result = await context.accountRepository.validateProductImport(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_products_import_commit': {
      try {
        const result = await context.accountRepository.commitProductImport(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_coupon_templates_list': {
      try {
        const result = await context.accountRepository.listCouponTemplates(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_coupon_templates_upsert': {
      try {
        const result = await context.accountRepository.upsertCouponTemplate(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

	    case 'slimweb_members_coupons_issue': {
	      try {
	        const result = await context.accountRepository.issueMemberCoupon(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );
	
	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_members_list': {
	      try {
	        const result = await context.accountRepository.listMembers(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_members_get': {
	      try {
	        const result = await context.accountRepository.getMember(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_discount_codes_list': {
	      try {
	        const result = await context.accountRepository.listDiscountCodes(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_discount_codes_upsert': {
	      try {
	        const result = await context.accountRepository.upsertDiscountCode(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_member_tiers_list': {
	      try {
	        const result = await context.accountRepository.listMemberTiers(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_member_tiers_upsert': {
	      try {
	        const result = await context.accountRepository.upsertMemberTier(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_threshold_gifts_list': {
	      try {
	        const result = await context.accountRepository.listThresholdGifts(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_threshold_gifts_upsert': {
	      try {
	        const result = await context.accountRepository.upsertThresholdGift(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_product_add_ons_list': {
	      try {
	        const result = await context.accountRepository.listProductAddOns(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_product_add_ons_upsert': {
	      try {
	        const result = await context.accountRepository.upsertProductAddOn(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_faqs_list': {
	      try {
	        const result = await context.accountRepository.listFaqs(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_faqs_upsert': {
	      try {
	        const result = await context.accountRepository.upsertFaq(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_customer_service_logs_list': {
	      try {
	        const result = await context.accountRepository.listCustomerServiceLogs(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_customer_service_settings_get': {
	      try {
	        const result = await context.accountRepository.getCustomerServiceSettings(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_customer_service_settings_update': {
	      try {
	        const result = await context.accountRepository.updateCustomerServiceSettings(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_exports_create': {
	      try {
	        const result = await context.accountRepository.createExport(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }

	    case 'slimweb_audit_list': {
	      try {
	        const result = await context.accountRepository.listAuditLogs(
	          await actorForTool(session, name, toolArgs(message), context),
	          toolArgs(message)
	        );

	        return mcpResult(message.id ?? null, mcpJsonContent(result));
	      } catch (error) {
	        return toolExceptionToMcpError(message?.id ?? null, error);
	      }
	    }
	
	    case 'slimweb_assets_upload': {
      try {
        const result = await context.accountRepository.uploadAsset(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_get_home_content': {
      try {
        const result = await context.accountRepository.getHomeContent(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_update_home_content': {
      try {
        const result = await context.accountRepository.updateHomeContent(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_upsert': {
      try {
        const result = await context.accountRepository.upsertPage(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_preview_get_page_url': {
      try {
        const result = await context.accountRepository.getPagePreviewUrl(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_delete': {
      try {
        const result = await context.accountRepository.deletePage(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    default:
      return mcpError(message?.id ?? null, -32601, `Unknown MCP tool: ${name ?? 'undefined'}`);
  }
}

async function handleMcpMessage(message, request, context) {
  const id = message?.id ?? null;

  switch (message?.method) {
    case 'initialize':
      return mcpResult(id, {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: SERVICE_NAME,
          version: SERVICE_VERSION
        }
      });

    case 'tools/list':
      return mcpResult(id, {
        tools: await toolsForSession(
          verifySessionToken(readSessionToken(request), context.sessionSecret),
          context
        )
      });

    case 'tools/call':
      return toolResultForCall(message, request, context);

    default:
      return mcpError(id, -32601, `Unknown MCP method: ${message?.method ?? 'undefined'}`);
  }
}

async function handleMcp(request, response, context) {
  if (request.method !== 'POST') {
    methodNotAllowed(response);
    return;
  }

  try {
    const message = await readJsonRequest(request);
    if (message?.method === 'tools/call' && !verifySessionToken(readSessionToken(request), context.sessionSecret)) {
      mcpAuthRequiredResponse(request, response, context);
      return;
    }

    jsonResponse(response, 200, await handleMcpMessage(message, request, context));
  } catch (error) {
    const code = error.code === 'BODY_TOO_LARGE' ? -32000 : -32700;
    const message = error.code === 'BODY_TOO_LARGE' ? error.message : 'Invalid JSON request body';

    jsonResponse(response, 200, mcpError(null, code, message));
  }
}

function requestBaseUrl(request, context) {
  if (context.publicBaseUrl) {
    return context.publicBaseUrl.replace(/\/+$/, '');
  }

  const protocol = request.headers['x-forwarded-proto'] ?? 'https';
  const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';

  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function sameOriginNextPath(next) {
  if (!next || typeof next !== 'string') {
    return '/auth/success';
  }

  try {
    if (next.startsWith('/')) {
      const parsed = new URL(next, 'https://local.invalid');
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    const parsed = new URL(next);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/auth/success';
  }
}

function oauthAuthorizationServerMetadata(baseUrl) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['mcp'],
    service_documentation: 'https://slimweb.tw'
  };
}

function oauthProtectedResourceMetadata(baseUrl) {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header']
  };
}

function mcpAuthRequiredResponse(request, response, context) {
  const baseUrl = requestBaseUrl(request, context);
  const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource/mcp`;
  const body = {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32001,
      message: 'Authentication required.',
      data: {
        reason: 'AUTH_REQUIRED',
        resource_metadata: resourceMetadataUrl
      }
    }
  };

  jsonResponse(response, 401, body, {
    'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
    'cache-control': 'no-store'
  });
}

function loginPage(context, nextPath = '/auth/success') {
  const clientId = context.googleClientId;
  const next = sameOriginNextPath(nextPath);

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SlimWeb MCP 登入</title>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
  <main style="max-width: 420px; margin: 64px auto; font-family: system-ui, sans-serif;">
    <h1>SlimWeb MCP 登入</h1>
    <p>請使用已被授權為 SlimWeb 後台管理員，且具備後台 AI 助理權限的 Google 帳號登入。</p>
    <div id="google-signin"></div>
  </main>
  <script>
    function handleCredentialResponse(response) {
      fetch('/auth/google', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      }).then(async function(result) {
        if (!result.ok) {
          const payload = await result.json().catch(function() { return {}; });
          const message = payload.error && payload.error.message ? payload.error.message : '登入失敗，請重新再試。';
          throw new Error(message);
        }
        window.location.href = ${JSON.stringify(next)};
      }).catch(function(error) {
        alert('登入失敗：' + error.message);
      });
    }

    window.onload = function() {
      google.accounts.id.initialize({
        client_id: '${clientId}',
        callback: handleCredentialResponse
      });
      google.accounts.id.renderButton(document.getElementById('google-signin'), {
        theme: 'outline',
        size: 'large'
      });
    };
  </script>
</body>
</html>`;
}

function createOAuthCode(session, params, context) {
  const now = Math.floor(Date.now() / 1000);

  return createSignedToken({
    typ: 'oauth_code',
    account_id: session.account_id,
    email: session.email,
    name: session.name,
    google_id: session.google_id,
    client_id: params.get('client_id'),
    redirect_uri: params.get('redirect_uri'),
    scope: params.get('scope') || 'mcp',
    code_challenge: params.get('code_challenge') || '',
    code_challenge_method: params.get('code_challenge_method') || '',
    iat: now,
    exp: now + OAUTH_CODE_TTL_SECONDS
  }, context.sessionSecret);
}

function verifyOAuthCode(code, context) {
  const payload = verifySignedToken(code, context.sessionSecret);
  const now = Math.floor(Date.now() / 1000);

  if (!payload || payload.typ !== 'oauth_code' || !payload.exp || payload.exp < now) {
    return null;
  }

  return payload;
}

function verifyPkce(payload, codeVerifier) {
  if (!payload.code_challenge) {
    return true;
  }

  if (!codeVerifier) {
    return false;
  }

  if (payload.code_challenge_method === 'plain') {
    return codeVerifier === payload.code_challenge;
  }

  const digest = createHash('sha256').update(codeVerifier).digest('base64url');
  return digest === payload.code_challenge;
}

function handleOAuthProtectedResource(request, response, context) {
  jsonResponse(response, 200, oauthProtectedResourceMetadata(requestBaseUrl(request, context)));
}

function handleOAuthAuthorizationServer(request, response, context) {
  jsonResponse(response, 200, oauthAuthorizationServerMetadata(requestBaseUrl(request, context)));
}

async function handleOAuthRegister(request, response) {
  if (request.method !== 'POST') {
    methodNotAllowed(response);
    return;
  }

  const body = await readOAuthBody(request);
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

  jsonResponse(response, 201, {
    client_id: `swmcp_${randomBytes(16).toString('hex')}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: body.client_name || 'ChatGPT',
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  });
}

function handleOAuthAuthorize(request, response, context) {
  if (request.method !== 'GET') {
    methodNotAllowed(response);
    return;
  }

  const authorizeUrl = new URL(request.url, 'http://localhost');
  const params = authorizeUrl.searchParams;
  const redirectUri = params.get('redirect_uri');
  const state = params.get('state');
  const clientId = params.get('client_id');

  if (params.get('response_type') !== 'code' || !clientId || !redirectUri) {
    oauthErrorResponse(response, 400, 'invalid_request', 'response_type=code, client_id, and redirect_uri are required.');
    return;
  }

  const session = verifySessionToken(readSessionToken(request), context.sessionSecret);
  if (!session) {
    redirectResponse(response, `/auth/login?next=${encodeURIComponent(`${authorizeUrl.pathname}${authorizeUrl.search}`)}`);
    return;
  }

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', createOAuthCode(session, params, context));
  if (state) {
    callbackUrl.searchParams.set('state', state);
  }

  redirectResponse(response, callbackUrl.toString());
}

async function handleOAuthToken(request, response, context) {
  if (request.method !== 'POST') {
    methodNotAllowed(response);
    return;
  }

  const body = await readOAuthBody(request);

  if (body.grant_type !== 'authorization_code') {
    oauthErrorResponse(response, 400, 'unsupported_grant_type', 'Only authorization_code is supported.');
    return;
  }

  const payload = verifyOAuthCode(body.code, context);
  if (!payload) {
    oauthErrorResponse(response, 400, 'invalid_grant', 'Authorization code is invalid or expired.');
    return;
  }

  if (body.client_id && body.client_id !== payload.client_id) {
    oauthErrorResponse(response, 400, 'invalid_grant', 'client_id does not match authorization code.');
    return;
  }

  if (body.redirect_uri !== payload.redirect_uri) {
    oauthErrorResponse(response, 400, 'invalid_grant', 'redirect_uri does not match authorization code.');
    return;
  }

  if (!verifyPkce(payload, body.code_verifier)) {
    oauthErrorResponse(response, 400, 'invalid_grant', 'PKCE verification failed.');
    return;
  }

  const accessToken = createSessionToken({
    id: payload.account_id,
    email: payload.email,
    name: payload.name,
    google_id: payload.google_id
  }, context.sessionSecret);

  jsonResponse(response, 200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: SESSION_TTL_SECONDS,
    scope: payload.scope || 'mcp'
  }, {
    'cache-control': 'no-store',
    pragma: 'no-cache'
  });
}

async function handleGoogleLogin(request, response, context) {
  if (request.method !== 'POST') {
    methodNotAllowed(response);
    return;
  }

  try {
    const body = await readJsonRequest(request);
    const profile = await context.googleVerifier.verify(body.credential);
    const sites = await context.accountRepository.listAdminSitesForGoogleProfile(profile);

    if (sites.length === 0) {
      const error = new Error('這個 Google 帳號沒有可使用 MCP 的後台 AI 助理權限。');
      error.code = 'FORBIDDEN';
      throw error;
    }

    const token = createSessionToken({
      email: profile.email,
      name: profile.name,
      google_id: profile.sub
    }, context.sessionSecret);

    jsonResponse(response, 200, {
      ok: true,
      admin: {
        email: profile.email,
        name: profile.name,
        google_id: profile.sub
      },
      sites,
      session: {
        token_type: 'Bearer',
        access_token: token
      }
    }, {
      'set-cookie': sessionCookie(token, context.secureCookies)
    });
  } catch (error) {
    console.warn('mcp_google_login_failed', {
      code: error.code ?? 'LOGIN_FAILED',
      message: error.message
    });

    jsonResponse(response, 401, {
      ok: false,
      error: {
        code: error.code ?? 'LOGIN_FAILED',
        message: error.message
      }
    });
  }
}

function handleAuthSuccess(request, response, context) {
  const token = readSessionToken(request);
  const session = verifySessionToken(token, context.sessionSecret);

  if (!session) {
    response.writeHead(302, { location: '/auth/login' });
    response.end();
    return;
  }

  htmlResponse(response, 200, `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SlimWeb MCP 已登入</title>
</head>
<body>
  <main style="max-width: 760px; margin: 64px auto; font-family: system-ui, sans-serif; line-height: 1.6;">
    <h1>已登入 SlimWeb MCP</h1>
    <p>帳號：${escapeHtml(session.email)}</p>
    <p>OAuth 授權已完成。支援 remote MCP OAuth 的 AI Client 會自動取得連線憑證，不需要手動複製 token。</p>
    <p style="margin-top: 24px;">MCP URL：</p>
    <pre style="padding: 12px; background: #f3f4f6; overflow:auto;">${escapeHtml(context.publicBaseUrl || '')}/mcp</pre>
    <p>接下來可以回到 AI Client 繼續連線 SlimWeb MCP。</p>
  </main>
</body>
</html>`);
}

function handleServiceInfo(response) {
  jsonResponse(response, 200, {
    ok: true,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: 'ready'
  });
}

function createDefaultContext(options = {}) {
  return {
    googleClientId: options.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '27587628711-upin8ch154kqrl88k41978q660oc0pbg.apps.googleusercontent.com',
    googleVerifier: options.googleVerifier ?? new GoogleIdentityVerifier(options),
    accountRepository: options.accountRepository ?? new WeblessAccountRepository(),
    sessionSecret: options.sessionSecret ?? process.env.MCP_SESSION_SECRET,
    publicBaseUrl: options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? '',
    secureCookies: options.secureCookies ?? process.env.NODE_ENV === 'production'
  };
}

export function createRequestHandler(options = {}) {
  const context = createDefaultContext(options);

  return async function requestHandler(request, response) {
    const url = new URL(request.url, 'http://localhost');

    if (url.pathname === '/' || url.pathname === '/healthz' || url.pathname === '/readyz') {
      if (request.method !== 'GET') {
        methodNotAllowed(response);
        return;
      }

      handleServiceInfo(response);
      return;
    }

    if (url.pathname === '/auth/login') {
      if (request.method !== 'GET') {
        methodNotAllowed(response);
        return;
      }

      htmlResponse(response, 200, loginPage(context, url.searchParams.get('next')));
      return;
    }

    if (url.pathname === '/auth/google') {
      await handleGoogleLogin(request, response, context);
      return;
    }

    if (url.pathname === '/auth/success') {
      if (request.method !== 'GET') {
        methodNotAllowed(response);
        return;
      }

      handleAuthSuccess(request, response, context);
      return;
    }

    if (
      url.pathname === '/.well-known/oauth-protected-resource'
      || url.pathname === '/.well-known/oauth-protected-resource/mcp'
      || url.pathname === '/mcp/.well-known/oauth-protected-resource'
    ) {
      if (request.method !== 'GET') {
        methodNotAllowed(response);
        return;
      }

      handleOAuthProtectedResource(request, response, context);
      return;
    }

    if (
      url.pathname === '/.well-known/oauth-authorization-server'
      || url.pathname === '/.well-known/oauth-authorization-server/mcp'
      || url.pathname === '/mcp/.well-known/oauth-authorization-server'
      || url.pathname === '/.well-known/openid-configuration'
      || url.pathname === '/.well-known/openid-configuration/mcp'
      || url.pathname === '/mcp/.well-known/openid-configuration'
    ) {
      if (request.method !== 'GET') {
        methodNotAllowed(response);
        return;
      }

      handleOAuthAuthorizationServer(request, response, context);
      return;
    }

    if (url.pathname === '/oauth/register') {
      await handleOAuthRegister(request, response);
      return;
    }

    if (url.pathname === '/oauth/authorize') {
      handleOAuthAuthorize(request, response, context);
      return;
    }

    if (url.pathname === '/oauth/token') {
      await handleOAuthToken(request, response, context);
      return;
    }

    if (url.pathname === '/mcp') {
      await handleMcp(request, response, context);
      return;
    }

    notFound(response);
  };
}
