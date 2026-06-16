import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

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
const CHATGPT_MISSING_IMAGE_GUIDANCE = 'In ChatGPT Remote MCP, if a page or article request needs an image but no usable attached image or directly downloadable image URL is available, stop the task and ask the user to paste or re-upload the image before continuing.';
const MCP_SERVER_GUIDELINES = [
'Before calling any SlimWeb MCP tool, first call SlimWeb.slimweb_sites_list to obtain valid site_code values and site names.',
'If SlimWeb.slimweb_sites_list returns more than one site, stop the task and list the available site names for the user to choose from.',
'Never use a site_code that does not appear in the SlimWeb.slimweb_sites_list result. Do not ask the user for numeric site_id values.',
'Distinguish page and article from user intent only; do not infer from history.',
'Treat themes as the base styling layer for every page, including the homepage.',
'Image rules: if a task needs image assets, obtain usable image URLs or media paths before creating or editing pages or articles. Publicly reachable image URLs may be used directly. Clients that can read local bytes and upload must use slimweb_uploads_create plus slimweb_uploads_commit. Clients that cannot upload bytes but have a ChatGPT conversation image attachment must use slimweb_images_import_chatgpt_attachment. If the client cannot upload and the user has not provided an attachment or image URL, stop and ask the user to paste or upload the image. When generating images, use the current design context colors and direction. If an image is AI-generated in a client that cannot upload it, stop and ask the user to paste the generated image back into the conversation.',
'Content SEO/AEO/GEO rule: after creating or editing a page or article, generate content-level SEO/AEO/GEO metadata from the actual title, body, topic, and images, then call slimweb_content_seo_update with workflow_context page_create, page_update, article_create, or article_update. Skip this only when the user explicitly says not to update SEO. Never use slimweb_content_seo_update as a standalone tool, and never use slimweb_seo_settings_update for single-page or single-article SEO.',
'Page create flow: require a title, call slimweb_pages_check_title, stop on duplicate titles including fixed-page English aliases, call slimweb_design_context_get, follow the image rules for any page images, design from the site summary, colors, and framework, build HTML with custom CSS and visual JavaScript when needed, call slimweb_pages_create, call slimweb_content_seo_update with workflow_context page_create unless the user explicitly opted out of SEO, and return the page URL; use slimweb_preview_get_page_url for preview verification.',
'Page edit flow: require page_name, call slimweb_pages_get_content, stop if the custom page does not exist, follow the image rules for added or replacement images, call slimweb_design_context_get, modify HTML from the current content and design context, call slimweb_pages_update, call slimweb_content_seo_update with workflow_context page_update unless the user explicitly opted out of SEO, and return the page URL; use slimweb_preview_get_page_url for preview verification.',
'Article create flow: require a title, call slimweb_articles_check_title, stop on duplicate titles, call slimweb_design_context_get, require a 16:9 cover image and follow the image rules, generate the cover from article title or content if the user gave no image direction, follow the image rules for optional content images, do not repeat the article title as an h1 in content_html, call slimweb_articles_create, call slimweb_content_seo_update with workflow_context article_create unless the user explicitly opted out of SEO, and return the article URL.',
'Article edit flow: require article_id or an article title; if the user provides a title, call slimweb_articles_list and match the target title to an article_id, stopping if none or multiple similar matches are found. Call slimweb_articles_get_content, stop if the article does not exist, call slimweb_design_context_get, follow the image rules for added or replacement cover/content images, modify content_html from the current article and design context, call slimweb_articles_check_title before changing the title and stop on duplicates, do not repeat the article title as an h1, call slimweb_articles_update, call slimweb_content_seo_update with workflow_context article_update unless the user explicitly opted out of SEO, and return the article URL.',
'Article delete flow: no SlimWeb MCP article deletion tool is currently available; do not invent a tool or delete through another tool, and tell the user article deletion is not supported by the current MCP.',
'Poster create flow: when the user asks to draw or create a product poster, call slimweb_posters_create with up to five product_names, aspect_ratio defaulting to 9:16 unless the user asks for 16:9 or 1:1, and drawing_prompt containing only the user-specified promotion copy and visual requirements. Do not invent discounts, gifts, deadlines, event dates, prices, warranty claims, or campaign conditions. The tool fuzzy-searches products; if any product name has multiple matches, stop and show the returned candidates for user confirmation. Poster images are generated by Webless backend AI using the site logo and product primary images as image-edit references when available, plus product summary/description as reference-only context; generated posters are stored as media assets and returned with public_url and media_path for durable reuse.',
'Theme create flow: require a name, call slimweb_themes_list to check custom theme duplicates, stop on an exact duplicate, call slimweb_site_theme_mode_get and optionally slimweb_site_theme_mode_update for dark/neon/high-contrast requests, call slimweb_themes_create_from_default, call slimweb_theme_shell_get_context, call slimweb_design_context_get, design navbar/footer/root CSS/body background/overall visual atmosphere from user intent, site colors, shell reference, and framework, call slimweb_themes_update_root_elements without changing page body content, call slimweb_theme_style_profile_upsert, return the theme name and theme_id, and only call slimweb_themes_activate when the user explicitly asks to activate it.',
'Theme edit flow: require theme_id or a theme name, call slimweb_themes_list to find the target custom theme and stop if none or multiple possible targets are found, call slimweb_theme_style_profile_get, call slimweb_theme_shell_get_context, call slimweb_design_context_get, call slimweb_site_theme_mode_get and optionally slimweb_site_theme_mode_update for dark/neon/high-contrast requests, modify navbar/footer/root CSS/body background/overall visual atmosphere from user intent, existing style profile, site colors, shell reference, and framework, call slimweb_themes_update_root_elements without changing page body content, call slimweb_theme_style_profile_upsert, call slimweb_theme_style_profile_append_request, return the theme name and theme_id, and only call slimweb_themes_activate when the user explicitly asks to activate it.',
'Shared email layout edit flow: there is no create flow for the shared email layout. Call slimweb_mail_layout_get first, modify the returned current/default HTML rather than rewriting from scratch, preserve {content}, and always preserve existing placeholders such as {site_name}, {site_url}, and {logo_url}. Use email-client-safe HTML only, follow image rules for public image URLs if needed, call slimweb_mail_layout_update, and tell the user the shared layout applies to every event email.',
'Event email content edit flow: call slimweb_mail_templates_get first and identify the exact trigger_event from user intent. Use slimweb_mail_templates_update to edit the event subject, content HTML, internal content layout, content images, or enabled state. Do not use event email content tools to change the shared email layout wrapper.',
'For visual verification after page creation or update, use slimweb_preview_get_page_url.'
].join(' ');
const MEMBER_EMAIL_PREVIEW_WIDGET_URI = 'ui://slimweb/member-email-preview.html';
const MEMBER_EMAIL_PREVIEW_WIDGET_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{margin:0;background:#0b0f14;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .wrap{padding:16px}
    .meta{display:grid;gap:8px;margin-bottom:14px;font-size:13px;color:#9ca3af}
    .subject{font-size:18px;font-weight:700;color:#f9fafb}
    .frame{background:#fff;border:1px solid #253041;border-radius:8px;overflow:hidden}
    iframe{width:100%;min-height:520px;border:0;background:#fff}
    .empty{padding:24px;border:1px solid #253041;border-radius:8px;color:#9ca3af}
  </style>
</head>
<body>
  <div class="wrap">
    <div id="meta" class="meta"></div>
    <div id="preview"></div>
  </div>
  <script>
    const data = window.openai?.toolOutput || window.openai?.structuredContent || {};
    const meta = document.getElementById('meta');
    const preview = document.getElementById('preview');
    const scope = data.recipient_summary?.scope === 'all_members' ? '所有會員' : '指定會員';
    meta.innerHTML = '<div class="subject"></div><div></div><div></div>';
    meta.children[0].textContent = data.subject || 'Email 預覽';
    meta.children[1].textContent = '收件範圍：' + scope + (data.recipient_summary?.count ? '（' + data.recipient_summary.count + ' 位）' : '');
    meta.children[2].textContent = data.bcc_contact_email ? 'BCC：' + data.bcc_contact_email : 'BCC：未設定聯絡 Email';
    if (data.preview_html) {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      frame.srcdoc = data.preview_html;
      const holder = document.createElement('div');
      holder.className = 'frame';
      holder.appendChild(frame);
      preview.appendChild(holder);
    } else {
      preview.innerHTML = '<div class="empty">尚無預覽內容。</div>';
    }
  </script>
</body>
</html>`;
const POSTER_PREVIEW_WIDGET_URI = 'ui://slimweb/poster-preview.html';
const POSTER_PREVIEW_WIDGET_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{margin:0;background:#111827;color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .wrap{padding:16px;display:grid;gap:12px}
    .meta{display:grid;gap:4px;color:#cbd5e1;font-size:13px}
    .title{font-size:18px;font-weight:700;color:#fff}
    .poster{display:grid;place-items:center;background:#020617;border:1px solid #334155;border-radius:8px;overflow:hidden;min-height:360px}
    img{display:block;max-width:100%;max-height:78vh;object-fit:contain}
    .empty{padding:24px;color:#94a3b8}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="meta">
      <div class="title">海報預覽</div>
      <div id="info"></div>
    </div>
    <div id="poster" class="poster"></div>
  </div>
  <script>
    function objectValue(value) {
      return value && typeof value === 'object' ? value : null;
    }
    function enqueueObjectValues(queue, candidate) {
      for (const value of Object.values(candidate)) {
        if (objectValue(value)) {
          queue.push(value);
        }
      }
    }
    function posterPayload(value) {
      const seen = new Set();
      const queue = [value];

      while (queue.length > 0) {
        const candidate = objectValue(queue.shift());
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);

        if (typeof candidate.image_url === 'string' && candidate.image_url !== '') {
          return candidate;
        }

        queue.push(
          candidate.structuredContent,
          candidate.toolOutput,
          candidate.toolResponse,
          candidate.toolResponseMetadata,
          candidate.call_tool_result,
          candidate.mcp_tool_result,
          candidate.result,
          candidate.params,
          candidate.globals
        );
        enqueueObjectValues(queue, candidate);
      }

      return null;
    }
    const info = document.getElementById('info');
    const poster = document.getElementById('poster');
    function readPayload(payload) {
      return posterPayload(payload) || posterPayload(window.openai) || posterPayload(window.openai?.toolOutput) || posterPayload(window.openai?.structuredContent) || posterPayload(window.openai?.toolResponseMetadata);
    }
    function render(payload) {
      const data = readPayload(payload);
      if (!data?.image_url) {
        poster.innerHTML = '<div class="empty">尚無海報資料。</div>';
        window.openai?.notifyIntrinsicHeight?.();
        return false;
      }

      const products = Array.isArray(data.products) ? data.products.map((item) => item.name).filter(Boolean).join('、') : '';
      info.textContent = [data.aspect_ratio ? '比例：' + data.aspect_ratio : '', products ? '商品：' + products : ''].filter(Boolean).join('　');
      poster.replaceChildren();
      const image = document.createElement('img');
      image.src = data.image_url;
      image.alt = '海報預覽';
      poster.appendChild(image);
      window.openai?.notifyIntrinsicHeight?.();
      return true;
    }
    render();
  </script>
</body>
</html>`;
const OAUTH_CODE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {}
};
const DEFAULT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: true
};
const SITE_CODE_SCHEMA = {
  type: 'string',
  description: 'Stable SlimWeb site code selected from slimweb_sites_list, such as swcb_zog0l7zlyp3lwmlc. Do not use numeric site_id.'
};

function publicInputSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const clone = structuredClone(schema);
  if (clone.properties?.site_id) {
    delete clone.properties.site_id;
    clone.properties.site_code = SITE_CODE_SCHEMA;
  }
  if (Array.isArray(clone.required)) {
    clone.required = clone.required.map((field) => field === 'site_id' ? 'site_code' : field);
  }

  return clone;
}

function publicTool(tool) {
  return {
    ...tool,
    inputSchema: publicInputSchema(tool.inputSchema),
    outputSchema: tool.outputSchema ?? DEFAULT_OUTPUT_SCHEMA
  };
}

function publicSiteSelectionPayload(site) {
  return {
    site_code: site.site_code ?? site.callback_code ?? null,
    name: site.name
  };
}
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
      search_field: {
        type: 'string',
        enum: ['order_no', 'buyer_name', 'buyer_phone', 'buyer_email', 'recipient_name', 'recipient_phone', 'product_name', 'date_range', 'amount_range', 'payment_incomplete']
      },
      search_value: { type: 'string' },
      fuzzy: { type: 'boolean' },
      date_from: { type: 'string' },
      date_to: { type: 'string' },
      amount_min: { type: 'integer' },
      amount_max: { type: 'integer' },
      logistics_status: {
        type: 'string',
        enum: ['pending'],
        description: 'Use pending for the admin pending-order button: payment is completed but logistics is not completed.'
      },
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

function orderProfitStatisticsInputSchema() {
  return {
    type: 'object',
    properties: {
      site_id: { type: 'integer' },
      date_from: {
        type: 'string',
        description: 'optional YYYY-MM-DD start date. Omit date_from and date_to to calculate all paid non-cancelled orders.'
      },
      date_to: {
        type: 'string',
        description: 'optional YYYY-MM-DD end date. For "this month", the AI should fill the first and last calendar date of the month.'
      }
    },
    required: ['site_id']
  };
}

const SIGNED_UPLOAD_RUNTIME_GUIDANCE = 'Before using signed image upload, the AI must identify its own runtime. Continue only when the runtime can both read the source image bytes and make outbound HTTPS PUT requests, such as Codex or Hermes with local/code execution access. In ChatGPT Remote MCP, conversation attachments, /mnt/data paths, and hidden attachment rewrite are not reliable for remote MCP tools; if no downloadable URL or accessible local file bytes are available, explain that this client cannot upload the image and ask the user to use Codex/Hermes or provide a directly downloadable image URL.';
const IMAGE_SOURCE_SCHEMA = {
  type: 'object',
  description: `Committed SlimWeb media source. First call slimweb_uploads_create, use a capable AI runtime to PUT the uploaded or generated image bytes to upload_url, then call slimweb_uploads_commit and pass the returned media_path here. If the user already provides a SlimWeb media URL like /media/sites/<site_id>/mcp-uploads/committed/<file>, use the matching media_path directly instead of uploading again. ${SIGNED_UPLOAD_RUNTIME_GUIDANCE} Do not pass base64, external URLs, /mnt/data paths, local sandbox paths, attachment handles, or invented placeholder URLs.`,
  properties: {
    media_path: {
      type: 'string',
      description: 'Committed media path returned by slimweb_uploads_commit, such as sites/1/mcp-uploads/committed/<upload_id>.webp. Existing SlimWeb /media/sites/<site_id>/mcp-uploads/committed/<file> URLs can be converted to this path form.'
    }
  },
  anyOf: [
    { required: ['media_path'] }
  ],
  additionalProperties: false
};
const IMPORTABLE_IMAGE_SOURCE_SCHEMA = {
  type: 'object',
  description: 'Committed SlimWeb media source, SlimWeb media URL, or directly downloadable external image URL. Prefer media_path when available. If the user provides an external http/https image URL, pass image_url so SlimWeb can import it into committed media before use. Do not pass base64, /mnt/data paths, local sandbox paths, attachment handles, or invented placeholder URLs.',
  properties: {
    media_path: IMAGE_SOURCE_SCHEMA.properties.media_path,
    image_url: {
      type: 'string',
      description: 'Directly downloadable http/https image URL to import into this SlimWeb site before use.'
    },
    filename: {
      type: 'string',
      description: 'Optional filename to use when importing image_url.'
    },
    mime_type: {
      type: 'string',
      description: 'Optional image MIME type for image_url, such as image/png, image/jpeg, or image/webp.'
    }
  },
  anyOf: [
    { required: ['media_path'] },
    { required: ['image_url'] }
  ],
  additionalProperties: false
};
const CONTENT_SEO_INPUT_PROPERTIES = {
  site_id: { type: 'integer' },
  content_type: {
    type: 'string',
    enum: ['page', 'article'],
    description: 'Target content type. Use page after slimweb_pages_create/slimweb_pages_update, or article after slimweb_articles_create/slimweb_articles_update.'
  },
  workflow_context: {
    type: 'string',
    enum: ['page_create', 'page_update', 'article_create', 'article_update'],
    description: 'Required proof that this tool is being called as part of a page/article create or edit workflow. This tool must not be used standalone.'
  },
  page_name: {
    type: 'string',
    description: 'Required for content_type=page. Page title or page key returned by the page create/update flow.'
  },
  page_key: {
    type: 'string',
    description: 'Optional page key for content_type=page.'
  },
  article_id: {
    type: 'integer',
    description: 'Required for content_type=article. Article ID returned or resolved by the article create/update flow.'
  },
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
  llms_txt: { type: 'string' },
  aeo_business_summary: { type: 'string' },
  aeo_target_audience: { type: 'string' },
  aeo_products_services: { type: 'string' },
  aeo_customer_questions: { type: 'string' },
  aeo_answer_style: { type: 'string' },
  aeo_entity_facts: { type: 'string' },
  geo_citation_targets: { type: 'string' },
  geo_verifiable_claims: { type: 'string' },
  geo_trust_signals: { type: 'string' },
  geo_same_as_profiles: { type: 'string' },
  geo_comparison_positioning: { type: 'string' }
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
    description: 'List SlimWeb sites available to the authenticated account. Always call this first before any other SlimWeb MCP action.',
    inputSchema: EMPTY_INPUT_SCHEMA
  },
  {
    name: 'slimweb_site_select',
    description: 'Validate and return a SlimWeb site selected from slimweb_sites_list. Use this to confirm the target site before any site-scoped tool call.',
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
    description: 'List custom page style schemes/themes for a SlimWeb site. Default is intentionally omitted from this public list. Color mode is site-level; call slimweb_site_theme_mode_get/update for light or dark.',
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
    name: 'slimweb_site_theme_mode_get',
    description: 'Read the site-level storefront color mode. This is the single light/dark source for Default and every custom style scheme.',
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
    name: 'slimweb_design_context_get',
    description: 'Return the active storefront visual design context before any page design, theme design, illustration, or drawing work. Reads the current theme design summary, the site light/dark mode, and always reports Tailwind as the framework.',
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
    name: 'slimweb_site_theme_mode_update',
    description: 'Update the site-level storefront color mode to light or dark. Use before theme/page design when the user wants neon, fluorescent, dark-first, or light-first visual language.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        theme_mode: {
          type: 'string',
          enum: ['light', 'dark'],
          description: 'Site-level storefront color mode.'
        }
      },
      required: ['site_id', 'theme_mode']
    }
  },
  {
    name: 'slimweb_themes_create_from_default',
    description: 'Create a new non-Default theme/page style scheme by copying only Default shell/root-element template files. The theme acts as the base styling layer for every page, including the homepage. Do not choose light/dark here; the style scheme inherits site-level color mode.',
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
        }
      },
      required: ['site_id', 'name']
    }
  },
  {
    name: 'slimweb_themes_activate',
    description: 'Set a theme/page style scheme as the active storefront theme after user confirmation. This affects the live storefront presentation.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Theme ID to activate, or default.'
        }
      },
      required: ['site_id', 'theme_id']
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
    description: 'Return reference-only JSON describing real storefront shell data such as nav items, category counts, cart/login buttons, footer contact items, and the current MCP-managed root CSS. Call before creating or modifying visual theme elements; edit the returned root_css.current_css and pass the complete CSS back to slimweb_themes_update_root_elements.css.',
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
    description: 'Update root-level theme fragments such as navbar, footer, and theme-level CSS for a theme. Do not use this to overwrite page body content. The css field replaces the MCP-managed root-elements CSS file, so include every MCP-managed root style that should remain, including footer/background rules.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Target theme ID.'
        },
        fragments: {
          type: 'object',
          description: 'Optional root element HTML fragments keyed by navbar or footer.'
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
    name: 'slimweb_facebook_settings_get',
    description: 'Read the Facebook integration fields shown in the SlimWeb admin settings, including member-login App ID, Page ID, and Facebook comments toggles.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_facebook_settings_update',
    description: 'Update the Facebook integration fields shown in the SlimWeb admin settings, including App ID, Page ID, and Facebook comments toggles.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        facebook_app_id: { type: 'string' },
        facebook_page_id: { type: 'string' },
        facebook_comment_on_products: { type: 'boolean' },
        facebook_comment_on_posts: { type: 'boolean' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_notion_settings_get',
    description: 'Read the Notion API token field shown in the SlimWeb admin settings.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_notion_settings_update',
    description: 'Update the Notion API token field shown in the SlimWeb admin settings.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        notion_token: { type: 'string' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_mail_delivery_settings_get',
    description: 'Read SlimWeb mail delivery settings, including SMTP server fields and order/reminder notification options shown in the admin mail settings page.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_mail_delivery_settings_update',
    description: 'Update SlimWeb mail delivery settings, including SMTP server fields and order/reminder notification options shown in the admin mail settings page.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        notification_new_order_sms_numbers: { type: 'string' },
        notification_sms_on_shipped: { type: 'boolean' },
        notification_auto_send_reminder_sms: { type: 'boolean' },
        notification_reminder_sms_content: { type: 'string' },
        notification_smtp_host: { type: 'string' },
        notification_smtp_username: { type: 'string' },
        notification_smtp_password: { type: 'string' },
        notification_smtp_port: { type: ['string', 'integer'] },
        notification_smtp_from_email: { type: 'string' },
        notification_smtp_ssl: { type: 'boolean' }
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
    description: 'Update the single shared SlimWeb email layout wrapper. Before calling this tool, always call slimweb_mail_layout_get for the same site_id and modify the returned current/default html so existing logo, site text, footer, placeholders, and content structure are preserved. The html must preserve {content}, {site_name}, {site_url}, and {logo_url}.',
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
    description: 'Search normal SlimWeb orders with the same admin filters. For "unhandled/pending orders", use logistics_status=pending, which means payment completed and logistics not completed. If total exceeds 20, tell the user there are too many results and ask them to use the admin backend.',
    inputSchema: orderListInputSchema()
  },
  {
    name: 'slimweb_orders_profit_statistics',
    description: 'Calculate store net profit for paid non-cancelled orders. Use no date filters for questions like "how much money has our website made"; for "this month", fill date_from/date_to with the current month range. Formula: order grand total minus product cost total minus free-shipping cost; discounts are already included in grand total.',
    inputSchema: orderProfitStatisticsInputSchema()
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
        member_verification: {
          type: 'string',
          enum: ['none', 'email'],
          description: 'email requires complete SMTP settings first; configure them through slimweb_mail_delivery_settings_update before enabling email verification.'
        },
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
          description: 'OpenAI fileParams object supplied by ChatGPT. Expected fields include download_url or download_link, file_id/id, name or file_name, mime_type, and size. GPT Actions-style { openaiFileIdRefs: [{ id, name, mime_type, download_link }] } is also accepted.',
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
    name: 'slimweb_debug_attachment_refs',
    description: 'Debug what ChatGPT Remote MCP actually passes for conversation image attachments. This tool does not download, upload, or write assets; it returns a redacted shape summary of attachment-related arguments so SlimWeb can diagnose fileParams changes.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Optional site ID for context only. No site data is modified.'
        },
        image: {
          description: 'Attachment parameter that ChatGPT should populate through OpenAI fileParams. May be an object, string file ID, or null depending on ChatGPT runtime behavior.'
        },
        images: {
          type: 'array',
          items: {},
          description: 'Optional array of attachment-like values if ChatGPT exposes multiple files.'
        },
        openaiFileIdRefs: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Optional GPT Actions-style file refs if the runtime provides them directly.'
        },
        attachments: {
          type: 'array',
          items: {},
          description: 'Optional attachment list if the runtime exposes one.'
        }
      },
      additionalProperties: true
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
    description: 'List articles for a SlimWeb site so the AI can choose an article to edit or avoid duplicates. Use this for article content, not page content.',
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
    name: 'slimweb_articles_check_title',
    description: 'Check whether an article title already exists within the active SlimWeb site. Use this before creating a new article so the AI can stop on duplicates and avoid title collisions.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        title: { type: 'string' }
      },
      required: ['site_id', 'title']
    }
  },
  {
    name: 'slimweb_articles_get_content',
    description: 'Read a single article by article_id before editing it. Use this to load the current article state, including the rendered body and cover image metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        article_id: { type: 'integer' }
      },
      required: ['site_id', 'article_id']
    }
  },
  {
    name: 'slimweb_articles_create',
    description: `Create a new article. A 16:9 cover image is mandatory, and optional content images may be attached for the article body. Use slimweb_articles_check_title first and generate or import the approved cover image before calling this tool. ${CHATGPT_MISSING_IMAGE_GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        notion_page_id: { type: 'string' },
        title: { type: 'string' },
        content_html: {
          type: 'string',
          description: 'Safe article body HTML. Do not include the article title as an h1 because SlimWeb renders title separately. Do not include script/link/iframe tags or inline event handlers.'
        },
        cover_image: {
          ...IMAGE_SOURCE_SCHEMA,
          description: 'Required when creating a new article. Use a 16:9 main image media_path returned by slimweb_uploads_commit or slimweb_images_import_chatgpt_attachment. If the image was generated or refined in ChatGPT, ask the user to paste or re-upload the approved image first so fileParams can import it.'
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
      required: ['site_id', 'title', 'content_html', 'cover_image']
    }
  },
  {
    name: 'slimweb_articles_update',
    description: `Update an existing article by article_id. Use slimweb_articles_get_content first to read the current article state; a cover image can be replaced or left unchanged, and optional content images may be updated as needed. ${CHATGPT_MISSING_IMAGE_GUIDANCE}`,
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
          description: 'Optional replacement for the article cover image. If you replace it with a ChatGPT-generated image, ask the user to paste or re-upload the approved image first so fileParams can import it.'
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
      required: ['site_id', 'article_id']
    }
  },
  {
    name: 'slimweb_content_seo_update',
    description: 'Update content-level SEO/AEO/GEO metadata only as part of a page/article create or edit workflow. Do not call this tool as a standalone SEO task; use slimweb_seo_settings_update for site-wide SEO settings. For pages, call after slimweb_pages_create or slimweb_pages_update. For articles, call after slimweb_articles_create or slimweb_articles_update.',
    inputSchema: {
      type: 'object',
      properties: CONTENT_SEO_INPUT_PROPERTIES,
      required: ['site_id', 'content_type', 'workflow_context']
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
    description: 'Create or update a product category using site_categories fields. Category names must be unique across the whole site regardless of parent hierarchy; list categories first and reuse the existing category instead of creating a duplicate. When creating, the AI must generate a semantic SVG icon from the user wording and pass it as icon_svg_base64. Optional image uses the same committed media_path upload flow as product/article images; use a 16:9 category image and never pass base64 or URLs. If no parent category is specified, create or move it as a root category.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        category_id: {
          type: 'integer',
          description: 'Existing category ID when updating. Omit to create.'
        },
        current_name: {
          type: 'string',
          description: 'Existing category name to update when category_id is not available. Use this for rename requests like "change 網頁設計 to 網站設計"; name is the new category name.'
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
        image: {
          ...IMPORTABLE_IMAGE_SOURCE_SCHEMA,
          description: 'Optional 16:9 category image. Use media_path for committed SlimWeb images, or image_url for a directly downloadable external image that should be imported before setting the category image. Never pass base64, /mnt/data paths, local paths, attachment handles, or invented placeholders.'
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
        variant_mode: {
          type: 'string',
          enum: ['none', 'different_price'],
          description: 'Optional. Defaults to different_price when variants are provided, otherwise none.'
        },
        replace_image_by_variant: { type: 'boolean' },
        primary_images: {
          type: 'array',
          description: `Required with at least one entry when creating. When updating, primary_images_mode controls whether these images append to or replace the existing primary image list. Use source.media_path values returned by slimweb_uploads_commit. ${SIGNED_UPLOAD_RUNTIME_GUIDANCE} Never pass base64, URLs, /mnt/data paths, attachment handles, or invented placeholder URLs.`,
          items: PRODUCT_IMAGE_ITEM_SCHEMA
        },
        primary_images_mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'Only applies when primary_images is provided. append preserves existing primary images and adds these after them, skipping image paths that already exist; replace removes existing primary images first. Defaults to append when updating an existing product and replace when creating.'
        },
        content_images: {
          type: 'array',
          description: 'Optional product content/detail images. content_images_mode controls whether these images append to or replace the existing content image list. Use the same image source rules as primary_images.',
          items: PRODUCT_IMAGE_ITEM_SCHEMA
        },
        content_images_mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'Only applies when content_images is provided. append preserves existing content images and adds these after them, skipping image paths that already exist; replace removes existing content images first. Defaults to append when updating an existing product and replace when creating.'
        },
        videos: {
          type: 'array',
          items: { type: 'string' }
        },
        variants: {
          type: 'array',
          description: '商品規格. Each row may include name, price or base_price, optional sale_price, and stock.',
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
      name: 'slimweb_newsletters_create',
      description: 'Create a SlimWeb newsletter record for all members or selected members. This tool stores the newsletter for Webless admin scheduling and does not send email directly. If scheduled_at is omitted, SlimWeb-MCP sets it to the current time plus 5 minutes.',
      inputSchema: {
        type: 'object',
        properties: {
          site_id: { type: 'integer' },
          recipient_scope: {
            type: 'string',
            enum: ['members', 'all_members'],
            description: 'Use members for explicit named recipients. Use all_members only when the user clearly asked to create a newsletter for every member.'
          },
          title: { type: 'string' },
          member_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional recipient names. When only names are provided, SlimWeb-MCP looks up members one by one and may return candidate emails when a name matches multiple members.'
          },
          member_emails: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional recipient emails. When member_names and member_emails are both provided with the same length, the tool stores the newsletter recipients directly without member lookup.'
          },
          html_content: {
            type: 'string',
            description: 'AI-composed HTML body. script, iframe, and inline event handlers are rejected/removed before storing.'
          },
          scheduled_at: {
            type: 'string',
            description: 'Optional future date or datetime. Omit when the user did not specify a send time; SlimWeb-MCP will use now + 5 minutes.'
          }
        },
        required: ['site_id', 'recipient_scope', 'title', 'html_content']
      }
    },
    {
      name: 'slimweb_posters_create',
      description: 'Create a durable AI-generated ecommerce poster using up to five product names, the site name/logo, product names, product primary images as image-edit references, and the user drawing request. The generated poster is stored as a media asset and returned with image_url plus asset.media_path. If any product name fuzzy search matches multiple products, stop and return candidates for user confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          site_id: { type: 'integer' },
          product_names: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 5,
            description: 'Product names mentioned by the user. SlimWeb-MCP fuzzy-searches each name and stops for confirmation if any name matches more than one product.'
          },
          aspect_ratio: {
            type: 'string',
            enum: ['9:16', '1:1', '16:9'],
            description: 'Poster aspect ratio. Defaults to 9:16 when omitted.'
          },
          drawing_prompt: {
            type: 'string',
            description: 'Poster drawing requirements, promotion copy, style direction, and layout request.'
          }
        },
        required: ['site_id', 'product_names', 'drawing_prompt']
      },
      _meta: {
        ui: {
          resourceUri: POSTER_PREVIEW_WIDGET_URI,
          visibility: ['model', 'app']
        },
        'openai/outputTemplate': POSTER_PREVIEW_WIDGET_URI,
        'openai/widgetAccessible': true,
        'openai/toolInvocation/invoking': '正在產生海報...',
        'openai/toolInvocation/invoked': '海報已產生'
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
          ...IMPORTABLE_IMAGE_SOURCE_SCHEMA
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
    name: 'slimweb_pages_list',
    description: 'List all fixed and custom site pages. Use this when you need the site-wide page inventory before a read, create, update, or navigation task.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Optional preview theme for page links. Use this when the caller wants page URLs rendered under a selected non-active theme.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb_pages_check_title',
    description: 'Check whether a page title already exists for the selected site. Matching is trim + case-insensitive, and fixed pages also compare their English aliases. Use this before creating a page and stop if any match already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        title: {
          type: 'string',
          description: 'Human-readable page title to check for collisions.'
        }
      },
      required: ['site_id', 'title']
    }
  },
  {
    name: 'slimweb_pages_get_content',
    description: 'Read a custom page by page_name and return its content plus metadata. Fixed template pages are not searched. Use this before editing a custom page or when the AI needs the current custom page state.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        page_name: {
          type: 'string',
          description: 'Page title or page key to look up.'
        }
      },
      required: ['site_id', 'page_name']
    }
  },
  {
    name: 'slimweb_pages_create',
    description: `Create a new custom page. The AI must already have checked title collisions with slimweb_pages_check_title and should use slimweb_design_context_get plus image tools before sending HTML/CSS without JavaScript. ${CHATGPT_MISSING_IMAGE_GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        title: {
          type: 'string',
          description: 'Human-readable page title.'
        },
        content: {
          type: 'object',
          description: 'Structured page body. Provide content.html or content.body_html. HTML must not include script/link/iframe tags or inline event handlers.'
        },
        page_key: {
          type: 'string',
          description: 'Optional custom page slug. If omitted, the server generates one from the title.'
        },
        confirmation_token: {
          type: 'string'
        }
      },
      required: ['site_id', 'title', 'content']
    }
  },
  {
    name: 'slimweb_pages_update',
    description: `Update an existing custom page by page_name. Use slimweb_pages_get_content first to fetch the current custom page state. Use uploaded media_path URLs for reusable images; do not embed base64 images. Custom CSS is allowed in page HTML, but JavaScript is forbidden. ${CHATGPT_MISSING_IMAGE_GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'integer' },
        page_name: {
          type: 'string',
          description: 'Page title or page key to update.'
        },
        title: {
          type: 'string',
          description: 'Optional new page title. If omitted, the existing title is preserved.'
        },
        content: {
          type: 'object',
          description: 'Structured page body. Provide content.html or content.body_html. HTML must not include script/link/iframe tags or inline event handlers.'
        },
        confirmation_token: { type: 'string' }
      },
      required: ['site_id', 'page_name', 'content']
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
    description: 'Return a preview URL for a page with explicit site, theme, and page parameters so the AI can inspect the page visually before editing or after page creation.',
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

function posterResultSummary(result) {
  if (result?.requiresProductSelection) {
    return String(result.message ?? '找到多個相符商品，請確認要使用哪一個商品。');
  }

  const aspectRatio = typeof result?.aspect_ratio === 'string' ? result.aspect_ratio : '9:16';
  const products = Array.isArray(result?.products)
    ? result.products.map((item) => item?.name).filter(Boolean).join('、')
    : '';
  const assetPath = typeof result?.asset?.media_path === 'string' ? result.asset.media_path : '';

  return [
    `海報已產生：${aspectRatio}`,
    products ? `商品：${products}` : '',
    assetPath ? `素材：${assetPath}` : ''
  ].filter(Boolean).join('\n');
}

function toolArgs(message) {
  return message?.params?.arguments && typeof message.params.arguments === 'object'
    ? message.params.arguments
    : {};
}

function debugAttachmentRefs(args) {
  const attachmentKeys = [
    'image',
    'images',
    'openaiFileIdRefs',
    'attachments',
    'file',
    'files',
    'file_id',
    'fileId',
    'id',
    'download_url',
    'downloadUrl',
    'download_link',
    'downloadLink',
    'url',
    'mime_type',
    'mimeType',
    'name',
    'filename',
    'file_name'
  ];
  const presentKeys = Object.keys(args ?? {});

  return {
    ok: true,
    diagnostic: 'redacted_attachment_shape',
    note: 'Values are redacted. URL query strings, tokens, and full file IDs are not returned.',
    top_level_keys: presentKeys,
    attachment_related_keys: presentKeys.filter((key) => attachmentKeys.includes(key)),
    arguments: redactAttachmentValue(args, 0)
  };
}

function redactAttachmentValue(value, depth = 0) {
  if (value === null) {
    return { type: 'null' };
  }

  if (value === undefined) {
    return { type: 'undefined' };
  }

  if (typeof value === 'string') {
    return redactAttachmentString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { type: typeof value, value };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      items: value.slice(0, 5).map((item) => redactAttachmentValue(item, depth + 1)),
      truncated: value.length > 5
    };
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    const redacted = {
      type: 'object',
      keys
    };

    if (depth >= 3) {
      redacted.truncated = true;
      return redacted;
    }

    redacted.fields = {};
    for (const key of keys.slice(0, 20)) {
      redacted.fields[key] = redactAttachmentValue(value[key], depth + 1);
    }
    redacted.truncated = keys.length > 20;
    return redacted;
  }

  return { type: typeof value };
}

function redactAttachmentString(value) {
  const text = String(value);
  try {
    const parsed = new URL(text);
    return {
      type: 'url',
      protocol: parsed.protocol,
      host: parsed.host,
      pathname: parsed.pathname,
      has_query: parsed.search.length > 0,
      has_hash: parsed.hash.length > 0
    };
  } catch {
    return {
      type: 'string',
      length: text.length,
      prefix: text.slice(0, 24),
      looks_like_openai_file_id: /^(file|file_)[A-Za-z0-9_-]+/.test(text)
    };
  }
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
  slimweb_site_theme_mode_get: ['page_management', 'page_management_templates'],
  slimweb_design_context_get: ['page_management', 'page_management_templates'],
  slimweb_site_theme_mode_update: ['page_management', 'page_management_templates'],
  slimweb_themes_create_from_default: ['page_management', 'page_management_templates'],
  slimweb_themes_activate: ['page_management', 'page_management_templates'],
  slimweb_themes_delete: ['page_management', 'page_management_templates'],
  slimweb_theme_shell_get_context: ['page_management', 'page_management_templates'],
  slimweb_themes_update_root_elements: ['page_management', 'page_management_templates'],
  slimweb_theme_style_profile_get: ['page_management', 'page_management_templates'],
  slimweb_theme_style_profile_upsert: ['page_management', 'page_management_templates'],
  slimweb_theme_style_profile_append_request: ['page_management', 'page_management_templates'],
  slimweb_site_readiness_get: [],
  slimweb_seo_settings_get: ['seo_settings'],
  slimweb_seo_settings_update: ['seo_settings'],
  slimweb_facebook_settings_get: ['integration_settings'],
  slimweb_facebook_settings_update: ['integration_settings'],
  slimweb_notion_settings_get: ['integration_settings'],
  slimweb_notion_settings_update: ['integration_settings'],
  slimweb_mail_delivery_settings_get: ['mail_settings'],
  slimweb_mail_delivery_settings_update: ['mail_settings'],
  slimweb_mail_templates_get: ['mail_settings'],
  slimweb_mail_templates_update: ['mail_settings'],
  slimweb_mail_layout_get: ['mail_settings'],
  slimweb_mail_layout_update: ['mail_settings'],
  slimweb_payment_logistics_get: ['payment_logistics'],
  slimweb_payment_logistics_update: ['payment_logistics'],
  slimweb_orders_list: ['orders_management'],
  slimweb_orders_profit_statistics: ['orders_management'],
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
  slimweb_images_import_chatgpt_attachment: [],
  slimweb_debug_attachment_refs: [],
  slimweb_uploads_create: [],
  slimweb_uploads_commit: [],
  slimweb_articles_list: ['article_management', 'article_list'],
  slimweb_articles_check_title: ['article_management', 'article_list'],
  slimweb_articles_get_content: ['article_management', 'article_list'],
  slimweb_articles_create: ['article_management', 'article_list'],
  slimweb_articles_update: ['article_management', 'article_list'],
  slimweb_content_seo_update: ['page_management', 'page_management_pages', 'article_management', 'article_list'],
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
  slimweb_newsletters_create: ['member_management', 'member_list'],
  slimweb_posters_create: ['product_management', 'product_management_products'],
  slimweb_discount_codes_list: ['discount_management', 'discount_codes'],
  slimweb_discount_codes_upsert: ['discount_management', 'discount_codes'],
  slimweb_member_tiers_list: ['member_management', 'member_tiers'],
  slimweb_member_tiers_upsert: ['member_management', 'member_tiers'],
  slimweb_threshold_gifts_list: ['discount_management', 'threshold_gifts'],
  slimweb_threshold_gifts_upsert: ['discount_management', 'threshold_gifts'],
  slimweb_product_add_ons_list: ['product_management', 'product_management_add_ons'],
  slimweb_product_add_ons_upsert: ['product_management', 'product_management_add_ons'],
  slimweb_customer_service_logs_list: ['customer_service_logs'],
  slimweb_customer_service_settings_get: ['ai_management', 'ai_customer_service'],
  slimweb_customer_service_settings_update: ['ai_management', 'ai_customer_service'],
  slimweb_exports_create: ['system_admin'],
  slimweb_audit_list: ['system_admin'],
  slimweb_assets_upload: [],
  slimweb_pages_list: ['page_management', 'page_management_pages'],
  slimweb_pages_check_title: ['page_management', 'page_management_pages'],
  slimweb_pages_get_content: ['page_management', 'page_management_pages'],
  slimweb_pages_create: ['page_management', 'page_management_pages'],
  slimweb_pages_update: ['page_management', 'page_management_pages'],
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
    return MCP_TOOLS.map(publicTool);
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
  }).map(publicTool);
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
          .find((site) => String(site.site_code ?? site.callback_code) === String(args.site_code)
            || String(site.site_id ?? site.id) === String(args.site_id))
      };

  if (actor?.site_id && args && typeof args === 'object' && !args.site_id) {
    args.site_id = actor.site_id;
  }

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
          ? 'Multiple sites are available. Ask the user which site name to operate before calling site-scoped tools. Use the matching site_code; do not ask for numeric site_id.'
          : 'Use the single available site_code for site-scoped tools.',
        sites: sites.map(publicSiteSelectionPayload)
      }));
    }

    case 'slimweb_site_select': {
      try {
        const result = await context.accountRepository.selectSiteForAdminIdentity(sessionIdentity(session), toolArgs(message));

        return mcpResult(message.id ?? null, mcpJsonContent({
          ...result,
          selected_site: publicSiteSelectionPayload(result.selected_site ?? {})
        }));
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

    case 'slimweb_site_theme_mode_get': {
      try {
        const result = await context.accountRepository.getSiteThemeMode(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_design_context_get': {
      try {
        const result = await context.accountRepository.getDesignContext(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_site_theme_mode_update': {
      try {
        const result = await context.accountRepository.updateSiteThemeMode(
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

    case 'slimweb_themes_activate': {
      try {
        const result = await context.accountRepository.activateTheme(
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

    case 'slimweb_facebook_settings_get': {
      try {
        const result = await context.accountRepository.getFacebookSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_facebook_settings_update': {
      try {
        const result = await context.accountRepository.updateFacebookSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_notion_settings_get': {
      try {
        const result = await context.accountRepository.getNotionSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_notion_settings_update': {
      try {
        const result = await context.accountRepository.updateNotionSettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_mail_delivery_settings_get': {
      try {
        const result = await context.accountRepository.getMailDeliverySettings(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_mail_delivery_settings_update': {
      try {
        const result = await context.accountRepository.updateMailDeliverySettings(
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

    case 'slimweb_orders_profit_statistics': {
      try {
        const result = await context.accountRepository.calculateOrderProfitStatistics(
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

    case 'slimweb_debug_attachment_refs': {
      return mcpResult(message.id ?? null, mcpJsonContent(debugAttachmentRefs(toolArgs(message))));
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

    case 'slimweb_articles_check_title': {
      try {
        const result = await context.accountRepository.checkArticleTitle(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_articles_get_content': {
      try {
        const result = await context.accountRepository.getArticleContent(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_articles_create': {
      try {
        const result = await context.accountRepository.createArticle(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_articles_update': {
      try {
        const result = await context.accountRepository.updateArticle(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_content_seo_update': {
      try {
        const result = await context.accountRepository.updateContentSeo(
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

      case 'slimweb_newsletters_create': {
        try {
          const result = await context.accountRepository.createNewsletter(
            await actorForTool(session, name, toolArgs(message), context),
            toolArgs(message)
          );

          return mcpResult(message.id ?? null, mcpJsonContent(result));
        } catch (error) {
          return toolExceptionToMcpError(message?.id ?? null, error);
        }
      }

      case 'slimweb_posters_create': {
        try {
          const result = await context.accountRepository.createPoster(
            await actorForTool(session, name, toolArgs(message), context),
            toolArgs(message)
          );

          return mcpResult(message.id ?? null, {
            structuredContent: result,
            content: [
              {
                type: 'text',
                text: posterResultSummary(result)
              }
            ],
            _meta: {
              ui: {
                resourceUri: POSTER_PREVIEW_WIDGET_URI,
                visibility: ['model', 'app']
              },
              'openai/outputTemplate': POSTER_PREVIEW_WIDGET_URI,
              'openai/widgetAccessible': true
            }
          });
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

    case 'slimweb_pages_get_content': {
      try {
        const result = await context.accountRepository.getPageContent(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
);

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_list': {
      try {
        const result = await context.accountRepository.listPages(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_check_title': {
      try {
        const result = await context.accountRepository.checkPageTitle(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_get_content': {
      try {
        const result = await context.accountRepository.getPageContent(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_create': {
      try {
        const result = await context.accountRepository.createPage(
          await actorForTool(session, name, toolArgs(message), context),
          toolArgs(message)
        );

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb_pages_update': {
      try {
        const result = await context.accountRepository.updatePage(
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
          },
          resources: {
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

    case 'resources/list':
      return mcpResult(id, {
        resources: [
          {
            uri: MEMBER_EMAIL_PREVIEW_WIDGET_URI,
            name: 'SlimWeb member email preview',
            mimeType: 'text/html'
          },
          {
            uri: POSTER_PREVIEW_WIDGET_URI,
            name: 'SlimWeb poster preview',
            mimeType: 'text/html'
          }
        ]
      });

    case 'resources/read': {
      const uri = String(message?.params?.uri ?? '');
      if (![MEMBER_EMAIL_PREVIEW_WIDGET_URI, POSTER_PREVIEW_WIDGET_URI].includes(uri)) {
        return mcpError(id, -32602, `Unknown MCP resource: ${uri || 'undefined'}`);
      }
      if (uri === POSTER_PREVIEW_WIDGET_URI) {
        return mcpResult(id, {
          contents: [{
            uri: POSTER_PREVIEW_WIDGET_URI,
            mimeType: 'text/html',
            text: POSTER_PREVIEW_WIDGET_HTML,
            _meta: {
              'openai/widgetDescription': 'Display the generated SlimWeb poster.',
              'openai/widgetPrefersBorder': true,
              'openai/widgetCSP': {
                connect_domains: [],
                resource_domains: ['https://slimweb.tw', 'https://tmp.openai.com']
              }
            }
          }]
        });
      }

      return mcpResult(id, {
        contents: [{
          uri: MEMBER_EMAIL_PREVIEW_WIDGET_URI,
          mimeType: 'text/html',
          text: MEMBER_EMAIL_PREVIEW_WIDGET_HTML,
          _meta: {
            'openai/widgetDescription': 'Preview the rendered member email before sending.',
            'openai/widgetPrefersBorder': true,
            'openai/widgetCSP': {
              connect_domains: [],
              resource_domains: ['https://slimweb.tw']
            }
          }
        }]
      });
    }

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
    const session = verifySessionToken(readSessionToken(request), context.sessionSecret);
    logMcpRequest(request, message, Boolean(session));

    if (message?.method === 'tools/call' && !session) {
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

function logMcpRequest(request, message, authenticated) {
  const method = typeof message?.method === 'string' ? message.method : null;
  if (!method) {
    return;
  }

  const log = {
    event: 'mcp_request',
    method,
    authenticated,
    user_agent: request.headers['user-agent'] ?? null
  };

  if (method === 'tools/call') {
    log.tool = typeof message?.params?.name === 'string' ? message.params.name : null;
  }

  console.log(JSON.stringify(log));
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
    status: 'ready',
    instructions: MCP_SERVER_GUIDELINES
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
